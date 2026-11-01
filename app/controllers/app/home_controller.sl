# The app's first screen: for a guest, what the app is and the way in; for
# someone signed in, where to start — a new score from a template, a file
# to import, a photo to read, the playground's draft or a shared link to keep, and the scores
# changed last.
# The ids of public/eui-score/score-model.js's TEMPLATES, whose words are in
# config/locales (app.home.templates).
const HOME_TEMPLATE_IDS = [
  "blank",
  "piano",
  "voice-piano",
  "lead-sheet",
  "satb",
  "satb-piano",
  "string-quartet",
  "wind-quintet",
  "guitar",
  "band",
  "drums"
]

class AppHomeController < AppBaseController
  # GET /app
  def index
    @user = current_user()
    @recent = @user.nil? ? [] : Score.recent(@user, 6)
    @eui_version = ScoreAssets.version
    @photos = @user.nil? ? nil : @_photos(@user)
    # Photos being read, found again from here (#465).
    @photos_going = @user.nil? ? 0 : ScoreReading.going(@user)
    @title = SiteText.t(@user.nil? ? "app.home.guest_title" : "app.home.title")
    @description = SiteText.t("app.home.description")
    # The templates' names in the app's language (#505); in English, the
    # score model's own.
    @template_words = I18n.locale() == "en" ? {} : @_template_words
  end

  private

  # Each template's name and line, by its id in the score model's TEMPLATES.
  def _template_words
    words = {}
    for id in HOME_TEMPLATE_IDS
      key = "app.home.templates.#{id.replace("-", "_")}"
      words[id] = {"name": SiteText.t(key), "about": SiteText.t("#{key}_about")}
    end
    words
  end

  # What the photo card says: whether photos can be read, with what and how
  # many more today; or why not (AiClient.refusal), and the page that lifts it.
  def _photos(user)
    refusal = AiClient.refusal(user)
    unless refusal.nil?
      return {
        "ready": false,
        "refusal": refusal,
        "text": AiClient.refusal_words(refusal),
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
