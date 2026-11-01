# What the server engraves, and how often (#540): a source past the
# engraver's own limits (EngraverLimit) is refused wherever it is saved —
# the editor, the MCP tools, a shared section — with nothing written; one
# stored before them is refused as the engraver reads it, in milliseconds; a read page's PDF is
# printed once, then read back; the engravings a sender may have made — made,
# not read back — are so many a minute; and an MCP batch counts each of its
# messages.

const LIMITS_PASSWORD = "correct horse battery"
# 80 characters that write out to 262,144 notes.
const LIMITS_BOMB = "{ \\repeat unfold 64 { \\repeat unfold 64 { \\repeat unfold 16 { c4 d e f } } } }"
# What the engraver says of it, in the app's language.
const LIMITS_SAID = "security_540.limits.notes"
const LIMITS_SOURCE = "\\header { title = \"Little tune\" }\n\\new Staff { \\time 3/4 c'4 d' e' | f'2. }\n"

def limits_user
  user = User.new()
  user.email = "limits-#{uuid_v4}@example.com"
  user.name = "Limits"
  user.set_password(LIMITS_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

def limits_sign_in(user)
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": LIMITS_PASSWORD}
  )
end

# A score of `user`'s, open by link, whose stored source is `source`, written past the
# validations, as one saved before the bound would be.
def limits_stored(user, source)
  score = Score.start(user, Score.blank_source("Stored"))
  Score.where("doc._key == @key", {"key": score._key}).update_all({
    "source": source,
    "visibility": "link"
  })
  Score.find(score._key)
end

def limits_mcp(token, message)
  clear_headers()
  set_header("Content-Type", "application/json")
  set_header("Authorization", "Bearer " + token)
  response = post("/mcp", message.to_json)
  clear_headers()
  response
end

def limits_tool(id, name, arguments)
  {
    "jsonrpc": "2.0",
    "id": id,
    "method": "tools/call",
    "params": {"name": name, "arguments": arguments}
  }
end

def limits_pings(count)
  (0 .. count).map do |n|
    {
      "jsonrpc": "2.0",
      "id": n + 1,
      "method": "ping"
    }
  end
end

# A bomb of the reviews (tests/fixtures/bombs).
def limits_bomb(name)
  File.read("tests/fixtures/bombs/#{name}.ly")
end

def limits_scores(user)
  Score.where({"user_id": user._key}).count
end

# `user`'s score, its stored source changed to a new one: the next engraving
# of it is made, not read back.
def limits_renewed(score)
  Score.where("doc._key == @key", {"key": score._key}).update_all({"source": Score.blank_source("Renewed #{uuid_v4}")})
end

