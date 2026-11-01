# The MCP server over HTTP (#460): POST /mcp with a personal access token.
# A client initializes, lists the tools, and calls them on its account's
# scores; it reads nobody else's, writes nothing the engraver refuses, and
# without a valid token gets nothing at all. The tokens themselves are made,
# listed and revoked on the account page.

const MCP_PASSWORD = "correct horse battery"
const MCP_SOURCE = "\\header { title = \"Little tune\" }\n\\new Staff { \\time 3/4 c'4 d' e' | f'2. }\n"

def mcp_user(name = nil)
  user = User.new()
  user.email = "mcp-#{uuid_v4}@example.com"
  user.name = name unless name.nil?
  user.set_password(MCP_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

def mcp_token(user)
  AccessToken.issue(user, "Spec client")["token"]
end

# One JSON-RPC message sent with `token`: the response.
def mcp_send(token, message)
  clear_headers()
  set_header("Content-Type", "application/json")
  set_header("Authorization", "Bearer " + token) unless token.nil?
  response = post("/mcp", message.to_json)
  clear_headers()
  response
end

# A tools/call: the result (content, structuredContent, isError).
def mcp_call(token, name, arguments)
  answer = res_json(mcp_send(
    token,
    {
      "jsonrpc": "2.0",
      "id": 7,
      "method": "tools/call",
      "params": {"name": name, "arguments": arguments}
    }
  ))
  answer["result"]
end

def mcp_sign_in(user)
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": MCP_PASSWORD}
  )
end

