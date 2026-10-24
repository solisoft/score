# The link mailed to a new address (AuthMailer#confirm_new_email): the page
# it opens says what it will do, and its button makes the change. A GET
# changes nothing, so a mail scanner following the link does not confirm
# it. Signed in or not: the token is what proves the address.
class EmailChangesController < Controller
  static {
    this.layout = "app"
  }

  # GET /account/email?token=… — what the link will do, or why it cannot
  def show
    found = User.email_change_for(params["token"])
    @_show(found["state"], found["user"])
  end

  # POST /account/email — the change made: the account takes the new address
  def update
    limiter = RateLimiter("email-change-confirm:#{client_ip(req)}", AUTH_ATTEMPTS_PER_IP, AUTH_IP_WINDOW_SECONDS)
    return @_show("busy", nil) unless limiter.allowed()

    found = User.email_change_for(params["token"])
    user = found["user"]
    return @_show(found["state"], user) unless found["state"] == "ready"

    new_email = user.email_change_to
    old = user.finish_email_change()
    return @_show("taken", user, new_email) if old.nil?

    # Every session of the account was signed out; this browser, if it is
    # theirs, stays signed in.
    if session_get("user_id") == user._key
      session_regenerate()
      session_set("user_id", user._key)
      session_set("session_version", user.current_session_version())
      @stays_signed_in = true
    end
    @_show("changed", user, new_email)
  end

  # The page for `state`: "ready", "changed", "done", "expired", "taken",
  # "busy" or "unknown", with the answer's status.
  def _show(state, user, address = nil)
    statuses = {
      "ready": 200,
      "changed": 200,
      "done": 200,
      "expired": 410,
      "taken": 409,
      "busy": 429,
      "unknown": 404
    }
    @state = state
    @token = params["token"].to_s
    @new_email = address ?? user&.email_change_to ?? user&.email
    @stays_signed_in ||= false
    @title = state == "changed" ? "Address changed" : "Change of email address"
    @description = "Confirm the new address of an EUI Score account."
    render("email_changes/show", {}, {"status": statuses[state]})
  end
end
