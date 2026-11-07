# Signing in to the MCP server from its client (#461): Score's OAuth 2.1
# server, run as an MCP client does — the metadata, a registration, the
# authorization with PKCE (signing in first when need be), the consent, the
# code traded for tokens, /mcp with them, a refresh, a revocation — and
# each step refused when it should be, with nothing given.

const OAUTH_PASSWORD = "correct horse battery"
const OAUTH_REDIRECT = "http://127.0.0.1:33418/callback"
const OAUTH_VERIFIER = "spec-verifier-0123456789-abcdefghijklmnopqrstuvwxyz"

def oauth_user
  user = User.new()
  user.email = "oauth-#{uuid_v4}@example.com"
  user.set_password(OAUTH_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

def oauth_sign_in(user, return_to = "")
  clear_cookies()
  post(
    "/login",
    {
      "email": user.email,
      "password": OAUTH_PASSWORD,
      "return_to": return_to
    }
  )
end

def oauth_json(path, body)
  clear_headers()
  set_header("Content-Type", "application/json")
  response = post(path, body.to_json)
  clear_headers()
  response
end

def oauth_challenge(verifier)
  Base64.urlsafe_encode(Hex.decode(Crypto.sha256(verifier)))
end

def oauth_register(name = "Claude Code")
  res_json(oauth_json(
    "/oauth/register",
    {"client_name": name, "redirect_uris": [OAUTH_REDIRECT]}
  ))["client_id"]
end

def oauth_authorize_path(client_id, extra = "")
  "/oauth/authorize?response_type=code&client_id=" + client_id + "&redirect_uri=" + url(OAUTH_REDIRECT)
  + "&code_challenge="
  + oauth_challenge(OAUTH_VERIFIER)
  + "&code_challenge_method=S256&state=st4te"
  + extra
end

# The value of `name` in the query of `location`.
def oauth_param(location, name)
  parts = location.to_s.split(name + "=")
  return nil if parts.length < 2

  parts[1].split("&")[0]
end

# The answer to the consent page on show, with the request id it carries.
def oauth_decide(decision)
  get("/app/oauth/consent")
  post(
    "/app/oauth/consent",
    {"decision": decision, "request_id": assigns()["request_id"]}
  )
end

# A signed-in person's approval of `client_id`: the code sent back.
def oauth_code_for(user, client_id, extra = "")
  oauth_sign_in(user)
  get(oauth_authorize_path(client_id, extra))
  oauth_param(res_location(oauth_decide("allow")), "code")
end

# Form-encoded, as an OAuth client sends it (RFC 6749): not JSON.
def oauth_exchange(client_id, code, verifier = OAUTH_VERIFIER)
  clear_headers()
  post(
    "/oauth/token",
    {
      "grant_type": "authorization_code",
      "code": code,
      "client_id": client_id,
      "redirect_uri": OAUTH_REDIRECT,
      "code_verifier": verifier
    }
  )
end

def oauth_mcp(token)
  clear_headers()
  set_header("Content-Type", "application/json")
  set_header("Authorization", "Bearer " + token)
  response = post("/mcp", {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {"name": "list_scores", "arguments": {}}
  }.to_json)
  clear_headers()
  response
end

describe("Signing in from an MCP client") do
  before_each() do
    as_guest()
    clear_headers()
    clear_cookies()
  end

  test("the 401 from /mcp says where to sign in, and the metadata says how") do
    missing = oauth_json(
      "/mcp",
      {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize"
      }
    )
    assert_eq(res_status(missing), 401)
    assert_contains(res_header(missing, "WWW-Authenticate"), "resource_metadata=")
    assert_contains(res_header(missing, "WWW-Authenticate"), "/.well-known/oauth-protected-resource")
    resource = res_json(get("/.well-known/oauth-protected-resource"))
    assert(resource["resource"].ends_with?("/mcp"))
    assert_eq(res_json(get("/.well-known/oauth-protected-resource/mcp"))["resource"], resource["resource"])
    server = res_json(get("/.well-known/oauth-authorization-server"))
    assert_eq(server["issuer"], resource["authorization_servers"][0])
    assert(server["authorization_endpoint"].ends_with?("/oauth/authorize"))
    assert_eq(server["code_challenge_methods_supported"], ["S256"])
    assert_eq(server["token_endpoint_auth_methods_supported"], ["none"])
  end

  test("a client registers itself with loopback or https redirects; others are refused, nothing saved") do
    made = oauth_json(
      "/oauth/register",
      {"client_name": "Claude Code", "redirect_uris": [OAUTH_REDIRECT]}
    )
    assert_eq(res_status(made), 201)
    assert(res_json(made)["client_id"].starts_with?("score_oc_"))
    assert_eq(res_status(oauth_json("/oauth/register", {"redirect_uris": ["https://app.example.com/cb"]})), 201)
    count_before = OauthClient.count
    ["http://evil.example/cb", "https://ok.example/cb#frag", "javascript:alert(1)"].each do |uri|
      refused = oauth_json("/oauth/register", {"redirect_uris": [uri]})
      assert_eq(res_status(refused), 400, uri)
      assert_eq(res_json(refused)["error"], "invalid_redirect_uri")
    end
    assert_eq(res_status(oauth_json("/oauth/register", {"redirect_uris": []})), 400)
    secret = oauth_json(
      "/oauth/register",
      {"redirect_uris": [OAUTH_REDIRECT], "token_endpoint_auth_method": "client_secret_post"}
    )
    assert_eq(res_json(secret)["error"], "invalid_client_metadata")
    assert_eq(OauthClient.count, count_before)
  end

  test("signed out: sent to sign in, then back to the consent page; allowed, a code goes back with the state") do
    user = oauth_user()
    client_id = oauth_register()
    asked = get(oauth_authorize_path(client_id))
    assert_eq(res_location(asked), "/app/oauth/consent")
    gate = get("/app/oauth/consent")
    assert_eq(res_location(gate), "/login?return_to=" + url("/app/oauth/consent"))
    signed = post(
      "/login",
      {
        "email": user.email,
        "password": OAUTH_PASSWORD,
        "return_to": "/app/oauth/consent"
      }
    )
    assert_eq(res_location(signed), "/app/oauth/consent")
    page = get("/app/oauth/consent")
    assert_eq(res_status(page), 200)
    assert_contains(
      res_body(page),
      "An app on this computer wants to reach your scores, calling itself “Claude Code”"
    )
    assert_contains(res_body(page), "127.0.0.1:33418")
    decided = post(
      "/app/oauth/consent",
      {"decision": "allow", "request_id": assigns()["request_id"]}
    )
    location = res_location(decided)
    assert(location.starts_with?(OAUTH_REDIRECT + "?"))
    assert_eq(oauth_param(location, "state"), "st4te")
    assert_not_null(oauth_param(location, "code"))
  end

  test("the code traded for tokens that reach the account's scores, once, with its verifier only") do
    user = oauth_user()
    Score.start(user, "\\header { title = \"Through OAuth\" }\n{ c'1 }\n")
    client_id = oauth_register()
    code = oauth_code_for(user, client_id)
    wrong = oauth_exchange(client_id, code, "another-verifier-0123456789-abcdefghijklmnopqrstuvwxyz")
    assert_eq(res_json(wrong)["error"], "invalid_grant", "a wrong verifier, and the code is spent")
    code = oauth_code_for(user, client_id)
    assert_eq(res_json(oauth_exchange(oauth_register("Other"), code))["error"], "invalid_grant", "another client's")
    code = oauth_code_for(user, client_id)
    tokens = res_json(oauth_exchange(client_id, code))
    assert_eq(tokens["token_type"], "Bearer")
    assert_eq(tokens["expires_in"], 3600)
    assert_eq(res_json(oauth_exchange(client_id, code))["error"], "invalid_grant", "never twice")
    listed = res_json(oauth_mcp(tokens["access_token"]))["result"]["structuredContent"]["scores"]
    assert_eq(listed.map(&{ |row|
      row["title"]
    }), ["Through OAuth"], "this account's scores, and its only")
    connection = AccessToken.where({
      "user_id": user._key,
      "kind": "oauth"
    }).first
    assert_eq(connection.name, "Claude Code")
    oauth_sign_in(user)
    assert_contains(res_body(get("/app/account")), "Claude Code")
  end

  test("a refresh gives a new pair, the old ones stop; a revocation ends it; an hour-old token is refused") do
    user = oauth_user()
    client_id = oauth_register()
    tokens = res_json(oauth_exchange(client_id, oauth_code_for(user, client_id)))
    renewed = res_json(oauth_json(
      "/oauth/token",
      {
        "grant_type": "refresh_token",
        "refresh_token": tokens["refresh_token"],
        "client_id": client_id
      }
    ))
    assert_ne(renewed["access_token"], tokens["access_token"])
    assert_eq(res_status(oauth_mcp(tokens["access_token"])), 401, "the old access token")
    assert_eq(res_status(oauth_mcp(renewed["access_token"])), 200)
    other = oauth_json(
      "/oauth/token",
      {
        "grant_type": "refresh_token",
        "refresh_token": renewed["refresh_token"],
        "client_id": "score_oc_other"
      }
    )
    assert_eq(res_json(other)["error"], "invalid_grant", "another client's refresh")
    connection = AccessToken.where({
      "user_id": user._key,
      "kind": "oauth"
    }).first
    connection.expires_at = DateTime.utc.to_unix - 1
    connection.update()
    assert_eq(res_status(oauth_mcp(renewed["access_token"])), 401, "past its hour")
    connection.expires_at = DateTime.utc.to_unix + 3600
    connection.update()
    assert_eq(res_status(oauth_json(
      "/oauth/revoke",
      {"token": renewed["access_token"], "client_id": client_id}
    )), 200)
    assert_eq(res_status(oauth_mcp(renewed["access_token"])), 401, "revoked")
    assert_eq(AccessToken.where({
      "user_id": user._key,
      "kind": "oauth"
    }).count, 0)
    # The old refresh token is refused too: presented while the connection
    # lived, it revokes it (#541, below).
    stale = oauth_refresh(tokens["refresh_token"], client_id)
    assert_eq(res_json(stale)["error"], "invalid_grant", "the old refresh token")
  end

  test("refused: denied, an unknown client or redirect, no PKCE, another scope; no code without consent") do
    user = oauth_user()
    client_id = oauth_register()
    oauth_sign_in(user)
    get(oauth_authorize_path(client_id))
    denied = oauth_decide("deny")
    assert_eq(oauth_param(res_location(denied), "error"), "access_denied")
    assert_null(oauth_param(res_location(denied), "code"))
    assert_eq(res_status(get(oauth_authorize_path("score_oc_nobody"))), 400)
    elsewhere = "/oauth/authorize?response_type=code&client_id=" + client_id + "&redirect_uri="
    + url("https://evil.example/cb")
    assert_eq(res_status(get(elsewhere)), 400, "never sent to an address the client did not register")
    no_pkce = "/oauth/authorize?response_type=code&client_id=" + client_id + "&redirect_uri="
    + url(OAUTH_REDIRECT)
    + "&state=s"
    # Told on a page, never by a redirect (#687, below).
    malformed = get(no_pkce)
    assert_eq(res_status(malformed), 400)
    assert_null(res_location(malformed))
    assert_contains(res_body(malformed), "data-oauth-error=\"invalid_request\"")
    other_scope = get(oauth_authorize_path(client_id, "&scope=admin"))
    assert_eq(res_status(other_scope), 400)
    assert_null(res_location(other_scope))
    assert_contains(res_body(other_scope), "data-oauth-error=\"invalid_scope\"")
    assert_eq(res_status(get("/app/oauth/consent")), 400, "nothing parked by a request refused")
    assert_eq(res_status(post("/app/oauth/consent", {"decision": "allow"})), 400, "nothing pending: no code")
    assert_eq(res_json(oauth_json("/oauth/token", {"grant_type": "password"}))["error"], "unsupported_grant_type")
    assert_eq(res_json(oauth_json(
      "/oauth/token",
      {"grant_type": "authorization_code", "code": "made-up"}
    ))["error"], "invalid_grant")
  end

  test("no open redirect (#687): a client registered to any https URI is never sent there before consent") do
    clear_cookies()
    evil = "https://evil.example/x"
    registered = oauth_json(
      "/oauth/register",
      {"client_name": "Not a client", "redirect_uris": [evil]}
    )
    assert_eq(res_status(registered), 201, "anyone may register, without signing in")
    client_id = res_json(registered)["client_id"]
    attempts = [
      "/oauth/authorize?client_id=#{client_id}&redirect_uri=#{url(evil)}&response_type=foo",
      "/oauth/authorize?client_id=#{client_id}&response_type=foo&state=s",
      "/oauth/authorize?client_id=#{client_id}&redirect_uri=#{url(evil)}&response_type=code",
      oauth_authorize_to(client_id, evil) + "&scope=other",
      oauth_authorize_to(client_id, evil) + "&resource=https://elsewhere.example/mcp"
    ]
    attempts.each do |path|
      answer = get(path)
      assert_eq(res_status(answer), 400, path)
      assert_null(res_location(answer), path)
      assert_not(res_body(answer).contains("evil.example"), path)
      assert_contains(res_body(answer), "data-oauth-error=", path)
    end
    # A well-formed request of that client is parked, then shown on the
    # consent page behind sign-in: only the person's answer goes back there.
    assert_contains(res_location(get(oauth_authorize_to(client_id, evil))), "/app/oauth/consent")
    user = oauth_user()
    oauth_sign_in(user)
    get(oauth_authorize_to(client_id, evil))
    consent = get("/app/oauth/consent")
    assert_eq(res_status(consent), 200)
    assert_contains(res_body(consent), "evil.example")
    assert_contains(res_location(oauth_decide("deny")), "https://evil.example/x?error=access_denied")
  end
end

# An authorization request of `client_id` sending its answer to `redirect` ("" for none).
def oauth_authorize_to(client_id, redirect)
  path = "/oauth/authorize?response_type=code&client_id=" + client_id + "&code_challenge="
  + oauth_challenge(OAUTH_VERIFIER)
  + "&code_challenge_method=S256&state=st4te"
  redirect.blank? ? path : path + "&redirect_uri=" + url(redirect)
end

def oauth_refresh(refresh_token, client_id)
  oauth_json(
    "/oauth/token",
    {
      "grant_type": "refresh_token",
      "refresh_token": refresh_token,
      "client_id": client_id
    }
  )
end

# The connection whose refresh token is `refresh_token`, as if rotated
# `seconds` ago.
def oauth_age_rotation(refresh_token, seconds)
  row = AccessToken.where({"refresh_digest": Crypto.sha256(refresh_token)}).first
  row.rotated_at = DateTime.utc.to_unix - seconds
  row.update()
end

# How many connections `user` has.
def oauth_connections(user)
  AccessToken.where({"user_id": user._key, "kind": "oauth"}).count
end

describe("The OAuth server's hardening (#541)") do
  before_each() do
    as_guest()
    clear_headers()
    clear_cookies()
  end

  test("a second /authorize between showing and deciding: the first page's answer is refused, no code") do
    user = oauth_user()
    shown_client = oauth_register("Claude Code")
    other_client = oauth_register("Something else")
    oauth_sign_in(user)
    get(oauth_authorize_path(shown_client))
    page = get("/app/oauth/consent")
    shown_id = assigns()["request_id"]
    assert_not_null(shown_id, "the consent page carries its request")
    assert_contains(res_body(page), "name=\"request_id\" value=\"#{shown_id}\"")
    # Another request lands in the session (a page that opened it in the background).
    get(oauth_authorize_path(other_client))
    codes_before = OauthCode.count
    stale = post(
      "/app/oauth/consent",
      {"decision": "allow", "request_id": shown_id}
    )
    assert_eq(res_status(stale), 400)
    assert_null(res_location(stale), "nothing sent back")
    assert_contains(res_body(stale), "Another connection request was started")
    assert_eq(OauthCode.count, codes_before, "no code issued")
    assert_eq(res_status(post(
      "/app/oauth/consent",
      {"decision": "allow", "request_id": shown_id}
    )), 400, "spent")
    # Without its request id (a page shown before the request ids came), an
    # answer is refused just the same: the page is out of date.
    get(oauth_authorize_path(shown_client))
    outdated = post("/app/oauth/consent", {"decision": "allow"})
    assert_eq(res_status(outdated), 400)
    assert_contains(res_body(outdated), "This page is out of date: start the connection again from your app")
    assert_not(res_body(outdated).contains("Another connection request was started"))
    assert_eq(OauthCode.count, codes_before)
    # The page on show answered with its own id: a code.
    get(oauth_authorize_path(shown_client))
    assert_not_null(oauth_param(res_location(oauth_decide("allow")), "code"))
    assert_eq(OauthCode.count, codes_before + 1)
  end

  test("the headline names where the answer goes; the self-chosen name is only quoted") do
    user = oauth_user()
    remote = res_json(oauth_json(
      "/oauth/register",
      {"client_name": "Claude Code", "redirect_uris": ["https://evil.example/cb"]}
    ))["client_id"]
    oauth_sign_in(user)
    get(oauth_authorize_to(remote, "https://evil.example/cb"))
    body = res_body(get("/app/oauth/consent"))
    assert_contains(body, "evil.example wants to reach your scores, calling itself “Claude Code”")
    assert_contains(body, "Score does not check that name")
    assert_not(body.contains("Connect Claude Code?"))
    assert_not(body.contains("An app on this computer"))
    assert_eq(assigns()["title"], "Connect evil.example")
    get(oauth_authorize_path(oauth_register("Claude Code")))
    local = res_body(get("/app/oauth/consent"))
    assert_contains(local, "An app on this computer wants to reach your scores, calling itself “Claude Code”")
    assert_eq(assigns()["title"], "Connect an app on this computer")
  end

  test("a refresh token used twice, past the grace: the whole connection is revoked, old and new tokens refused") do
    user = oauth_user()
    client_id = oauth_register()
    tokens = res_json(oauth_exchange(client_id, oauth_code_for(user, client_id)))
    renewed = res_json(oauth_refresh(tokens["refresh_token"], client_id))
    assert_eq(res_status(oauth_mcp(renewed["access_token"])), 200)
    oauth_age_rotation(renewed["refresh_token"], OAUTH_REUSE_GRACE_SECONDS + 1)
    reused = oauth_refresh(tokens["refresh_token"], client_id)
    assert_eq(res_status(reused), 400)
    assert_eq(res_json(reused)["error"], "invalid_grant")
    assert_eq(oauth_connections(user), 0, "the connection is gone")
    assert_eq(res_status(oauth_mcp(renewed["access_token"])), 401, "the new access token")
    assert_eq(
      res_json(oauth_refresh(renewed["refresh_token"], client_id))["error"],
      "invalid_grant",
      "the new refresh"
    )
    # A made-up refresh token revokes nothing.
    kept = res_json(oauth_exchange(client_id, oauth_code_for(user, client_id)))
    assert_eq(res_json(oauth_refresh("score_rt_made-up", client_id))["error"], "invalid_grant")
    assert_eq(res_status(oauth_mcp(kept["access_token"])), 200)
  end

  test("the previous refresh token again within the grace: refused, no new pair, the connection kept") do
    user = oauth_user()
    client_id = oauth_register()
    tokens = res_json(oauth_exchange(client_id, oauth_code_for(user, client_id)))
    renewed = res_json(oauth_refresh(tokens["refresh_token"], client_id))
    # The client lost the answer and retries (or a second session shares it).
    retried = oauth_refresh(tokens["refresh_token"], client_id)
    assert_eq(res_status(retried), 400)
    assert_eq(res_json(retried)["error"], "invalid_grant")
    assert_null(res_json(retried)["access_token"], "nothing re-issued")
    assert_eq(oauth_connections(user), 1, "the connection stays")
    row = AccessToken.where({"refresh_digest": Crypto.sha256(renewed["refresh_token"])}).first
    assert_not_null(row, "the current pair is still the stored one")
    assert_eq(row.previous_refresh_digest, Crypto.sha256(tokens["refresh_token"]))
    assert_eq(res_status(oauth_mcp(renewed["access_token"])), 200, "the current access token")
    again = res_json(oauth_refresh(renewed["refresh_token"], client_id))
    assert_not_null(again["access_token"], "the current refresh still works")
    assert_eq(res_status(oauth_mcp(again["access_token"])), 200)
    assert_eq(oauth_connections(user), 1)
  end

  test("two refreshes racing with one token: the loser gets nothing; past the grace it revokes the connection") do
    user = oauth_user()
    client_id = oauth_register()
    tokens = res_json(oauth_exchange(client_id, oauth_code_for(user, client_id)))
    presented = Crypto.sha256(tokens["refresh_token"])
    # Both requests read the row; the first rotates it.
    seen = AccessToken.where({"refresh_digest": presented}).first
    renewed = res_json(oauth_refresh(tokens["refresh_token"], client_id))
    assert_not_null(renewed["access_token"])
    # The second, its read now stale, rotates nothing and, so soon, revokes nothing.
    assert_null(AccessToken.rotate(seen, presented))
    assert_eq(oauth_connections(user), 1)
    assert_eq(res_status(oauth_mcp(renewed["access_token"])), 200, "the winner's pair")
    assert_eq(AccessToken.find(seen._key).refresh_digest, Crypto.sha256(renewed["refresh_token"]))
    # Later than the grace, the same stale read is a replay: revoked.
    oauth_age_rotation(renewed["refresh_token"], OAUTH_REUSE_GRACE_SECONDS + 1)
    assert_null(AccessToken.rotate(seen, presented))
    assert_eq(oauth_connections(user), 0)
    assert_eq(res_status(oauth_mcp(renewed["access_token"])), 401)
    # Unraced, a rotation goes through, once.
    fresh = res_json(oauth_exchange(client_id, oauth_code_for(user, client_id)))
    digest = Crypto.sha256(fresh["refresh_token"])
    row = AccessToken.where({"refresh_digest": digest}).first
    pair = AccessToken.rotate(row, digest)
    assert_not_null(pair["token"])
    assert_eq(AccessToken.where({"refresh_digest": Crypto.sha256(pair["refresh_token"])}).count, 1)
    assert_eq(AccessToken.where({"refresh_digest": digest}).count, 0)
    assert_eq(res_status(oauth_mcp(pair["token"])), 200)
  end

  test("a row only noted as used since it was read still rotates") do
    user = oauth_user()
    client_id = oauth_register()
    tokens = res_json(oauth_exchange(client_id, oauth_code_for(user, client_id)))
    presented = Crypto.sha256(tokens["refresh_token"])
    seen = AccessToken.where({"refresh_digest": presented}).first
    AccessToken.note_use(AccessToken.find(seen._key), DateTime.utc.to_unix)
    pair = AccessToken.rotate(seen, presented)
    assert_not_null(pair["token"])
    assert_eq(AccessToken.find(seen._key).refresh_digest, Crypto.sha256(pair["refresh_token"]))
    assert_eq(res_status(oauth_mcp(pair["token"])), 200)
  end

  test("a rotation's write: done, beaten by another, or failed — a failure revokes nothing") do
    assert_eq(AccessToken.write_outcome(true, false), "rotated")
    assert_eq(AccessToken.write_outcome(false, true), "stale")
    assert_eq(AccessToken.write_outcome(false, false), "failed")
    user = oauth_user()
    client_id = oauth_register()
    tokens = res_json(oauth_exchange(client_id, oauth_code_for(user, client_id)))
    row = AccessToken.where({"refresh_digest": Crypto.sha256(tokens["refresh_token"])}).first
    assert_null(AccessToken.after_write(row, Crypto.sha256(tokens["refresh_token"]), "failed"))
    assert_eq(oauth_connections(user), 1, "a failed write is not a reuse")
    assert_eq(res_status(oauth_mcp(tokens["access_token"])), 200)
  end

  test("a /mcp call that read the row before a rotation does not bring the old pair back") do
    user = oauth_user()
    client_id = oauth_register()
    tokens = res_json(oauth_exchange(client_id, oauth_code_for(user, client_id)))
    # The /mcp call reads the row; a refresh rotates it; the call then notes its use.
    stale = AccessToken.where({"digest": Crypto.sha256(tokens["access_token"])}).first
    renewed = res_json(oauth_refresh(tokens["refresh_token"], client_id))
    noted_at = DateTime.utc.to_unix
    assert_eq(AccessToken.note_use(stale, noted_at), [stale._key], "the query ran, on that row")
    row = AccessToken.find(stale._key)
    assert_eq(row.last_used_at, noted_at, "the use is noted")
    assert_eq(row.refresh_digest, Crypto.sha256(renewed["refresh_token"]), "the new refresh is the stored one")
    assert_eq(row.digest, Crypto.sha256(renewed["access_token"]))
    assert_eq(row.previous_refresh_digest, Crypto.sha256(tokens["refresh_token"]))
    assert_eq(res_status(oauth_mcp(tokens["access_token"])), 401, "the old access token")
    assert_eq(
      res_json(oauth_refresh(tokens["refresh_token"], client_id))["error"],
      "invalid_grant",
      "the old refresh"
    )
    assert_eq(oauth_connections(user), 1, "within the grace: kept")
    assert_eq(res_status(oauth_mcp(renewed["access_token"])), 200, "the new access token")
    assert_not_null(res_json(oauth_refresh(renewed["refresh_token"], client_id))["access_token"], "the new refresh")
  end

  test("a client's first token is stamped once, writing nothing else") do
    client = OauthClient.register("Stamped", [OAUTH_REDIRECT])
    stale = OauthClient.for_id(client.client_id)
    renamed = OauthClient.for_id(client.client_id)
    renamed.client_name = "Renamed meanwhile"
    renamed.update()
    stale.token_issued
    row = OauthClient.for_id(client.client_id)
    assert_not_null(row.token_issued_at)
    assert_eq(row.client_name, "Renamed meanwhile", "the stale copy wrote only the stamp")
    first = row.token_issued_at
    row.token_issued_at = first - 100
    row.update()
    OauthClient.for_id(client.client_id).token_issued
    assert_eq(OauthClient.for_id(client.client_id).token_issued_at, first - 100, "stamped already: kept")
  end

  test("a code asked with a redirect_uri is traded only with it; one asked without, without") do
    user = oauth_user()
    client_id = oauth_register()
    code = oauth_code_for(user, client_id)
    clear_headers()
    missing = post(
      "/oauth/token",
      {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": client_id,
        "code_verifier": OAUTH_VERIFIER
      }
    )
    assert_eq(res_status(missing), 400)
    assert_eq(res_json(missing)["error"], "invalid_grant")
    assert_eq(oauth_connections(user), 0, "no token issued")
    assert_eq(res_json(oauth_exchange(client_id, code))["error"], "invalid_grant", "and the code is spent")
    # Asked without one (a single registered URI): traded without one.
    oauth_sign_in(user)
    get(oauth_authorize_to(client_id, ""))
    bare = oauth_param(res_location(oauth_decide("allow")), "code")
    clear_headers()
    traded = post(
      "/oauth/token",
      {
        "grant_type": "authorization_code",
        "code": bare,
        "client_id": client_id,
        "code_verifier": OAUTH_VERIFIER
      }
    )
    assert_eq(res_status(traded), 200)
    assert_eq(oauth_connections(user), 1)
  end

  test("one address may register, trade and revoke only so often; another address is not held up") do
    ["register", "token", "revoke"].each do |endpoint|
      ip = "203.0.113.#{uuid_v4}"
      limit = OauthServer.limiter(endpoint, ip).status()["limit"]
      (0 .. limit).each do |_|
        assert_null(OauthServer.throttled(endpoint, ip), endpoint)
      end
      refused = OauthServer.throttled(endpoint, ip)
      assert_eq(refused["status"], 429, endpoint)
      assert_eq(JSON.parse(refused["body"])["error"], "too_many_requests")
      window = OauthServer.limiter(endpoint, ip).status()["window"]
      wait = refused["headers"]["Retry-After"]
      assert_eq(wait.to_i.to_s, wait, "#{endpoint}: whole seconds")
      assert(wait.to_i >= 1 && wait.to_i <= window, "#{endpoint}: within its window")
      assert_null(OauthServer.throttled(endpoint, "198.51.100.#{uuid_v4}"), endpoint)
    end
    assert_eq(OauthServer.limiter("register", "x").status()["window"], 3600)
    assert_eq(OauthServer.limiter("token", "x").status()["window"], 60)
  end

  test("an old client that never got a token is purged; a used one and a new one are kept") do
    user = oauth_user()
    unused = OauthClient.register("Unused", [OAUTH_REDIRECT])
    recent = OauthClient.register("Recent", [OAUTH_REDIRECT])
    used_id = oauth_register("Used")
    tokens = res_json(oauth_exchange(used_id, oauth_code_for(user, used_id)))
    # Used, then let go: it got a token once, so it stays.
    oauth_json(
      "/oauth/revoke",
      {"token": tokens["access_token"], "client_id": used_id}
    )
    assert_eq(oauth_connections(user), 0)
    long_ago = DateTime.utc.to_unix - (OAUTH_CLIENT_UNUSED_DAYS + 1) * 86400
    [unused.client_id, used_id].each do |client_id|
      row = OauthClient.for_id(client_id)
      row.created_at = long_ago
      row.update()
    end
    done = DataCleanupJob.perform_now({})
    assert_gt(done["oauth_clients"], 0)
    assert_null(OauthClient.for_id(unused.client_id), "old and never used")
    assert_not_null(OauthClient.for_id(used_id), "used once")
    assert_not_null(OauthClient.for_id(recent.client_id), "registered today")
    assert_eq(OauthClient.purge_unused, 0, "nothing more to purge")
  end

  # Last of the file, on purpose: they spend this address's minute of token
  # and revocation calls on the test server. The specs cannot give it back
  # nor come from elsewhere: the limiter lives in the server's process, not
  # the spec's, and no proxy is trusted in tests (.env.test), so every
  # request is 127.0.0.1's.
  test("past the minute's token calls: 429, and a good code is not spent") do
    user = oauth_user()
    client_id = oauth_register()
    code = oauth_code_for(user, client_id)
    codes_before = OauthCode.count
    statuses = (0 .. OAUTH_TOKEN_CALLS_PER_IP_MINUTE + 1).map do |_|
      res_status(oauth_json("/oauth/token", {"grant_type": "password"}))
    end
    assert(statuses.includes?(429), "refused past the limit")
    refused = oauth_exchange(client_id, code)
    assert_eq(res_status(refused), 429)
    assert_eq(res_json(refused)["error"], "too_many_requests")
    assert_eq(OauthCode.count, codes_before, "the code is still there")
    assert_eq(oauth_connections(user), 0)
  end

  test("past the minute's revocations: 429, and the connection stays") do
    user = oauth_user()
    client_id = oauth_register()
    connection = AccessToken.issue_oauth(user, OauthClient.for_id(client_id))
    statuses = (0 .. OAUTH_REVOCATIONS_PER_IP_MINUTE + 1).map do |_|
      res_status(oauth_json(
        "/oauth/revoke",
        {"token": "score_unknown", "client_id": client_id}
      ))
    end
    assert(statuses.includes?(429), "refused past the limit")
    refused = oauth_json(
      "/oauth/revoke",
      {"token": connection["token"], "client_id": client_id}
    )
    assert_eq(res_status(refused), 429)
    assert_eq(oauth_connections(user), 1)
  end
end
