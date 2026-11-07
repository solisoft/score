# Where `require_admin` sends an admin whose session passed no second step
# (#544, SecondStep), or passed it more than SECOND_STEP_SECONDS ago (#687):
# without two-step sign-in, the account page is where it is turned on; with
# it, the code of the authenticator app is asked here — counted as a
# sign-in's code is (User#second_step_counted?: TWO_STEP_MAX_WRONG wrong
# ones pause the code step). Anyone but an admin is answered 404, as
# everywhere in /admin; a session that passed the second step goes straight
# to the section.
class AdminTwoStepController < Controller
  static {
    this.layout = "app"
  }

  # GET /admin/two-step
  def show
    user = @_admin
    return redirect(admin_path()) if SecondStep.passed?(user)

    @_show(user, "", 200)
  end

  # POST /admin/two-step — `code`: the app's code (or a backup code) opens
  # the section for SECOND_STEP_SECONDS
  def create
    user = @_admin
    return redirect(admin_path()) if SecondStep.passed?(user)
    return redirect(admin_two_step_path()) unless user.two_step?

    if user.codes_locked?
      paused = SiteText.t("security_538.too_many_codes", {"minutes": TWO_STEP_LOCK_SECONDS / 60})
      return @_show(user, paused, 429)
    end

    wrong = SiteText.t("security_687.admin_code_wrong")
    return @_show(user, wrong, 422) unless user.second_step_counted?(params["code"])

    SecondStep.mark(user)
    redirect(admin_path())
  end

  private

  # The admin signed in; anyone else is answered 404.
  def _admin
    user = current_user()
    halt(404, "Not found") unless user.admin?

    user
  end

  def _show(user, error, status)
    @sign_in_again = user.two_step?
    @available = user.can_use_two_step?
    @account_two_step = app_account_path() + "#two-step"
    @error = error
    @title = SiteText.t("security_544.admin_two_step_title")
    @description = SiteText.t("security_544.admin_two_step_description")
    render("admin/two_step/show", {}, {"status": status})
  end
end
