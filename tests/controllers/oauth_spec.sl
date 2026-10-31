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

# A signed-in person's approval of `client_id`: the code sent back.
def oauth_code_for(user, client_id)
  oauth_sign_in(user)
  get(oauth_authorize_path(client_id))
  decided = post("/app/oauth/consent", {"decision": "allow"})
  oauth_param(res_location(decided), "code")
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
    assert_contains(res_body(page), "Connect Claude Code?")
    assert_contains(res_body(page), "127.0.0.1:33418")
    decided = post("/app/oauth/consent", {"decision": "allow"})
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
    stale = oauth_json(
      "/oauth/token",
      {
        "grant_type": "refresh_token",
        "refresh_token": tokens["refresh_token"],
        "client_id": client_id
      }
    )
    assert_eq(res_json(stale)["error"], "invalid_grant", "the old refresh token")
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
  end

  test("refused: denied, an unknown client or redirect, no PKCE, another scope; no code without consent") do
    user = oauth_user()
    client_id = oauth_register()
    oauth_sign_in(user)
    get(oauth_authorize_path(client_id))
    denied = post("/app/oauth/consent", {"decision": "deny"})
    assert_eq(oauth_param(res_location(denied), "error"), "access_denied")
    assert_null(oauth_param(res_location(denied), "code"))
    assert_eq(res_status(get(oauth_authorize_path("score_oc_nobody"))), 400)
    elsewhere = "/oauth/authorize?response_type=code&client_id=" + client_id + "&redirect_uri="
    + url("https://evil.example/cb")
    assert_eq(res_status(get(elsewhere)), 400, "never sent to an address the client did not register")
    no_pkce = "/oauth/authorize?response_type=code&client_id=" + client_id + "&redirect_uri="
    + url(OAUTH_REDIRECT)
    + "&state=s"
    assert_eq(oauth_param(res_location(get(no_pkce)), "error"), "invalid_request")
    assert_eq(
      oauth_param(res_location(get(oauth_authorize_path(client_id, "&scope=admin"))), "error"),
      "invalid_scope"
    )
    assert_eq(res_status(post("/app/oauth/consent", {"decision": "allow"})), 400, "nothing pending: no code")
    assert_eq(res_json(oauth_json("/oauth/token", {"grant_type": "password"}))["error"], "unsupported_grant_type")
    assert_eq(res_json(oauth_json(
      "/oauth/token",
      {"grant_type": "authorization_code", "code": "made-up"}
    ))["error"], "invalid_grant")
  end
end
