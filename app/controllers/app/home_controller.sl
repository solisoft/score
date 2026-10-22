# The app's first screen.
class AppHomeController < AppBaseController
  # GET /app
  def index
    return redirect(app_scores_path()) if signed_in?()

    @title = "Your scores"
    @description = "Write music in your browser: scores engraved as you type, played, saved to your account."
  end
end
