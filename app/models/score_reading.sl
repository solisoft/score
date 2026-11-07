# A photo of a score being read into LilyPond by an AI model (ScoreReader),
# in a job (ScoreReadingJob): "reading", then "done" with its `source` or
# "failed" with its `error`. The picture is kept only while it is read.
# Read only with a person's own AI key, when their plan allows it
# (AiClient.refusal, #396). SCORE_READINGS_OWN_PER_DAY in any 24 hours: their
# provider bills them, so this only stops a runaway loop.
const SCORE_READINGS_OWN_PER_DAY = 200
# And so many photos sent a minute (#684), counted before the picture is
# opened (ScoreReader.picture costs a decoding, a refused one too): six,
# more than anyone reads by hand.
const SCORE_READINGS_PER_MINUTE = 6
# A reading or a suggestion with no news for this many seconds was cut off
# (a restart, a deploy: their jobs are not retried) and never will finish:
# DataCleanupJob marks it failed and lets its picture or its text go. A
# reading's news is its last progress (#435), else its start: one that keeps
# streaming is not cut off however long it takes.
const SCORE_AI_STUCK_SECONDS = 600
# No news of a reading for this long: its job is gone (#463). A streamed
# answer sends some every few seconds while it lasts (AI_PROGRESS_EVERY), and
# waits AI_STREAM_IDLE at most for the provider's next piece.
const SCORE_READING_SILENT = 240
# How long a photo is kept with its reading, for the imports page and Try
# again (#465); the reading itself, how long it is listed.
const SCORE_READING_PICTURE_DAYS = 7
const SCORE_READING_KEPT_DAYS = 30
# The fixed sentences a reading may fail with (kept in English, as the MCP
# server reads them), said in the page's language by shown_error (#505).
const SCORE_READING_ERROR_KEYS = [
  "app.readings.interrupted",
  "app.readings.went_wrong",
  "app.readings.unreadable",
  "app.readings.no_music",
  "app.readings.no_key",
  "app.readings.pro_only"
]

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

  # Whether `user` has sent SCORE_READINGS_PER_MINUTE photos this minute
  # already: each asking counts (RateCount), whether its picture is read or
  # not.
  static def held?(user)
    !RateCount.take("reading-photo:#{user._key}", SCORE_READINGS_PER_MINUTE, 60)
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

  # Failed, when it is still "reading" with no news for SCORE_READING_SILENT
  # seconds — its job gone with a restart, or the provider silent (#463):
  # whoever asks after it is told at once, not at the nightly clean-up.
  # Answers whether it was.
  def expire_if_silent
    return false unless @state == "reading"

    last = (@progressed_at ?? @created_at).to_s.to_i
    return false if DateTime.utc.to_unix - last < SCORE_READING_SILENT

    @state = "failed"
    @error = SiteText.t("app.readings.interrupted", {}, "en")
    @finished_at = DateTime.utc.to_unix
    @save
    true
  end

  # `user`'s readings, the latest first (#465): the imports page's list,
  # without their pictures.
  static def of(user, count = 30)
    ScoreReading.where({"user_id": user._key}).select(
      "state",
      "phase",
      "draft",
      "thought",
      "source",
      "error",
      "created_at",
      "progressed_at",
      "finished_at"
    ).order("created_at", "desc").limit(count).all
  end

  # How many of `user`'s readings are going on.
  static def going(user)
    ScoreReading.where({"user_id": user._key, "state": "reading"}).count
  end

  # The pictures kept past SCORE_READING_PICTURE_DAYS let go, and the
  # readings past SCORE_READING_KEPT_DAYS taken away (#465). Answers how many readings went.
  static def let_go
    now = DateTime.utc.to_unix
    picture_since = now - SCORE_READING_PICTURE_DAYS * 86400
    @sdbql{
      FOR reading IN score_readings
      FILTER reading.picture != null AND reading.state != "reading" AND reading.created_at < #{picture_since}
      UPDATE reading WITH { picture: null } IN score_readings
    }
    old = ScoreReading.where("doc.created_at < @since", {"since": now - SCORE_READING_KEPT_DAYS * 86400})
    count = old.count
    old.delete_all
    count
  end

  # The title what was read (or is being written) gives, else "Photo of
  # <when>" in the page's language.
  def title

    # What was read, else what is being written (#465): its title as soon as it has one.
    written = @source.blank? ? @draft.to_s : @source.to_s
    found = written.blank? ? nil : Score.title_in(written)
    return found unless found.nil?

    taken = DateTime.from_unix(@created_at.to_s.to_i).format(SiteText.t("app.readings.photo_of_format"))
    SiteText.t("app.readings.photo_of", {"when": taken})
  end

  # Why it failed, in the page's language when it is one of the fixed
  # sentences (SCORE_READING_ERROR_KEYS); the provider's own words as they
  # came. `error` stays English: the MCP server reads it.
  def shown_error
    said = @error.to_s
    known = SCORE_READING_ERROR_KEYS.filter do |key|
      SiteText.t(key, {}, "en") == said
    end
    known.length > 0 ? SiteText.t(known[0]) : said
  end

  # What a page says of a refusal (ScoreReading.refusal) to read one more
  # photo, in its language.
  static def refusal_words(refusal)
    return SiteText.t("app.readings.used_up") if refusal == "used_up"

    SiteText.t(refusal == "plan" ? "app.readings.pro_only" : "app.readings.no_key")
  end

  # The readings still "reading" after SCORE_AI_STUCK_SECONDS: failed, their
  # picture dropped. Answers how many.
  static def expire_stuck
    since = DateTime.utc.to_unix - SCORE_AI_STUCK_SECONDS
    stuck = ScoreReading.where(
      "doc.state == @state AND (doc.progressed_at != null ? doc.progressed_at : doc.created_at) < @since",
      {"state": "reading", "since": since}
    ).limit(5000).all
    stuck.each do |reading|
      reading.state = "failed"
      reading.error = SiteText.t("app.readings.interrupted", {}, "en")
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

    outcome = @_outcome rescue {"error": SiteText.t("app.readings.went_wrong", {}, "en")}
    @state = outcome["error"].nil? ? "done" : "failed"
    @source = outcome["source"]
    @error = outcome["error"]
    # The photo kept with what was read, for the imports page and Try again (#465);
    # the nightly clean-up lets it go after SCORE_READING_PICTURE_DAYS.
    @finished_at = DateTime.utc.to_unix
    @save
    # The pages following it ask after it once more, and stop listening.
    sse_broadcast(ScoreReading.topic(@_key), JSON.stringify({"state": @state}), "done")
    true
  end

  # What the AI answered, or why there is no answer: asked again here, as
  # the key or the plan may have gone since the reading was queued.
  def _outcome
    user = User.find(@user_id)
    settings = AiClient.settings_for(user)
    return {"error": AiClient.refusal_text(AiClient.refusal(user))} if settings.nil?

    reading = this
    ScoreReader.read(@picture.to_s, settings, fn(phase, text, thought) {
      reading.progressed(phase, text, thought)
    })
  end

  # The reading's news as the answer comes (#435): kept, for whoever asks
  # after it, and told at once to the pages following it (`events`).
  def progressed(phase, text, thought = 0)
    @phase = phase
    @draft = text
    @thought = thought
    @progressed_at = DateTime.utc.to_unix
    @save
    sse_broadcast(ScoreReading.topic(@_key), JSON.stringify(@news), "progress")
  end

  # What a page following the reading is told: its phase, the LilyPond
  # written so far, and the seconds since it started.
  def news
    {
      "phase": @phase ?? "waiting",
      "draft": @draft.to_s,
      "thought": @thought.to_s.to_i,
      "seconds": DateTime.utc.to_unix - @created_at
    }
  end

  # The topic the pages following reading `key` listen to.
  static def topic(key)
    "reading:#{key}"
  end

  def owned_by?(user)
    !user.nil? && @user_id == user._key
  end
end