describe("The MCP server") do
  before_each() do
    as_guest()
    clear_headers()
    clear_cookies()
  end

  describe("the token") do
    test("is refused when missing, unknown or revoked, with nothing done") do
      user = mcp_user()
      count_before = Score.where({"user_id": user._key}).count
      call = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": "create_score", "arguments": {"source": MCP_SOURCE}}
      }
      missing = mcp_send(nil, call)
      assert_eq(res_status(missing), 401)
      assert_contains(res_header(missing, "WWW-Authenticate"), "Bearer")
      assert_contains(res_json(missing)["error"]["message"], "Access tokens")
      assert_eq(res_status(mcp_send("score_" + uuid_v4 + uuid_v4, call)), 401, "an unknown token")
      assert_eq(res_status(mcp_send("not-a-token", call)), 401)
      token = mcp_token(user)
      record = AccessToken.where({"user_id": user._key}).first
      AccessToken.revoke(user, record._key)
      assert_eq(res_status(mcp_send(token, call)), 401, "a revoked one")
      assert_eq(Score.where({"user_id": user._key}).count, count_before)
    end

    test("keeps only its digest, notes its use, and answers its account") do
      user = mcp_user()
      made = AccessToken.issue(user, "  Laptop  ")
      record = made["record"]
      assert(made["token"].starts_with?("score_"))
      assert_eq(record.name, "Laptop")
      assert_not(record.digest == made["token"], "never the token itself")
      assert_eq(record.digest, Crypto.sha256(made["token"]))
      assert(made["token"].starts_with?(record.hint))
      assert_null(record.last_used_at)
      assert_eq(AccessToken.user_for(made["token"])._key, user._key)
      assert_not_null(AccessToken.find(record._key).last_used_at, "its use noted")
      assert_eq(AccessToken.issue(user, "  ")["error"], "Give the token a name: where it is used, say.")
      assert_contains(AccessToken.issue(user, "x" * 61)["error"], "60 characters")
    end

    test("ten at most a person") do
      user = mcp_user()
      10.times do
        AccessToken.issue(user, "Client")
      end
      assert_contains(AccessToken.issue(user, "One more")["error"], "revoke one")
      assert_eq(AccessToken.where({"user_id": user._key}).count, 10)
    end
  end

  describe("the protocol") do
    test("initializes in the version asked, lists its tools, answers ping; a notification gets no body") do
      token = mcp_token(mcp_user())
      init = res_json(mcp_send(
        token,
        {
          "jsonrpc": "2.0",
          "id": 1,
          "method": "initialize",
          "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "spec", "version": "1"}
          }
        }
      ))
      assert_eq(init["id"], 1)
      assert_eq(init["result"]["protocolVersion"], "2025-03-26")
      assert_eq(init["result"]["serverInfo"]["name"], "score")
      assert_contains(init["result"]["instructions"], "check_source")
      newer = res_json(mcp_send(
        token,
        {
          "jsonrpc": "2.0",
          "id": 2,
          "method": "initialize",
          "params": {"protocolVersion": "2099-01-01"}
        }
      ))
      assert_eq(newer["result"]["protocolVersion"], "2025-06-18", "its latest, for a version it does not speak")
      quiet = mcp_send(
        token,
        {"jsonrpc": "2.0", "method": "notifications/initialized"}
      )
      assert_eq(res_status(quiet), 202)
      tools = res_json(mcp_send(
        token,
        {
          "jsonrpc": "2.0",
          "id": 3,
          "method": "tools/list"
        }
      ))["result"]["tools"]
      names = tools.map do |tool|
        tool["name"]
      end
      [
        "list_scores",
        "get_score",
        "check_source",
        "create_score",
        "update_score",
        "transcribe_image",
        "get_transcription"
      ].each do |name|
        assert(names.includes?(name), name)
      end
      assert(tools.all?(&{ |tool|
        tool["inputSchema"]["type"] == "object"
      }))
      assert_eq(res_json(mcp_send(
        token,
        {
          "jsonrpc": "2.0",
          "id": 4,
          "method": "ping"
        }
      ))["result"], {})
    end

    test("answers errors as JSON-RPC: an unknown method or tool, not JSON-RPC, a batch") do
      token = mcp_token(mcp_user())
      unknown = res_json(mcp_send(
        token,
        {
          "jsonrpc": "2.0",
          "id": 5,
          "method": "resources/list"
        }
      ))
      assert_eq(unknown["error"]["code"], -32601)
      tool = res_json(mcp_send(
        token,
        {
          "jsonrpc": "2.0",
          "id": 6,
          "method": "tools/call",
          "params": {"name": "delete_everything"}
        }
      ))
      assert_eq(tool["error"]["code"], -32602)
      bad = res_json(mcp_send(
        token,
        {"id": 7, "method": "ping"}
      ))
      assert_eq(bad["error"]["code"], -32600)
      batch = res_json(mcp_send(token, [
        {
          "jsonrpc": "2.0",
          "id": 8,
          "method": "ping"
        },
        {"jsonrpc": "2.0", "method": "notifications/initialized"}
      ]))
      assert_eq(batch.length, 1)
      assert_eq(batch[0]["id"], 8)
      assert_eq(res_status(get("/mcp")), 405)
    end
  end

  describe("the prompt transcribe_photo (#466)") do
    test("is announced, listed, and carries the skill's method with its scripts to fetch") do
      token = mcp_token(mcp_user())
      init = res_json(mcp_send(
        token,
        {
          "jsonrpc": "2.0",
          "id": 1,
          "method": "initialize",
          "params": {"protocolVersion": "2025-06-18"}
        }
      ))["result"]
      assert_hash_has_key(init["capabilities"], "prompts")
      assert_contains(init["instructions"], "transcribe_photo")
      assert_contains(init["instructions"], "~/.claude/skills/transcribe-score")
      assert_contains(init["instructions"], "/skills/transcribe-score/$f")
      prompts = res_json(mcp_send(
        token,
        {
          "jsonrpc": "2.0",
          "id": 2,
          "method": "prompts/list"
        }
      ))["result"]["prompts"]
      assert_eq(prompts.length, 1)
      assert_eq(prompts[0]["name"], "transcribe_photo")
      assert_eq(prompts[0]["arguments"][0]["name"], "photo")
      got = res_json(mcp_send(
        token,
        {
          "jsonrpc": "2.0",
          "id": 3,
          "method": "prompts/get",
          "params": {"name": "transcribe_photo", "arguments": {"photo": "~/Downloads/tonnerre.jpg"}}
        }
      ))["result"]
      text = got["messages"][0]["content"]["text"]
      assert_eq(got["messages"][0]["role"], "user")
      assert(text.starts_with?("Transcribe the photo ~/Downloads/tonnerre.jpg into a Score score"))
      assert_contains(text, "/skills/transcribe-score/scripts/staff.py -o \"$SKILL/scripts/staff.py\"")
      assert_contains(text, "/skills/transcribe-score/scripts/proof.py")
      ["compare.py", "marks.py", "tiles.py"].each do |script|
        assert_contains(text, "/skills/transcribe-score/scripts/#{script} -o \"$SKILL/scripts/#{script}\"")
      end
      assert_contains(text, "## 4. Markings pass")
      assert_contains(text, "## 0. Read the original, never a copy")
      assert_not(text.includes?("name: transcribe-score"), "the skill's front matter stays out")
    end

    test("without a photo asks for one; an unknown prompt is a JSON-RPC error") do
      token = mcp_token(mcp_user())
      text = res_json(mcp_send(
        token,
        {
          "jsonrpc": "2.0",
          "id": 4,
          "method": "prompts/get",
          "params": {"name": "transcribe_photo"}
        }
      ))["result"]["messages"][0]["content"]["text"]
      assert(text.starts_with?("Transcribe the photo I give you"))
      unknown = res_json(mcp_send(
        token,
        {
          "jsonrpc": "2.0",
          "id": 5,
          "method": "prompts/get",
          "params": {"name": "write_symphony"}
        }
      ))
      assert_eq(unknown["error"]["code"], -32602)
      assert_contains(unknown["error"]["message"], "write_symphony")
      assert_eq(ScoreMcp.without_front_matter("---\nname: x\n---\n\n# Body"), "# Body")
      assert_eq(ScoreMcp.without_front_matter("# No front matter"), "# No front matter")
      assert_eq(ScoreMcp.without_front_matter("---\nnever closed"), "---\nnever closed")
      assert_eq(res_status(mcp_send(
        nil,
        {
          "jsonrpc": "2.0",
          "id": 6,
          "method": "prompts/get",
          "params": {"name": "transcribe_photo"}
        }
      )), 401)
    end
  end

  describe("the tools") do
    test("check_source says what the engraver reads, and why not") do
      token = mcp_token(mcp_user())
      ok = mcp_call(token, "check_source", {"source": MCP_SOURCE})
      assert_eq(ok["isError"], false)
      assert_eq(ok["structuredContent"]["ok"], true)
      bad = mcp_call(token, "check_source", {"source": "{ c'4 \\nosuchcommand d' }"})
      assert_eq(bad["isError"], true)
      assert_contains(bad["content"][0]["text"], "The engraver does not read it")
      assert_eq(mcp_call(token, "check_source", {"source": " "})["isError"], true)
    end

    test("create_score saves what the engraver reads into the account, and refuses the rest") do
      user = mcp_user()
      token = mcp_token(user)
      made = mcp_call(token, "create_score", {"source": MCP_SOURCE})
      assert_eq(made["isError"], false)
      score = Score.find(made["structuredContent"]["id"])
      assert_eq(score.user_id, user._key)
      assert_eq(score.title, "Little tune")
      assert_eq(score.source, MCP_SOURCE)
      assert_contains(made["structuredContent"]["url"], "/app/scores/#{score._key}")
      titled = mcp_call(token, "create_score", {
        "source": "{ c'1 }",
        "title": "Named"
      })
      assert_eq(Score.find(titled["structuredContent"]["id"]).title, "Named")
      blank = mcp_call(token, "create_score", {"title": "Empty one"})
      assert_eq(Score.find(blank["structuredContent"]["id"]).title, "Empty one")
      count_before = Score.where({"user_id": user._key}).count
      refused = mcp_call(token, "create_score", {"source": "{ c'4 \\nosuchcommand }"})
      assert_eq(refused["isError"], true)
      assert_contains(refused["content"][0]["text"], "Not created")
      assert_eq(Score.where({"user_id": user._key}).count, count_before)
    end

    test("list_scores and get_score read the account's scores, never another's") do
      user = mcp_user()
      token = mcp_token(user)
      mine = Score.start(user, MCP_SOURCE)
      theirs = Score.start(mcp_user(), "\\header { title = \"Not yours\" }\n{ c'1 }\n")
      listed = mcp_call(token, "list_scores", {})
      ids = listed["structuredContent"]["scores"].map do |row|
        row["id"]
      end
      assert(ids.includes?(mine._key))
      assert_not(ids.includes?(theirs._key))
      found = mcp_call(token, "list_scores", {"query": "little"})
      assert_eq(found["structuredContent"]["scores"].length, 1)
      assert_eq(
        mcp_call(token, "list_scores", {"query": "nothing like it"})["content"][0]["text"],
        "No score matches."
      )
      read = mcp_call(token, "get_score", {"id": mine._key})
      assert_eq(read["structuredContent"]["source"], MCP_SOURCE)
      assert_eq(read["structuredContent"]["writable"], true)
      assert_eq(read["structuredContent"]["revision"], mine.revision)
      other = mcp_call(token, "get_score", {"id": theirs._key})
      assert_eq(other["isError"], true)
      assert_not(other["content"][0]["text"].contains("Not yours"), "nothing of it said")
      assert_eq(mcp_call(token, "get_score", {"id": "no-such"})["isError"], true)
    end

    test("update_score writes a new revision, refuses a stale one, the engraver's refusals, and others' scores") do
      user = mcp_user()
      token = mcp_token(user)
      score = Score.start(user, MCP_SOURCE)
      revision = Score.find(score._key).revision
      changed = MCP_SOURCE.replace("f'2.", "g'2.")
      saved = mcp_call(token, "update_score", {
        "id": score._key,
        "source": changed,
        "revision": revision
      })
      assert_eq(saved["isError"], false)
      assert_eq(Score.find(score._key).source, changed)
      assert_ne(saved["structuredContent"]["revision"], revision)
      stale = mcp_call(token, "update_score", {
        "id": score._key,
        "source": MCP_SOURCE,
        "revision": revision
      })
      assert_eq(stale["isError"], true)
      assert_contains(stale["content"][0]["text"], "changed since")
      assert_eq(Score.find(score._key).source, changed, "nothing written over the newer one")
      broken = mcp_call(token, "update_score", {
        "id": score._key,
        "source": "{ c'4 \\nosuchcommand }"
      })
      assert_eq(broken["isError"], true)
      assert_eq(Score.find(score._key).source, changed)
      theirs = Score.start(mcp_user(), MCP_SOURCE)
      assert_eq(mcp_call(token, "update_score", {
        "id": theirs._key,
        "source": changed
      })["isError"], true)
      assert_eq(Score.find(theirs._key).source, MCP_SOURCE)
    end

    test("transcribe_image needs the account's AI key; get_transcription follows a reading and saves it") do
      user = mcp_user()
      token = mcp_token(user)
      refused = mcp_call(token, "transcribe_image", {"image_base64": "aGVsbG8="})
      assert_eq(refused["isError"], true)
      assert_contains(refused["content"][0]["text"], "Account › AI")
      assert_eq(ScoreReading.where({"user_id": user._key}).count, 0, "nothing started")
      reading = ScoreReading.create({
        "user_id": user._key,
        "state": "done",
        "source": MCP_SOURCE,
        "created_at": DateTime.utc.to_unix
      })
      read = mcp_call(token, "get_transcription", {"reading_id": reading._key})
      assert_eq(read["structuredContent"]["state"], "done")
      assert_eq(read["structuredContent"]["source"], MCP_SOURCE)
      count_before = Score.where({"user_id": user._key}).count
      saved = mcp_call(token, "get_transcription", {
        "reading_id": reading._key,
        "create_score": true
      })
      assert_eq(Score.where({"user_id": user._key}).count, count_before + 1)
      assert_eq(Score.find(saved["structuredContent"]["id"]).source, MCP_SOURCE)
      pending = ScoreReading.create({
        "user_id": user._key,
        "state": "reading",
        "created_at": DateTime.utc.to_unix
      })
      assert_eq(
        mcp_call(token, "get_transcription", {"reading_id": pending._key})["structuredContent"]["state"],
        "reading"
      )
      failed = ScoreReading.create({
        "user_id": user._key,
        "state": "failed",
        "error": "unreadable",
        "created_at": DateTime.utc.to_unix
      })
      assert_contains(
        mcp_call(token, "get_transcription", {"reading_id": failed._key})["content"][0]["text"],
        "unreadable"
      )
      # A reading with no news for minutes: its job is gone, said at once (#463).
      silent = ScoreReading.create({
        "user_id": user._key,
        "state": "reading",
        "created_at": DateTime.utc.to_unix - 900,
        "progressed_at": DateTime.utc.to_unix - 300
      })
      gone = mcp_call(token, "get_transcription", {"reading_id": silent._key})
      assert_eq(gone["isError"], true)
      assert_contains(gone["content"][0]["text"], "interrupted")
      assert_eq(ScoreReading.find(silent._key).state, "failed")
      alive = ScoreReading.create({
        "user_id": user._key,
        "state": "reading",
        "created_at": DateTime.utc.to_unix - 900,
        "progressed_at": DateTime.utc.to_unix - 5
      })
      assert_eq(
        mcp_call(token, "get_transcription", {"reading_id": alive._key})["structuredContent"]["state"],
        "reading",
        "long, but still going"
      )
      theirs = ScoreReading.create({
        "user_id": mcp_user()._key,
        "state": "done",
        "source": MCP_SOURCE,
        "created_at": DateTime.utc.to_unix
      })
      assert_eq(mcp_call(token, "get_transcription", {"reading_id": theirs._key})["isError"], true)
    end
  end

  describe("the account's tokens") do
    test("made on the account page and shown once, listed by name, revoked") do
      user = mcp_user()
      mcp_sign_in(user)
      made = post("/app/account/tokens", {"name": "Claude Code"})
      assert_eq(res_status(made), 200)
      body = res_body(made)
      record = AccessToken.where({"user_id": user._key}).first
      assert_contains(body, "claude mcp add --transport http score")
      assert_contains(
        res_body(get("/app/account")),
        "href=\"/claude\"",
        "the account page points to the guide (#464)"
      )
      assert_contains(body, "/mcp")
      secret = body.split("<code>score_")[1].split("</code>")[0]
      assert_eq(Crypto.sha256("score_" + secret), record.digest, "the token shown is the one kept")
      again = res_body(get("/app/account"))
      assert_contains(again, "Claude Code")
      assert_not(again.contains(secret), "never shown again")
      assert_eq(res_status(post("/app/account/tokens", {"name": ""})), 422)
      revoked = post("/app/account/tokens/#{record._key}/revoke", {})
      assert_eq(res_status(revoked), 302)
      assert_null(AccessToken.where({"_key": record._key}).first)
    end

    test("refused: a guest, and another person's token") do
      owner = mcp_user()
      AccessToken.issue(owner, "Theirs")
      record = AccessToken.where({"user_id": owner._key}).first
      as_guest()
      count_before = AccessToken.count
      guest = res_status(post("/app/account/tokens", {"name": "x"}))
      assert([302, 401].includes?(guest), "sent to sign in, or refused: #{guest}")
      assert_eq(AccessToken.count, count_before, "no token made")
      mcp_sign_in(mcp_user())
      assert_eq(res_status(post("/app/account/tokens/#{record._key}/revoke", {})), 404)
      assert_not_null(AccessToken.where({"_key": record._key}).first, "still there")
    end

    test("go with the account") do
      user = mcp_user()
      AccessToken.issue(user, "Client")
      user.erase_account
      assert_eq(AccessToken.where({"user_id": user._key}).count, 0)
    end
  end
end
