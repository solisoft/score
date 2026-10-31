# The app's first screen: for a guest, what the app is and the way in; for
# someone signed in, where to start — a new score from a template, a file
# to import, a photo to read, the playground's draft or a shared link to keep, and the scores
# changed last.
class AppHomeController < AppBaseController
  # GET /app
  def index
    @user = current_user()
    @recent = @user.nil? ? [] : Score.recent(@user, 6)
    @eui_version = ScoreAssets.version
    @photos = @user.nil? ? nil : @_photos(@user)
    # Photos being read, found again from here (#465).
    @photos_going = @user.nil? ? 0 : ScoreReading.going(@user)
    @title = @user.nil? ? "Write music, keep it" : "Start"
    @description = "Write music in your browser: scores engraved as you type, played, saved to your account."
  end

  private

  # What the photo card says: whether photos can be read, with what and how
  # many more today; or why not (AiClient.refusal), and the page that lifts it.
  def _photos(user)
    refusal = AiClient.refusal(user)
    unless refusal.nil?
      return {
        "ready": false,
        "refusal": refusal,
        "text": AiClient.refusal_text(refusal),
        "link": @_ai_link(refusal)
      }
    end

    {
      "ready": true,
      "with": "#{AiClient.provider_name(user.ai_provider)}, #{user.ai_model}",
      "left": ScoreReading.left_today(user)
    }
  end
end