describe("Engraving limits (#540)") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  describe("a source past the engraver's limits") do
    test("is refused from the editor, and nothing is written") do
      owner = limits_user()
      score = Score.start(owner, Score.blank_source("Calm"))
      limits_sign_in(owner)
      refused = put(
        "/app/scores/#{score._key}",
        {"source": LIMITS_BOMB, "revision": score.revision}
      )
      assert_eq(res_status(refused), 422)
      assert_eq(
        res_json(refused)["error"],
        SiteText.t("security_540.not_saved", {"why": SiteText.t(LIMITS_SAID) + " (at character 2)"}),
        "the engraver's, said"
      )
      assert_contains(res_json(refused)["error"], "20,000")
      ["keys", "scheme", "ledgers", "variables"].each do |name|
        bomb = put(
          "/app/scores/#{score._key}",
          {"source": limits_bomb(name), "revision": score.revision}
        )
        assert_eq(res_status(bomb), 422, name)
        assert(res_json(bomb)["error"].starts_with?("Not saved: "), name)
      end
      stored = Score.find(score._key)
      assert_eq(stored.revision, score.revision)
      assert_contains(stored.source, "r1")
      within = put(
        "/app/scores/#{score._key}",
        {"source": "\\header { title = \"Calm\" }\n{ \\repeat unfold 8 { c'4 d' e' f' } }", "revision": score.revision}
      )
      assert_eq(res_status(within), 200, "a repeat within the bound is saved")
    end

    test("is refused by the MCP tools in the engraver's words, and nothing is created or changed") do
      owner = limits_user()
      token = AccessToken.issue(owner, "Spec client")["token"]
      kept = Score.start(owner, LIMITS_SOURCE)
      before = limits_scores(owner)
      created = res_json(limits_mcp(token, limits_tool(1, "create_score", {"source": LIMITS_BOMB})))["result"]
      updated = res_json(limits_mcp(token, limits_tool(2, "update_score", {
        "id": kept._key,
        "source": LIMITS_BOMB
      })))["result"]
      checked = res_json(limits_mcp(token, limits_tool(3, "check_source", {"source": LIMITS_BOMB})))["result"]
      said = "this music writes out to more than 20,000 notes; the engraver stops there"
      assert(created["isError"])
      assert_contains(created["content"][0]["text"], "Not created")
      assert_contains(created["content"][0]["text"], said)
      assert(updated["isError"])
      assert_contains(updated["content"][0]["text"], said)
      assert(checked["isError"])
      assert_contains(checked["content"][0]["text"], said)
      assert_contains(
        Engraving.find(ScoreSvg.file_digest("check", "", LIMITS_BOMB)).error,
        said,
        "its answer kept: asked again, it is read back"
      )
      scheme = res_json(limits_mcp(token, limits_tool(5, "check_source", {"source": limits_bomb("scheme")})))["result"]
      assert(scheme["isError"])
      assert_contains(scheme["content"][0]["text"], "more than 64 deep")
      assert_eq(limits_scores(owner), before)
      assert_eq(Score.find(kept._key).source, LIMITS_SOURCE)
      fine = res_json(limits_mcp(token, limits_tool(4, "create_score", {"source": LIMITS_SOURCE})))["result"]
      assert_not(fine["isError"] ?? false)
      assert_eq(limits_scores(owner), before + 1)
    end

    test("is refused as a shared section, and nothing is published") do
      author = limits_user()
      limits_sign_in(author)
      fields = {
        "title": "Bomb strum",
        "description": "",
        "instrument": "guitar",
        "style": "waltz",
        "time": "3/4",
        "key": "G major",
        "bpm": 96,
        "bars": 2,
        "tracks": 1,
        "section": {"bars": 2, "parts": [{
          "offset": 0,
          "voice": 1,
          "pieces": [{"ticks": 6720, "content": {"rest": true}}]
        }]},
        "source": LIMITS_BOMB
      }
      response = post("/app/sections", fields)
      assert_eq(res_status(response), 422)
      assert_contains(res_json(response)["error"], SiteText.t(LIMITS_SAID))
      fields["source"] = limits_bomb("voices")
      assert_eq(res_status(post("/app/sections", fields)), 422)
      assert_eq(SharedSection.where({"user_id": author._key}).count, 0)
    end
  end

  describe("a source stored before the limits") do
    test("its read page, PDF and preview answer the engraver's refusal, fast") do
      owner = limits_user()
      score = limits_stored(owner, LIMITS_BOMB)
      refused = SiteText.t(LIMITS_SAID) + " (at character 2)"
      words = "score: this music writes out to more than 20,000 notes; the engraver stops there (at character 2)"
      clear_cookies()
      started = clock()
      page = get("/s/#{score.share_token}")
      pdf = get("/s/#{score.share_token}/score.pdf")
      assert_lt(clock() - started, 2.0, "refused as it is read, not engraved")
      assert_eq(res_status(page), 200)
      assert_contains(res_body(page), refused)
      assert_eq(Engraving.find(ScoreSvg.digest(LIMITS_BOMB, 1040, 7, 0, {})).error, words)
      assert_eq(res_status(pdf), 422)
      assert_eq(res_body(pdf), refused)
      limits_sign_in(owner)
      preview = get("/app/scores/#{score._key}/preview.svg")
      assert_eq(res_status(preview), 200)
      assert_contains(res_body(preview), "width=\"1\"")
      assert_eq(Engraving.find(ScoreSvg.digest(LIMITS_BOMB, 560, 5.5, 230, {})).error, words)
      each_bomb = limits_stored(owner, limits_bomb("trills"))
      clear_cookies()
      assert_eq(res_status(get("/s/#{each_bomb.share_token}/score.pdf")), 422)
    end

    test("a section's MIDI is refused, not written") do
      author = limits_user()
      section = SharedSection.create({
        "user_id": author._key,
        "title": "Old bomb",
        "description": "",
        "instrument": "guitar",
        "style": "waltz",
        "time": "3/4",
        "key": "G major",
        "bpm": 96,
        "bars": 2,
        "tracks": 1,
        "section": {"bars": 2, "parts": []},
        "source": LIMITS_BOMB,
        "rating_count": 0,
        "rating_total": 0,
        "hidden": false,
        "created_at": DateTime.utc.to_unix
      })
      midi = get("/sections/#{section._key}/play.mid")
      assert_eq(res_status(midi), 422)
      kept = Engraving.find(ScoreSvg.file_digest("midi", 96, LIMITS_BOMB))
      assert_null(kept.file, "never written")
      assert_contains(kept.error, "the engraver stops there", "the refusal kept: asked again, read back")
    end
  end

  describe("the read page's PDF") do
    test("is printed once, then read back from what was kept") do
      owner = limits_user()
      score = Score.start(owner, Score.blank_source("Printed #{uuid_v4}"))
      score.make_visible("link")
      clear_cookies()
      path = "/s/#{score.share_token}/score.pdf"
      first = get(path)
      assert_eq(res_status(first), 200)
      assert(res_body(first).starts_with?("%PDF"))
      digest = ScoreSvg.file_digest("pdf", score.title, score.source)
      assert_not_null(Engraving.find_by("_key", digest), "kept")
      Engraving.upsert(
        digest,
        {
          "file": "%PDF kept",
          "error": nil,
          "created_at": DateTime.utc.to_unix
        }
      )
      again = get(path)
      assert_eq(res_status(again), 200)
      assert_eq(res_body(again), "%PDF kept")
    end

    test("reads back the very PDF it printed, byte for byte") do
      owner = limits_user()
      score = Score.start(owner, Score.blank_source("Bytes #{uuid_v4}"))
      score.make_visible("link")
      clear_cookies()
      path = "/s/#{score.share_token}/score.pdf"
      first = get(path)
      kept = Engraving.find(ScoreSvg.file_digest("pdf", score.title, score.source))
      assert_eq(kept.file, res_body(first))
      again = get(path)
      assert_eq(res_body(again), res_body(first))
      assert_eq(res_body(again).length, kept.bytes)
    end
  end

  describe("so many engravings a minute, made and not read back") do
    test("a reader's PDFs: those read back are not counted; the one made past the limit answers 429") do
      owner = limits_user()
      score = Score.start(owner, Score.blank_source("Often"))
      limits_sign_in(owner)
      path = "/s/#{score.share_token}/score.pdf"
      (0 .. ENGRAVINGS_PER_MINUTE["pdf"] + 5).each do |n|
        assert_eq(res_status(get(path)), 200, "PDF read back #{n + 1}")
      end
      (0 .. ENGRAVINGS_PER_MINUTE["pdf"] - 1).each do |n|
        limits_renewed(score)
        assert_eq(res_status(get(path)), 200, "PDF made #{n + 2}")
      end
      limits_renewed(score)
      refused = get(path)
      assert_eq(res_status(refused), 429)
      assert_eq(res_header(refused, "Retry-After"), "60")
      assert_contains(res_body(refused), "Too many engravings")
      stored = Score.find(score._key)
      assert_null(
        Engraving.find_by("_key", ScoreSvg.file_digest("pdf", stored.title, stored.source)),
        "nothing printed"
      )
      other = limits_user()
      other_score = Score.start(other, Score.blank_source("Other #{uuid_v4}"))
      limits_sign_in(other)
      assert_eq(res_status(get("/s/#{other_score.share_token}/score.pdf")), 200, "another account is counted apart")
    end

    test("a library's previews: past the limit, a blank picture with a 429") do
      owner = limits_user()
      score = Score.start(owner, Score.blank_source("Cards"))
      limits_sign_in(owner)
      path = "/app/scores/#{score._key}/preview.svg"
      (0 .. ENGRAVINGS_PER_MINUTE["preview"] + 5).each do |n|
        assert_eq(res_status(get(path)), 200, "preview read back #{n + 1}")
      end
      (0 .. ENGRAVINGS_PER_MINUTE["preview"] - 1).each do |n|
        limits_renewed(score)
        assert_eq(res_status(get(path)), 200, "preview made #{n + 2}")
      end
      limits_renewed(score)
      refused = get(path)
      assert_eq(res_status(refused), 429)
      assert_eq(res_header(refused, "Content-Type"), "image/svg+xml")
      assert_eq(res_header(refused, "Retry-After"), "60")
      assert(res_body(refused).starts_with?("<svg "))
    end

    # Signed in, so the address the other specs read from stays free: the
    # limit of an address signed out is ScoreSvg's own spec
    # (tests/services/engraver_limit_spec.sl), the same sender either way.
    test("a read page: a reader is held to so many pictures made a minute") do
      owner = limits_user()
      score = Score.start(owner, Score.blank_source("Read"))
      score.make_visible("link")
      limits_sign_in(limits_user())
      path = "/s/#{score.share_token}"
      (0 .. ENGRAVINGS_PER_MINUTE["page"] + 5).each do |n|
        assert_eq(res_status(get(path)), 200, "page read back #{n + 1}")
      end
      # A picture and its MIDI file made each time.
      (0 .. ENGRAVINGS_PER_MINUTE["page"] / 2 - 1).each do |n|
        limits_renewed(score)
        assert_eq(res_status(get(path)), 200, "page made #{n + 2}")
      end
      limits_renewed(score)
      refused = get(path)
      assert_eq(res_status(refused), 429)
      assert_eq(res_header(refused, "Retry-After"), "60")
      assert_contains(res_body(refused), "Too many engravings")
    end

    test("the editor: an account is held to so many pictures made a minute") do
      owner = limits_user()
      score = Score.start(owner, Score.blank_source("Edited"))
      limits_sign_in(owner)
      path = "/app/scores/#{score._key}"
      (0 .. ENGRAVINGS_PER_MINUTE["page"] / 2).each do |n|
        limits_renewed(score)
        assert_eq(res_status(get(path)), 200, "editor #{n + 1}")
      end
      limits_renewed(score)
      refused = get(path)
      assert_eq(res_status(refused), 429)
      assert_eq(res_header(refused, "Retry-After"), "60")
    end

    test("an MCP client: so many sources checked a minute; one checked again is read back") do
      owner = limits_user()
      token = AccessToken.issue(owner, "Spec client")["token"]
      checked = res_json(limits_mcp(token, limits_tool(1, "check_source", {"source": LIMITS_SOURCE})))["result"]
      assert_not(checked["isError"] ?? false)
      (0 .. ENGRAVINGS_PER_MINUTE["mcp"]).each do |n|
        source = LIMITS_SOURCE + "% #{n} #{uuid_v4}\n"
        answer = res_json(limits_mcp(token, limits_tool(n + 2, "check_source", {"source": source})))["result"]
        assert_not(answer["isError"] ?? false, "check #{n + 2}")
      end
      held = res_json(limits_mcp(token, limits_tool(99, "check_source", {"source": LIMITS_SOURCE
      + "% #{uuid_v4}\n"})))["result"]
      assert(held["isError"])
      assert_contains(held["content"][0]["text"], "Too many engravings")
      before = limits_scores(owner)
      created = res_json(limits_mcp(
        token,
        limits_tool(100, "create_score", {"source": LIMITS_SOURCE + "% #{uuid_v4}\n"})
      ))["result"]
      assert(created["isError"])
      assert_contains(created["content"][0]["text"], "Too many engravings")
      assert_eq(limits_scores(owner), before, "nothing created")
      again = res_json(limits_mcp(token, limits_tool(101, "check_source", {"source": LIMITS_SOURCE})))["result"]
      assert_not(again["isError"] ?? false, "a source checked before is read back, not counted")
    end

    test("an MCP tool reads the bounds first: a source too long is never laid out, nor counted") do
      owner = limits_user()
      long = "{ " + "c'4 " * 250001 + "}"
      created = ScoreMcp.create_score(owner, {"source": long})
      assert(created["isError"])
      assert_contains(created["content"][0]["text"], "a million characters at most")
      checked = ScoreMcp.check_source(owner, {"source": long})
      assert(checked["isError"])
      assert_null(Engraving.find_by("_key", ScoreSvg.file_digest("check", "", long)), "never laid out")
      assert_eq(limits_scores(owner), 0)
      fine = ScoreMcp.create_score(owner, {"source": LIMITS_SOURCE + "% create #{uuid_v4}\n"})
      assert_not(fine["isError"] ?? false)
      assert_eq(limits_scores(owner), 1)
    end
  end

  describe("an MCP batch") do
    test("that is empty is one invalid request, answered once") do
      owner = limits_user()
      token = AccessToken.issue(owner, "Spec client")["token"]
      response = limits_mcp(token, [])
      assert_eq(res_status(response), 400)
      answer = res_json(response)
      assert_eq(type(answer), "hash", "one answer, not a batch of them")
      assert_eq(answer["error"]["code"], -32600)
      assert_null(answer["id"])
    end

    test("of more than 20 messages is refused whole, and runs none of them") do
      owner = limits_user()
      token = AccessToken.issue(owner, "Spec client")["token"]
      batch = (0 .. 21).map do |n|
        limits_tool(n + 1, "create_score", {"source": LIMITS_SOURCE})
      end
      response = limits_mcp(token, batch)
      assert_eq(res_status(response), 400)
      assert_eq(res_json(response)["error"]["code"], -32600)
      assert_eq(limits_scores(owner), 0)
    end

    test("counts each of its messages against the limit: six of 20 spend the minute's 120") do
      owner = limits_user()
      token = AccessToken.issue(owner, "Spec client")["token"]
      (0 .. 6).each do |n|
        answered = limits_mcp(token, limits_pings(20))
        assert_eq(res_status(answered), 200, "batch #{n + 1}")
        assert_eq(res_json(answered).length, 20)
        assert_null(res_json(answered)[19]["error"])
      end
      held = limits_mcp(
        token,
        {
          "jsonrpc": "2.0",
          "id": 1,
          "method": "ping"
        }
      )
      assert_eq(res_status(held), 429)
      assert_eq(res_header(held, "Retry-After"), "60")
      assert_eq(res_status(limits_mcp(token, limits_pings(2))), 429, "a batch too")
    end

    test("runs the messages within the limit, and answers the others too many, not run") do
      owner = limits_user()
      token = AccessToken.issue(owner, "Spec client")["token"]
      (0 .. 5).each do |_|
        limits_mcp(token, limits_pings(20))
      end
      limits_mcp(token, limits_pings(15))
      creates = (0 .. 10).map do |n|
        limits_tool(n + 1, "create_score", {"source": LIMITS_SOURCE})
      end
      creates.push({"jsonrpc": "2.0", "method": "notifications/initialized"})
      answers = res_json(limits_mcp(token, creates))
      assert_eq(answers.length, 10, "the notification is not answered")
      refused = answers.filter do |answer|
        !answer["error"].nil?
      end
      assert_eq(refused.length, 5)
      assert_eq(refused[0]["error"]["code"], -32000)
      assert_eq(refused[0]["id"], 6)
      assert_eq(limits_scores(owner), 5)
    end
  end
end
