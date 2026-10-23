# A photo of a score being read into LilyPond by an AI model (ScoreReader),
# in a job (ScoreReadingJob): "reading", then "done" with its `source` or
# "failed" with its `error`. The picture is kept only while it is read.
# A person may start SCORE_READINGS_PER_DAY in any 24 hours on the server's
# key, SCORE_READINGS_OWN_PER_DAY on a key of their own.
const SCORE_READINGS_PER_DAY = 20
const SCORE_READINGS_OWN_PER_DAY = 200

class ScoreReading < Model
  validates("user_id", {"presence": true})
  validates("state", {"inclusion": [
    "reading",
    "done",
    "failed"
  ]})

  # A reading of `picture` (base64 JPEG) for `user`, handed to the job.
  static def start(user, picture)
    reading = ScoreReading.create({
      "user_id": user._key,
      "state": "reading",
      "picture": picture,
      "created_at": DateTime.utc.to_unix
    })
    ScoreReadingJob.perform_later({"reading_id": reading._key}, {"max_retries": 0})
    reading
  end

  # How many more readings `user` may start now.
  static def left_today(user)
    since = DateTime.utc.to_unix - 86400
    used = ScoreReading.where(
      "doc.user_id == @user AND doc.created_at > @since",
      {"user": user._key, "since": since}
    ).count
    limit = user.own_ai?() ? SCORE_READINGS_OWN_PER_DAY : SCORE_READINGS_PER_DAY
    [limit - used, 0].max()
  end

  # The job's work: the picture read, the outcome kept, the picture dropped.
  def perform
    return true unless @state == "reading"

    settings = User.find(@user_id).ai_settings
    outcome = settings.nil? ? {"error": "There is no AI key to read photos with."} : ScoreReader.read(
      @picture.to_s,
      settings
    )
    @state = outcome["error"].nil? ? "done" : "failed"
    @source = outcome["source"]
    @error = outcome["error"]
    @picture = nil
    @finished_at = DateTime.utc.to_unix
    @save
  end

  def owned_by?(user)
    !user.nil? && @user_id == user._key
  end
end
