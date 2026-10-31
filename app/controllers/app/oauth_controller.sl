# The consent page of Score's OAuth server (#461): an MCP client asked to
# reach the signed-in person's scores; they allow it, or not. The request
# was checked and parked in the session by /oauth/authorize
# (OauthServerController); it is checked again here, and again when the
# answer comes. Behind sign-in.
class AppOauthController < AppBaseController
  # GET /app/oauth/consent — which application asks, for what
  def consent
    pending = session_get("oauth_pending")
    return @_nothing_pending unless type(pending) == "hash"

    checked = OauthServer.check_authorization(pending)
    return @_nothing_pending unless checked["ok"] == true

    @client_name = checked["client"].client_name
    @redirect_host = OauthServer.host_of(checked["redirect_uri"])
    @email = current_user().email.to_s
    @title = "Connect " + this.client_name
    @description = "An application asks to reach your Score scores."
  end

  # POST /app/oauth/consent — `decision` allow or deny: a code, or a
  # refusal, sent back to the application
  def decide
    pending = session_get("oauth_pending")
    return @_nothing_pending unless type(pending) == "hash"

    session_delete("oauth_pending")
    checked = OauthServer.check_authorization(pending)
    return @_nothing_pending unless checked["ok"] == true

    redirect_uri = checked["redirect_uri"]
    state = checked["state"]
    if params["decision"] != "allow"
      return redirect_external(OauthServer.callback(
        redirect_uri,
        {"error": "access_denied", "state": state}
      ))
    end

    code = OauthCode.issue(checked["client"].client_id, current_user(), redirect_uri, checked["code_challenge"])
    redirect_external(OauthServer.callback(
      redirect_uri,
      {
        "code": code,
        "state": state,
        "iss": OauthServer.issuer
      }
    ))
  end

  private

  def _nothing_pending
    @title = "Nothing to connect"
    @description = "No application is waiting for your answer."
    @reason = "nothing_pending"
    render("oauth_server/error", {}, {"status": 400})
  end
end
