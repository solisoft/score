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
    # Who asks is told by where the answer goes, which Score checks; the
    # name is the client's own choice, only quoted (#541).
    if OauthServer.loopback?(checked["redirect_uri"])
      @heading = SiteText.t("security_541.heading_local", {"name": @client_name})
      @title = SiteText.t("security_541.title_local")
    else
      @heading = SiteText.t(
        "security_541.heading",
        {"host": @redirect_host, "name": @client_name}
      )
      @title = SiteText.t("security_541.title", {"host": @redirect_host})
    end
    @request_id = pending["request_id"].to_s
    @email = current_user().email.to_s
    @description = SiteText.t("app.oauth.description")
  end

  # POST /app/oauth/consent — `decision` allow or deny: a code, or a
  # refusal, sent back to the application
  def decide
    pending = session_get("oauth_pending")
    return @_nothing_pending unless type(pending) == "hash"

    session_delete("oauth_pending")
    # The answer is to the request its page showed: another one started since
    # (in a tab, or by a page opening /oauth/authorize behind the person's
    # back) is not approved by it (#541).
    # A page with no id at all was shown before the ids came (a deploy since).
    shown = params["request_id"].to_s
    expected = pending["request_id"].to_s
    return @_stale_request("outdated") if shown.blank? || expected.blank?
    return @_stale_request("stale") unless secure_compare(shown, expected)

    checked = OauthServer.check_authorization(pending)
    return @_nothing_pending unless checked["ok"] == true

    redirect_uri = checked["redirect_uri"]
    state = checked["state"]
    if params["decision"] != "allow"
      return @_leave_for(OauthServer.callback(
        redirect_uri,
        {"error": "access_denied", "state": state}
      ))
    end

    code = OauthCode.issue(
      checked["client"].client_id,
      current_user(),
      redirect_uri,
      checked["code_challenge"],
      !pending["redirect_uri"].to_s.blank?
    )
    @_leave_for(OauthServer.callback(
      redirect_uri,
      {
        "code": code,
        "state": state,
        "iss": OauthServer.issuer
      }
    ))
  end

  private

  # The answer sent on to the client's `callback`: a page that goes there by
  # itself (app/oauth/leave), not a redirect — the Content-Security-Policy's
  # form-action refuses a form's redirect to another site (#688).
  def _leave_for(callback)
    @refresh_to = callback
    @redirect_host = OauthServer.host_of(callback)
    @title = SiteText.t("app.oauth.leaving_title")
    @description = SiteText.t("app.oauth.description")
    render("app/oauth/leave")
  end

  def _nothing_pending
    @title = SiteText.t("app.oauth.nothing_title")
    @description = SiteText.t("app.oauth.nothing_description")
    @reason = "nothing_pending"
    render("oauth_server/error", {}, {"status": 400})
  end

  # `why`: "stale" (another request replaced it) or "outdated" (no id on it).
  def _stale_request(why)
    @title = SiteText.t("security_541.#{why}_title")
    @description = SiteText.t("app.oauth.nothing_description")
    @reason = "stale_request"
    @stale_body = SiteText.t("security_541.#{why}_body")
    render("oauth_server/error", {}, {"status": 400})
  end
end
