# The app's first screen.
class AppHomeController < AppBaseController
  # GET /app
  def index
    @title = "Your scores"
    @description = "Write music in your browser: scores engraved as you type, played, saved to your account."
  end
end
