# Score's OAuth 2.1 server for MCP clients (#461), so a client connects with
# the /mcp address alone: it reads the metadata, registers itself, sends the
# person to /oauth/authorize — parked in the session, then the consent page
# behind sign-in (AppOauthController) — and gets tokens here. The rules
# (redirect URIs, PKCE, scope, resource) are OauthServer's; the tokens are
# AccessTokens. Open routes: no sign-in on them.
class OauthServerController < Controller
  static {
    this.layout = "application"
  }

  # GET /.well-known/oauth-protected-resource
  # GET /.well-known/oauth-protected-resource/mcp
  def protected_resource
    OauthServer.json(200, OauthServer.protected_resource_metadata)
  end

  # GET /.well-known/oauth-authorization-server
  def authorization_server
    OauthServer.json(200, OauthServer.authorization_server_metadata)
  end

  # POST /oauth/register — dynamic client registration (RFC 7591): public
  # clients only, their redirect URIs checked by OauthServer
  def register
    input = req["json"] ?? params
    redirect_uris = input["redirect_uris"]
    unless type(redirect_uris) == "array" && redirect_uris.length > 0 && redirect_uris.length <= 10
      return OauthServer.error(400, "invalid_redirect_uri", "redirect_uris must list 1 to 10 URIs")
    end

    for uri in redirect_uris
      unless type(uri) == "string" && OauthServer.redirect_uri_allowed?(uri)
        return OauthServer.error(400, "invalid_redirect_uri", "not an allowed redirect URI: " + uri.to_s)
      end

    end
    if (input["token_endpoint_auth_method"] ?? "none") != "none"
      return OauthServer.error(400, "invalid_client_metadata", "only public clients are supported (auth method none)")
    end

    for grant in input["grant_types"] ?? []
      unless ["authorization_code", "refresh_token"].includes?(grant)
        return OauthServer.error(400, "invalid_client_metadata", "unsupported grant type: " + grant.to_s)
      end

    end

    client = OauthClient.register(input["client_name"], redirect_uris)
    return OauthServer.error(400, "invalid_client_metadata", "the client could not be saved") unless client._errors.nil?

    OauthServer.json(
      201,
      {
        "client_id": client.client_id,
        "client_id_issued_at": DateTime.utc.to_unix,
        "client_name": client.client_name,
        "redirect_uris": client.redirect_uris,
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "scope": OAUTH_SCOPE
      }
    )
  end

  # GET /oauth/authorize — the request checked and parked in the session,
  # then the consent page (signing in first when need be)
  def authorize
    checked = OauthServer.check_authorization(params)
    return @_fatal(checked["fatal"]) if checked.has_key("fatal")
    return @_refuse(checked) if checked.has_key("redirect_error")

    session_set("oauth_pending", OauthServer.request_fields(params))
    redirect(app_oauth_consent_path())
  end

  # POST /oauth/token — a code (with its PKCE verifier), or a refresh token,
  # for an access token
  def token
    input = req["json"] ?? params
    grant = input["grant_type"].to_s
    return @_exchange_code(input) if grant == "authorization_code"
    return @_refresh(input) if grant == "refresh_token"

    OauthServer.error(400, "unsupported_grant_type", "grant_type must be authorization_code or refresh_token")
  end

  # POST /oauth/revoke — RFC 7009: a client letting go of its connection.
  # 200 whatever the token was: it says nothing.
  def revoke
    input = req["json"] ?? params
    AccessToken.revoke_oauth(input["token"], input["client_id"])
    OauthServer.json(200, {})
  end

  private

  # The code burnt (once), then checked: issued to this client, for this
  # redirect URI, its PKCE challenge answered by the verifier.
  def _exchange_code(input)
    code = OauthCode.burn(input["code"])
    if code.nil? || DateTime.utc.to_unix > code["expires_at"].to_s.to_i
      return OauthServer.error(400, "invalid_grant", "unknown, used or expired code")
    end

    if code["client_id"] != input["client_id"].to_s
      return OauthServer.error(400, "invalid_grant", "code issued to another client")
    end

    sent = input["redirect_uri"].to_s
    if !sent.blank? && sent != code["redirect_uri"]
      return OauthServer.error(400, "invalid_grant", "redirect_uri does not match the authorization request")
    end

    unless OauthServer.pkce_matches?(input["code_verifier"], code["code_challenge"])
      return OauthServer.error(400, "invalid_grant", "code_verifier does not match the code_challenge")
    end

    unless OauthServer.resource_allowed?(input["resource"])
      return OauthServer.error(400, "invalid_target", "resource must be " + OauthServer.resource)
    end

    client = OauthClient.for_id(code["client_id"])
    user = User.find_by("_key", code["user_id"].to_s)
    if client.nil? || user.nil?
      return OauthServer.error(400, "invalid_grant", "the client or the person no longer exists")
    end

    @_tokens(AccessToken.issue_oauth(user, client))
  end

  def _refresh(input)
    pair = AccessToken.refresh_oauth(input["refresh_token"], input["client_id"])
    return OauthServer.error(400, "invalid_grant", "unknown, used or expired refresh token") if pair.nil?

    @_tokens(pair)
  end

  # The RFC 6749 token answer.
  def _tokens(pair)
    OauthServer.json(
      200,
      {
        "access_token": pair["token"],
        "token_type": "Bearer",
        "expires_in": OAUTH_ACCESS_SECONDS,
        "refresh_token": pair["refresh_token"],
        "scope": OAUTH_SCOPE
      }
    )
  end

  # A request that cannot be sent back safely: a page saying so.
  def _fatal(reason)
    @title = "Connection refused"
    @description = "An application asked to connect to Score in a way it cannot."
    @reason = reason
    render("oauth_server/error", {}, {"status": 400})
  end

  # A refusal told to the client's (verified) redirect URI.
  def _refuse(checked)
    values = {
      "error": checked["redirect_error"],
      "error_description": checked["description"],
      "state": checked["state"]
    }
    redirect_external(OauthServer.callback(checked["redirect_uri"], values))
  end
end
