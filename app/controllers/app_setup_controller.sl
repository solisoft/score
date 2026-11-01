# The page /app sends to while the server has no database (AppSetup.ready?).
class AppSetupController < Controller
  static {
    this.layout = "app"
  }

  # GET /app/setup
  def show
    @title = SiteText.t("app.setup.title")
    @description = SiteText.t("app.setup.description")
    render("app/setup/show", {}, {"status": 503})
  end
end
