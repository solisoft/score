# Score as an OAuth 2.1 authorization server for its MCP endpoint (#461),
# the flow the MCP authorization spec asks of a remote server, as Bonfire
# does it: a client added with the URL alone (`claude mcp add --transport
# http score <site>/mcp`) gets a 401 from /mcp, reads the two metadata
# documents below, registers itself (RFC 7591), opens the browser on
# /oauth/authorize (sign in, then the consent page) and trades the code for
# tokens at /oauth/token — PKCE S256 required, public clients only.
#
# The tokens are AccessTokens: the bearer /mcp already takes, listed and
# revoked in Account › Access tokens (AccessToken.issue_oauth).
const OAUTH_SCOPE = "score"
# What one address may ask of the open endpoints (#541): registrations an
# hour (a client registers once per connection), token and revocation
# calls a minute. Generous: a hosted client (claude.ai's connectors) calls
# for all its users from a few addresses.
const OAUTH_REGISTRATIONS_PER_IP_HOUR = (getenv("OAUTH_REGISTRATIONS_PER_IP_HOUR") ?? "60").to_i
const OAUTH_TOKEN_CALLS_PER_IP_MINUTE = (getenv("OAUTH_TOKEN_CALLS_PER_IP_MINUTE") ?? "120").to_i
const OAUTH_REVOCATIONS_PER_IP_MINUTE = (getenv("OAUTH_REVOCATIONS_PER_IP_MINUTE") ?? "60").to_i

