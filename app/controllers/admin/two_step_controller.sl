# Where `require_admin` sends an admin without two-step sign-in (#544): the
# admin section needs it, and the account page is where it is turned on.
# Anyone but an admin is answered 404, as everywhere in /admin; an admin
# with two-step on goes straight to the section.
class AdminTwoStepController < Controller
  static {
    this.layout = "app"
  }

  # GET /admin/two-step
  def show
    user = current_user()
    halt(404, "Not found") unless user.admin?
    return redirect(admin_path()) if user.two_step?

    @available = user.can_use_two_step?
    @account_two_step = app_account_path() + "#two-step"
    @title = SiteText.t("security_544.admin_two_step_title")
    @description = SiteText.t("security_544.admin_two_step_description")
  end
end
