# The second step of a sign-in, for an account with two-step sign-in on:
# the six-digit code of its authenticator app, or one of its backup codes.
#
# The password step leaves who is half-way in the session (SessionsController);
# this one signs them in. Ten minutes to answer, five wrong codes and the
# sign-in starts again, and the per-IP throttle of the password step here too.

const TWO_STEP_TRIES = 5
const TWO_STEP_SECONDS = 600

class TwoStepController < SessionsController
  static {
    this.layout = "app"
  }

  # GET /login/code
  def new
    return redirect(SiteLocale.path(login_path())) if @_pending_user.nil?

    render(
      "two_step/new",
      {"title": SiteText.t("auth.two_step_title"), "error": ""}
    )
  end

  # POST /login/code
  def create
    user = @_pending_user
    return redirect(SiteLocale.path(login_path())) if user.nil?

    limiter = rate_limiter_from_ip(req, AUTH_ATTEMPTS_PER_IP, AUTH_IP_WINDOW_SECONDS)
    return @_refuse(SiteText.t("auth.too_many_attempts"), 429) unless limiter.allowed()

    if user.second_step?(params["code"])
      remember = session_get("two_step_remember") == true
      back = session_get("two_step_return").to_s
      @_forget_pending
      @_finish_sign_in(user, remember)
      return redirect(back.blank? ? app_home_path() : back)
    end

    tries = (session_get("two_step_tries") ?? 0) + 1
    if tries >= TWO_STEP_TRIES
      @_forget_pending
      return render("sessions/new", {
        "title": SiteText.t("auth.sign_in"),
        "error": SiteText.t("auth.too_many_codes"),
        "email": user.email,
        "return_to": ""
      }, {"status": 401})
    end
    session_set("two_step_tries", tries)
    @_refuse(SiteText.t("auth.bad_code"), 401)
  end

  # Who is half-way through signing in, while there is still time: or nil.
  def _pending_user
    key = session_get("two_step_user").to_s
    since = session_get("two_step_since") ?? 0
    return nil if key.blank? || DateTime.utc().to_unix() - since > TWO_STEP_SECONDS

    User.find_by("_key", key)
  end

  def _forget_pending
    ["two_step_user", "two_step_since", "two_step_tries", "two_step_remember", "two_step_return"].each do |name|
      session_delete(name)
    end
  end

  def _refuse(message, status)
    render("two_step/new", {"title": SiteText.t("auth.two_step_title"), "error": message}, {"status": status})
  end
end
