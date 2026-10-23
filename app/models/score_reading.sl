# A photo of a score being read into LilyPond by Claude (ScoreReader), in a
# job (ScoreReadingJob): "reading", then "done" with its `source` or
# "failed" with its `error`. The picture is kept only while it is read.
# A person may start SCORE_READINGS_PER_DAY in any 24 hours.
const SCORE_READINGS_PER_DAY = 20

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
    [SCORE_READINGS_PER_DAY - used, 0].max()
  end

  # The job's work: the picture read, the outcome kept, the picture dropped.
  def perform
    return true unless @state == "reading"

    outcome = ScoreReader.read(@picture.to_s)
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
