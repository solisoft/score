# The editor's AI assistant at work on a score (ScoreAssistant), in a job
# (ScoreSuggestionJob): "working", then "done" with the new `source` and
# its `explanation`, or "failed" with its `error`. The score itself does
# not change: the editor applies the suggestion when the person says so.
# A person may ask SCORE_SUGGESTIONS_PER_DAY in any 24 hours on the server's
# key on Free (Pro: Plan), SCORE_SUGGESTIONS_OWN_PER_DAY on a key of their own (as many as they
# may read photos with it, ScoreReading).
const SCORE_SUGGESTIONS_PER_DAY = 30
const SCORE_SUGGESTIONS_OWN_PER_DAY = 200
# The longest request one may write to the assistant, in characters.
const SCORE_SUGGESTION_REQUEST_LIMIT = 2000

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
  # handed to the job; or, when it may not be, why (`refusal`), with
  # nothing kept and nothing queued. Counted once written: of two asked at
  # once for the last one, neither passes unseen by the other.
  static def start(user, score, action, request, source)
    suggestion = ScoreSuggestion.create({
      "user_id": user._key,
      "score_id": score._key,
      "action": action,
      "request": request.to_s.trim,
      "original": source,
      "state": "working",
      "own": user.own_ai?(),
      "created_at": DateTime.utc.to_unix
    })
    refusal = ScoreSuggestion.refusal(user, 1)
    unless refusal.nil?
      suggestion.delete
      return refusal
    end

    ScoreSuggestionJob.perform_later({"suggestion_id": suggestion._key}, {"max_retries": 0})
    suggestion
  end

  # Why `user` may not ask one more now, or nil: "used_up" (their day's),
  # "busy" (the server key's day, AI_SERVER_ASKS_PER_DAY, for those without
  # a key of their own). `counted`: 1 once the suggestion is written, as it
  # then counts itself.
  static def refusal(user, counted = 0)
    return "used_up" if ScoreSuggestion.used_today(user) - counted >= ScoreSuggestion.limit_for(user)
    return nil if user.own_ai?()
    return "busy" if AiClient.server_used_today - counted >= AI_SERVER_ASKS_PER_DAY

    nil
  end

  # How many more `user` may ask now.
  static def left_today(user)
    [ScoreSuggestion.limit_for(user) - ScoreSuggestion.used_today(user), 0].max()
  end

  # What someone on `limits` (Plan.limits) reads once their day on the
  # site's key is used up: on Free with payments open, the way to Pro.
  static def used_up_text(limits)
    day = limits["suggestions_per_day"]
    more = "or add your own AI key on your account page to ask more."
    if limits["upgrade"]
      return "You have asked the #{day} questions a day the site's AI answers on Free: try again tomorrow, "
      + "move to Pro for #{Plan.pro_limits["suggestions_per_day"]} a day, "
      + more
    end

    if limits["plan"] == "pro"
      return "You have asked the #{day} questions a day the site's AI answers on Pro: try again tomorrow, "
      + more
    end

    "You have asked the #{day} questions a day the site's AI answers: try again tomorrow, " + more
  end

  static def limit_for(user)
    user.own_ai?() ? SCORE_SUGGESTIONS_OWN_PER_DAY : Plan.limits(user)["suggestions_per_day"]
  end

  # The suggestions `user` asked for in the last 24 hours.
  static def used_today(user)
    since = DateTime.utc.to_unix - 86400
    ScoreSuggestion.where(
      "doc.user_id == @user AND doc.created_at > @since",
      {"user": user._key, "since": since}
    ).count
  end

  # The suggestions still "working" after SCORE_AI_STUCK_SECONDS: failed,
  # the score's text and the request sent with them dropped. Answers how many.
  static def expire_stuck
    since = DateTime.utc.to_unix - SCORE_AI_STUCK_SECONDS
    stuck = ScoreSuggestion.where(
      "doc.state == @state AND doc.created_at < @since",
      {"state": "working", "since": since}
    ).limit(5000).all
    stuck.each do |suggestion|
      suggestion.state = "failed"
      suggestion.error = "The request was interrupted. Try again."
      suggestion.original = nil
      suggestion.request = nil
      suggestion.finished_at = DateTime.utc.to_unix
      suggestion.save
    end
    stuck.length
  end

  # What was asked of `score`: it is going.
  static def delete_all_for(score)
    ScoreSuggestion.where({"score_id": score._key}).delete_all
  end

  # Every request `user` made, scores' texts included: their account is going.
  static def delete_all_of(user)
    ScoreSuggestion.where({"user_id": user._key}).delete_all
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
