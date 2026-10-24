# A photo of a score, read into LilyPond by an AI model (the server's Claude,
# or the person's own key, User#ai_settings): the Start page's card sends the
# picture, then asks after it until the reading is done. Behind sign-in;
# a reading is only its owner's.
class AppScoreReadingsController < AppBaseController
  # POST /app/readings — JSON {picture: base64}: 202 {id}, or an {error}
  def create
    user = current_user()
    no_key = "Add an AI key on your account page to read photos."
    return render_json({"error": no_key}, 503) if user.ai_settings.nil?

    data = (req["json"] ?? params)["picture"].to_s
    return render_json({"error": "Choose a photo of the score."}, 422) if data.blank?
    return render_json({"error": "The photo is too large."}, 422) if data.length > SCORE_READER_BYTES

    picture = ScoreReader.picture(data)
    return render_json({"error": "That file is not a picture."}, 422) if picture.nil?

    refusal = ScoreReading.refusal(user)
    return @_refusal_json(user, refusal) unless refusal.nil?

    reading = ScoreReading.start(user, picture)
    return @_refusal_json(user, reading) if type(reading) == "string"

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

    return render_json({"state": "reading"}) if reading.state == "reading"
    if reading.state == "failed"
      return render_json({"state": "failed", "error": reading.error})
    end

    render_json({
      "state": "done",
      "source": reading.source,
      "svg": ScoreSvg.engrave(reading.source, 1000, 7, 0, {})["svg"]
    })
  end

  private

  # The 429 refusing `user` one more photo today (`refusal`,
  # ScoreReading.refusal): with the way to Pricing when Pro would give more.
  def _refusal_json(user, refusal)
    limits = Plan.limits(user)
    answer = {"error": @_refused(user, refusal, limits)}
    answer["upgrade"] = pricing_path() if refusal == "used_up" && !user.own_ai?() && limits["upgrade"]
    render_json(answer, 429)
  end

  # Why `user` may not read another photo today (`refusal`, ScoreReading.refusal);
  # on the server's key, how to read more.
  def _refused(user, refusal, limits)
    return AI_SERVER_BUSY if refusal == "busy"
    return "You have read all of today's photos: try again tomorrow." if user.own_ai?()

    ScoreReading.used_up_text(limits)
  end
end
