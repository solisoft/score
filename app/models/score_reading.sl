# A photo of a score being read into LilyPond by an AI model (ScoreReader),
# in a job (ScoreReadingJob): "reading", then "done" with its `source` or
# "failed" with its `error`. The picture is kept only while it is read.
# Read only with a person's own AI key, when their plan allows it
# (AiClient.refusal, #396). SCORE_READINGS_OWN_PER_DAY in any 24 hours: their
# provider bills them, so this only stops a runaway loop.
const SCORE_READINGS_OWN_PER_DAY = 200
# A reading or a suggestion still at work after this many seconds was cut off
# (a restart, a deploy: their jobs are not retried) and never will finish:
# DataCleanupJob marks it failed and lets its picture or its text go.
const SCORE_AI_STUCK_SECONDS = 600

class ScoreReading < Model
  validates("user_id", {"presence": true})
  validates("state", {"inclusion": [
    "reading",
    "done",
    "failed"
  ]})

  # A reading of `picture` (base64 JPEG) for `user`, handed to the job; or,
  # when it may not be, why (`refusal`), with nothing kept and nothing
  # queued. Counted once written: of two asked at once for the last one,
  # neither passes unseen by the other.
  # `open`: whether payments are open (Plan.open? when nil).
  static def start(user, picture, open = nil)
    refusal = AiClient.refusal(user, open)
    return refusal unless refusal.nil?

    reading = ScoreReading.create({
      "user_id": user._key,
      "state": "reading",
      "picture": picture,
      "created_at": DateTime.utc.to_unix
    })
    refusal = ScoreReading.refusal(user, 1, open)
    unless refusal.nil?
      reading.delete
      return refusal
    end

    ScoreReadingJob.perform_later({"reading_id": reading._key}, {"max_retries": 0})
    reading
  end

  # Why `user` may not start one more reading now, or nil: AiClient.refusal
  # ("plan", "no_key"), or "used_up" (the day's SCORE_READINGS_OWN_PER_DAY).
  # `counted`: 1 once the reading is written, as it then counts itself.
  static def refusal(user, counted = 0, open = nil)
    ai = AiClient.refusal(user, open)
    return ai unless ai.nil?
    return "used_up" if ScoreReading.used_today(user) - counted >= SCORE_READINGS_OWN_PER_DAY

    nil
  end

  # How many more readings `user` may start now.
  static def left_today(user)
    [SCORE_READINGS_OWN_PER_DAY - ScoreReading.used_today(user), 0].max()
  end

  # The readings `user` started in the last 24 hours.
  static def used_today(user)
    since = DateTime.utc.to_unix - 86400
    ScoreReading.where(
      "doc.user_id == @user AND doc.created_at > @since",
      {"user": user._key, "since": since}
    ).count
  end

  # The readings still "reading" after SCORE_AI_STUCK_SECONDS: failed, their
  # picture dropped. Answers how many.
  static def expire_stuck
    since = DateTime.utc.to_unix - SCORE_AI_STUCK_SECONDS
    stuck = ScoreReading.where(
      "doc.state == @state AND doc.created_at < @since",
      {"state": "reading", "since": since}
    ).limit(5000).all
    stuck.each do |reading|
      reading.state = "failed"
      reading.error = "The reading was interrupted. Try again."
      reading.picture = nil
      reading.finished_at = DateTime.utc.to_unix
      reading.save
    end
    stuck.length
  end

  # Every reading of `user`, pictures and answers: their account is going.
  static def delete_all_of(user)
    ScoreReading.where({"user_id": user._key}).delete_all
  end

  # The job's work: the picture read, the outcome kept, the picture dropped.
  def perform
    return true unless @state == "reading"

    outcome = @_outcome rescue {"error": "Something went wrong while reading the photo. Try again."}
    @state = outcome["error"].nil? ? "done" : "failed"
    @source = outcome["source"]
    @error = outcome["error"]
    @picture = nil
    @finished_at = DateTime.utc.to_unix
    @save
  end

  # What the AI answered, or why there is no answer: asked again here, as
  # the key or the plan may have gone since the reading was queued.
  def _outcome
    user = User.find(@user_id)
    settings = AiClient.settings_for(user)
    return {"error": AiClient.refusal_text(AiClient.refusal(user))} if settings.nil?

    ScoreReader.read(@picture.to_s, settings)
  end

  def owned_by?(user)
    !user.nil? && @user_id == user._key
  end
end
