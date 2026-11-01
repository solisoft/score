# The second step of a sign-in, for an account with two-step sign-in on:
# the six-digit code of its authenticator app, or one of its backup codes.
#
# The password step leaves who is half-way in the session (TwoStepPending);
# this one signs them in. Ten minutes to answer, five wrong codes and the
# sign-in starts again, and the per-IP throttle of the password step here too.
# Every wrong code also counts against the account (#538, TwoStepGuard):
# TWO_STEP_MAX_WRONG of them pause the code step, however many fresh
# sign-ins they are spread over and whatever password resets come between;
# while it is paused no code is taken, the right one included. The pause
# holds the code step only: the password step still leads here. And the
# locks of the password step hold here too: a network locked meanwhile, or
# the account's lock for the browsers it does not know.

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

    ip = client_ip(req)
    if user.locked_for?(ip, user.trusts_device?(@_device_cookie))
      return @_start_again(user, SiteText.t("auth.invalid"))
    end

    return @_start_again(user, @_locked_message) if user.codes_locked?

    # This sign-in's try counted before the code is checked, as the
    # account's is (User#second_step_counted?).
    tries = (session_get("two_step_tries") ?? 0) + 1
    session_set("two_step_tries", tries)
    return @_start_again(user, SiteText.t("auth.too_many_codes")) if tries > TWO_STEP_TRIES

    if user.second_step_counted?(params["code"])
      remember = session_get("two_step_remember") == true
      back = session_get("two_step_return").to_s
      TwoStepPending.forget()
      # The password was right, and now the code: the network's wrong
      # passwords start again, as a sign-in without two-step does.
      user.clear_failed_attempts(ip)
      @_finish_sign_in(user, remember)
      # This session passed the second step: the admin section asks for it.
      SecondStep.mark(user)
      return redirect(back.blank? ? app_home_path() : back)
    end

    return @_start_again(user, @_locked_message) if user.codes_locked?
    return @_start_again(user, SiteText.t("auth.too_many_codes")) if tries >= TWO_STEP_TRIES

    @_refuse(SiteText.t("auth.bad_code"), 401)
  end

  # Who is half-way through signing in, while there is still time: or nil.
  def _pending_user
    key = session_get("two_step_user").to_s
    since = session_get("two_step_since") ?? 0
    return nil if key.blank? || DateTime.utc().to_unix() - since > TWO_STEP_SECONDS

    User.find_by("_key", key)
  end

  # Said only to whoever already got the password right.
  def _locked_message
    SiteText.t("security_538.too_many_codes", {"minutes": TWO_STEP_LOCK_SECONDS / 60})
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