class OauthServer
  # Score's public origin, which is also the issuer.
  static def issuer
    auth_base_url()
  end

  # The protected resource: the MCP endpoint's public address.
  static def resource
    base = OauthServer.issuer
    base + "/mcp"
  end

  # RFC 9728: where the resource's authorization server is.
  static def protected_resource_metadata
    {
      "resource": OauthServer.resource,
      "authorization_servers": [OauthServer.issuer],
      "scopes_supported": [OAUTH_SCOPE],
      "bearer_methods_supported": ["header"],
      "resource_name": "Score"
    }
  end

  # RFC 8414: the authorization server's endpoints and what it supports.
  static def authorization_server_metadata
    base = OauthServer.issuer
    {
      "issuer": base,
      "authorization_endpoint": base + "/oauth/authorize",
      "token_endpoint": base + "/oauth/token",
      "registration_endpoint": base + "/oauth/register",
      "revocation_endpoint": base + "/oauth/revoke",
      "scopes_supported": [OAUTH_SCOPE],
      "response_types_supported": ["code"],
      "grant_types_supported": ["authorization_code", "refresh_token"],
      "code_challenge_methods_supported": ["S256"],
      "token_endpoint_auth_methods_supported": ["none"],
      "revocation_endpoint_auth_methods_supported": ["none"]
    }
  end

  # What a 401 from /mcp says, so that a client finds the metadata above.
  static def challenge
    base = OauthServer.issuer
    "Bearer realm=\"score\", resource_metadata=\"" + base + "/.well-known/oauth-protected-resource\""
  end

  # A redirect URI a client may register: https anywhere, or http back to the
  # person's own machine (a client listening on a loopback port). No
  # fragment, no credentials in it.
  static def redirect_uri_allowed?(uri)
    text = uri.to_s
    return false if text.blank? || text.length > 500

    parts = Url.parse(text) rescue nil
    return false if parts.nil?
    return false if !parts["fragment"].nil? || !parts["username"].nil? || !parts["password"].nil?

    host = parts["host"].to_s
    return !host.blank? if parts["scheme"] == "https"

    parts["scheme"] == "http" && OauthServer.loopback?(text)
  end

  # Whether `uri` goes back to the person's own machine: what the consent
  # page calls "an app on this computer" (#541).
  static def loopback?(uri)
    parts = Url.parse(uri.to_s) rescue nil
    return false if parts.nil?

    ["localhost", "127.0.0.1", "[::1]", "::1"].includes?(parts["host"].to_s)
  end

  # PKCE S256 (RFC 7636): BASE64URL(SHA256(verifier)) is the challenge the
  # authorization request carried.
  static def pkce_matches?(verifier, challenge)
    text = verifier.to_s
    return false if text.length < 43 || text.length > 128
    return false unless Regex.matches("^[A-Za-z0-9._~-]+$", text)

    computed = Base64.urlsafe_encode(Hex.decode(Crypto.sha256(text)))
    secure_compare(computed, challenge.to_s)
  end

  # An authorization request checked (the /oauth/authorize query, or the
  # consent form sending it again). One of:
  #   {"ok": true, "client", "redirect_uri", "state", "code_challenge"}
  #   {"fatal": reason} — an unknown client or redirect URI: an error page,
  #     never a redirect to a URI not verified
  #   {"redirect_error": code, "description", "redirect_uri", "state"} —
  #     told to the client's redirect URI
  static def check_authorization(input)
    client = OauthClient.for_id(input["client_id"])
    return {"fatal": "unknown_client"} if client.nil?

    redirect_uri = input["redirect_uri"].to_s
    registered = client.redirect_uris ?? []
    redirect_uri = registered[0] if redirect_uri.blank? && registered.length == 1
    return {"fatal": "unknown_redirect_uri"} unless client.redirect_uri?(redirect_uri)

    state = input["state"]
    if input["response_type"] != "code"
      return OauthServer.refusal("unsupported_response_type", "response_type must be code", redirect_uri, state)
    end

    if input["code_challenge"].to_s.blank? || input["code_challenge_method"] != "S256"
      pkce = "PKCE is required: code_challenge with code_challenge_method S256"
      return OauthServer.refusal("invalid_request", pkce, redirect_uri, state)
    end
    unless OauthServer.scope_allowed?(input["scope"])
      return OauthServer.refusal("invalid_scope", "the only scope is " + OAUTH_SCOPE, redirect_uri, state)
    end

    unless OauthServer.resource_allowed?(input["resource"])
      target = "resource must be " + OauthServer.resource
      return OauthServer.refusal("invalid_target", target, redirect_uri, state)
    end

    {
      "ok": true,
      "client": client,
      "redirect_uri": redirect_uri,
      "state": state,
      "code_challenge": input["code_challenge"].to_s
    }
  end

  # A refusal told to the client's (verified) redirect URI.
  static def refusal(code, description, redirect_uri, state)
    {
      "redirect_error": code,
      "description": description,
      "redirect_uri": redirect_uri,
      "state": state
    }
  end

  # No scope, or ours.
  static def scope_allowed?(requested)
    text = requested.to_s.trim
    return true if text.blank?

    text.split(" ").all? do |part|
      part.blank? || part == OAUTH_SCOPE
    end
  end

  # RFC 8707: a token asked for another resource than /mcp is refused.
  static def resource_allowed?(requested)
    text = requested.to_s.trim
    return true if text.blank?

    canonical = text.ends_with?("/") ? text.substring(0, text.length - 1) : text
    [OauthServer.resource, OauthServer.issuer].includes?(canonical)
  end

  # The client's redirect URI with `values` added to its query.
  static def callback(redirect_uri, values)
    query = []
    for name in values.keys
      value = values[name]
      query.push(url_encode(name) + "=" + url_encode(value.to_s)) unless value.nil?
    end
    separator = redirect_uri.includes?("?") ? "&" : "?"
    redirect_uri + separator + query.join("&")
  end

  # The authorization request's own fields, as strings: what is parked in the session.
  static def request_fields(input)
    fields = {}
    names = [
      "client_id",
      "redirect_uri",
      "response_type",
      "code_challenge",
      "code_challenge_method",
      "state",
      "scope",
      "resource"
    ]
    for name in names
      fields[name] = input[name].to_s unless input[name].nil?
    end
    fields
  end

  # host[:port] of a redirect URI, said on the consent page.
  static def host_of(uri)
    parts = Url.parse(uri) rescue nil
    return uri.to_s if parts.nil?

    host = parts["host"].to_s
    parts["port"].nil? ? host : host + ":" + parts["port"].to_s
  end

  # A JSON answer of an OAuth endpoint: never kept in a cache (tokens),
  # readable from a client in a browser.
  static def json(status, payload)
    {
      "status": status,
      "headers": {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Pragma": "no-cache",
        "Access-Control-Allow-Origin": "*"
      },
      "body": payload.to_json
    }
  end

  # The count of `endpoint` ("register", "token" or "revoke") for address `ip`.
  static def limiter(endpoint, ip)
    limits = {
      "register": [OAUTH_REGISTRATIONS_PER_IP_HOUR, 3600],
      "token": [OAUTH_TOKEN_CALLS_PER_IP_MINUTE, 60],
      "revoke": [OAUTH_REVOCATIONS_PER_IP_MINUTE, 60]
    }
    limit = limits[endpoint]
    RateLimiter("oauth-#{endpoint}:#{ip}", limit[0], limit[1])
  end

  # nil while address `ip` may still call `endpoint`, else the 429 to answer.
  static def throttled(endpoint, ip)
    limiter = OauthServer.limiter(endpoint, ip)
    return nil if limiter.allowed()

    answer = OauthServer.error(429, "too_many_requests", "too many requests from this address: try again later")
    answer["headers"]["Retry-After"] = limiter.throttle().to_s
    answer
  end

  # An RFC 6749 error body.
  static def error(status, code, description)
    OauthServer.json(
      status,
      {"error": code, "error_description": description}
    )
  end
end
