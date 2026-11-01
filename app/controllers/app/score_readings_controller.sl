# A photo of a score, read into LilyPond by an AI model on the person's own
# key (User#ai_settings; the site has no AI of its own, #396): the Start
# page's card and the editor's File menu send the picture, then follow it
# (events, #435) and ask after it until the reading is done. Behind sign-in; a reading is only its owner's.
class AppScoreReadingsController < AppBaseController
  # POST /app/readings — JSON {picture: base64}: 202 {id}, or an {error}
  # (with the `link` that lifts it when it is the key or the plan)
  def create
    user = current_user()
    allowed = AiClient.refusal(user)
    return @_ai_refused(allowed) unless allowed.nil?

    data = (req["json"] ?? params)["picture"].to_s
    return render_json({"error": SiteText.t("app.readings.choose_photo")}, 422) if data.blank?
    return render_json({"error": SiteText.t("app.readings.too_large")}, 422) if data.length > SCORE_READER_BYTES

    picture = ScoreReader.picture(data)
    return render_json({"error": SiteText.t("app.readings.not_picture")}, 422) if picture.nil?

    refusal = ScoreReading.refusal(user)
    return @_refusal_json(refusal) unless refusal.nil?

    reading = ScoreReading.start(user, picture)
    return @_refusal_json(reading) if type(reading) == "string"

    render_json(
      {"id": reading._key, "state": reading.state},
      202
    )
  end

  # GET /app/readings/:id — {state}, with `source` and its `svg` once done,
  # or `error` once failed
  def show
    reading = ScoreReading.find(params["id"])
    halt(404, SiteText.t("app.readings.no_such")) unless reading.owned_by?(current_user())

    reading.expire_if_silent
    if reading.state == "reading"
      news = {"state": "reading"}.merge(reading.news)
      # What is written so far, engraved, for the import's page (#462).
      if params["svg"] == "1" && reading.phase == "writing"
        news["draft_svg"] = ScoreReader.draft_svg(reading.draft)
      end
      return render_json(news)
    end
    if reading.state == "failed"
      return render_json({"state": "failed", "error": reading.shown_error})
    end

    render_json({
      "state": "done",
      "source": reading.source,
      "svg": ScoreSvg.engrave(reading.source, 1000, 7, 0, {})["svg"]
    })
  end

  # GET /app/readings/:id/events — server-sent events while it is read:
  # "progress" (its phase, the LilyPond so far, the seconds since it started)
  # and "done", then the reading is asked after (show) as before (#435)
  def events
    reading = ScoreReading.find(params["id"])
    halt(404, SiteText.t("app.readings.no_such")) unless reading.owned_by?(current_user())

    sse_subscribe(req, ScoreReading.topic(reading._key))
  end

  # GET /app/imports — the photos read, being read or not read, the latest first (#465)
  def index
    @readings = ScoreReading.of(current_user())
    @title = SiteText.t("app.readings.imports_title")
    @description = SiteText.t("app.readings.imports_description")
  end

  # GET /app/imports/:id — one photo's reading: followed live, the score
  # growing as it is written (#462); kept as a score, or tried again
  def watch
    @reading = @_own_reading
    @reading.expire_if_silent
    @eui_version = ScoreAssets.version
    @figure = @reading.state == "done" ? ScoreSvg.figure(@reading.source, 1000, 7) : nil
    @title = @reading.title
    @description = SiteText.t("app.readings.watch_description")
  end

  # POST /app/imports/:id/score — what was read, kept as a new score, opened in the editor
  def keep
    reading = @_own_reading
    halt(422, SiteText.t("app.readings.not_read_yet")) unless reading.state == "done"

    score = Score.start(current_user(), reading.source)
    halt(422, SiteText.t("app.readings.not_created")) if score._errors

    redirect(app_score_path(score))
  end

  # POST /app/imports/:id/retry — the same photo read again
  def retry
    reading = @_own_reading
    halt(422, SiteText.t("app.readings.picture_gone")) if reading.picture.blank?
    halt(422, SiteText.t("app.readings.still_reading")) if reading.state == "reading"

    refusal = ScoreReading.refusal(current_user())
    unless refusal.nil?
      flash("error", ScoreReading.refusal_words(refusal))
      return redirect(app_import_path(reading._key))
    end

    again = ScoreReading.start(current_user(), reading.picture)
    halt(422, again.to_s) if type(again) == "string"

    redirect(app_import_path(again._key))
  end

  private

  # The reading of the route, if it is the signed-in person's (404 otherwise).
  def _own_reading
    reading = ScoreReading.find(params["id"])
    halt(404, SiteText.t("app.readings.no_such")) unless reading.owned_by?(current_user())

    reading
  end

  # The answer refusing one more photo now (`refusal`, ScoreReading.refusal):
  # the day's used up (429), or the key or the plan (403, with its link).
  def _refusal_json(refusal)
    return render_json({"error": SiteText.t("app.readings.used_up")}, 429) if refusal == "used_up"

    @_ai_refused(refusal)
  end
end
