# The editor's AI assistant at work on a score (ScoreAssistant), in a job
# (ScoreSuggestionJob): "working", then "done" with the new `source` and
# its `explanation`, or "failed" with its `error`. The score itself does
# not change: the editor applies the suggestion when the person says so.
# A person may ask as many a day as they may read photos (ScoreReading).
class ScoreSuggestion < Model
  validates("user_id", {"presence": true})
  validates("score_id", {"presence": true})
  validates("action", {"inclusion": [
    "chords",
    "harmonize",
    "improve",
    "ask"
  ]})
  validates("state", {"inclusion": [
    "working",
    "done",
    "failed"
  ]})

  # `action` asked of `source` (the editor's text of `score`) by `user`,
  # handed to the job.
  static def start(user, score, action, request, source)
    suggestion = ScoreSuggestion.create({
      "user_id": user._key,
      "score_id": score._key,
      "action": action,
      "request": request.to_s.trim,
      "original": source,
      "state": "working",
      "created_at": DateTime.utc.to_unix
    })
    ScoreSuggestionJob.perform_later({"suggestion_id": suggestion._key}, {"max_retries": 0})
    suggestion
  end

  # How many more `user` may ask now.
  static def left_today(user)
    since = DateTime.utc.to_unix - 86400
    used = ScoreSuggestion.where(
      "doc.user_id == @user AND doc.created_at > @since",
      {"user": user._key, "since": since}
    ).count
    limit = user.own_ai?() ? SCORE_READINGS_OWN_PER_DAY : SCORE_READINGS_PER_DAY
    [limit - used, 0].max()
  end

  # The job's work: the assistant asked, the outcome kept.
  def perform
    return true unless @state == "working"

    outcome = @_outcome rescue {"error": "Something went wrong while asking the AI. Try again."}
    @state = outcome["error"].nil? ? "done" : "failed"
    @source = outcome["source"]
    @explanation = outcome["explanation"]
    @error = outcome["error"]
    @finished_at = DateTime.utc.to_unix
    @save
  end

  # What the AI answered, or why there is no answer.
  def _outcome
    settings = User.find(@user_id).ai_settings
    return {"error": "There is no AI key to ask with."} if settings.nil?

    ScoreAssistant.suggest(@original.to_s, @action, @request, settings)
  end

  def owned_by?(user)
    !user.nil? && @user_id == user._key
  end
end
