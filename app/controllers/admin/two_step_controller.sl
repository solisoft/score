# Where `require_admin` sends an admin whose session passed no second step
# (#544, SecondStep): without two-step sign-in, the account page is where it
# is turned on; with it, but signed in with the password alone (before
# turning it on, or on a remembered browser), they sign in again with the
# code. Anyone but an admin is answered 404, as everywhere in /admin; a
# session that passed the second step goes straight to the section.
class AdminTwoStepController < Controller
  static {
    this.layout = "app"
  }

  # GET /admin/two-step
  def show
    user = current_user()
    halt(404, "Not found") unless user.admin?
    return redirect(admin_path()) if SecondStep.passed?(user)

    @sign_in_again = user.two_step?
    @available = user.can_use_two_step?
    @account_two_step = app_account_path() + "#two-step"
    @title = SiteText.t("security_544.admin_two_step_title")
    @description = SiteText.t("security_544.admin_two_step_description")
  end
end
