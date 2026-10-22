# The page /app sends to while the server has no database (AppSetup.ready?).
class AppSetupController < Controller
  static {
    this.layout = "app"
  }

  # GET /app/setup
  def show
    @title = "Being set up"
    @description = "The score-writing app is being set up on this server."
    render("app/setup/show", {}, {"status": 503})
  end
end
