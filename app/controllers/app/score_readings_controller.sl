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
    return render_json({"error": "Choose a photo of the score."}, 422) if data.blank?
    return render_json({"error": "The photo is too large."}, 422) if data.length > SCORE_READER_BYTES

    picture = ScoreReader.picture(data)
    return render_json({"error": "That file is not a picture."}, 422) if picture.nil?

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
    halt(404, "No such reading") unless reading.owned_by?(current_user())

    reading.expire_if_silent
    return render_json({"state": "reading"}.merge(reading.news)) if reading.state == "reading"
    if reading.state == "failed"
      return render_json({"state": "failed", "error": reading.error})
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
    halt(404, "No such reading") unless reading.owned_by?(current_user())

    sse_subscribe(req, ScoreReading.topic(reading._key))
  end

  private

  # The answer refusing one more photo now (`refusal`, ScoreReading.refusal):
  # the day's used up (429), or the key or the plan (403, with its link).
  def _refusal_json(refusal)
    if refusal == "used_up"
      return render_json({"error": "You have read all of today's photos: try again tomorrow."}, 429)
    end

    @_ai_refused(refusal)
  end
end
