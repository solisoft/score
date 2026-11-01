# The second step of a sign-in, for an account with two-step sign-in on:
# the six-digit code of its authenticator app, or one of its backup codes.
#
# The password step leaves who is half-way in the session (TwoStepPending);
# this one signs them in. Ten minutes to answer, five wrong codes and the
# sign-in starts again, and the per-IP throttle of the password step here too.
# Every wrong code also counts against the account, with the wrong passwords
# (#538): AUTH_MAX_FAILED_ATTEMPTS of them lock it however many fresh
# sign-ins they are spread over, and a locked account takes no code, the
# right one included.

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
    return @_start_again(user, @_locked_message) if @_codes_locked?(user)

    if user.second_step?(params["code"])
      remember = session_get("two_step_remember") == true
      back = session_get("two_step_return").to_s
      TwoStepPending.forget()
      @_clear_wrong_codes(user)
      @_finish_sign_in(user, remember)
      return redirect(back.blank? ? app_home_path() : back)
    end

    @_count_wrong_code(user)
    return @_start_again(user, @_locked_message) if @_codes_locked?(user)

    tries = (session_get("two_step_tries") ?? 0) + 1
    return @_start_again(user, SiteText.t("auth.too_many_codes")) if tries >= TWO_STEP_TRIES

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

  # The account's lock, the one wrong passwords set, as the code step reads,
  # counts and clears it (#538): small on purpose, so a change of the lock's
  # shape (per source, a trusted browser) lands here only.
  def _codes_locked?(user)
    user.locked?()
  end

  def _count_wrong_code(user)
    user.register_failed_attempt(true)
  end

  def _clear_wrong_codes(user)
    user.clear_failed_attempts()
  end

  # Said only to whoever already got the password right.
  def _locked_message
    SiteText.t("security_538.too_many_codes", {"minutes": AUTH_LOCKOUT_SECONDS / 60})
  end

  # The sign-in forgotten, and its form again, saying why.
  def _start_again(user, message)
    TwoStepPending.forget()
    render("sessions/new", {
      "title": SiteText.t("auth.sign_in"),
      "error": message,
      "email": user.email,
      "return_to": ""
    }, {"status": 401})
  end

  def _refuse(message, status)
    render("two_step/new", {"title": SiteText.t("auth.two_step_title"), "error": message}, {"status": status})
  end
end
