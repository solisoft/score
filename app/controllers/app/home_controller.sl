# The app's first screen: for a guest, what the app is and the way in; for
# someone signed in, where to start — a new score from a template, a file
# to import, the playground's draft or a shared link to keep, and the scores
# changed last.
class AppHomeController < AppBaseController
  # GET /app
  def index
    @user = current_user()
    @recent = @user.nil? ? [] : Score.recent(@user, 6)
    @eui_version = ScoreAssets.version
    @title = @user.nil? ? "Write music, keep it" : "Start"
    @description = "Write music in your browser: scores engraved as you type, played, saved to your account."
  end
end
