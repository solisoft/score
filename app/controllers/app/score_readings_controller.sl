# A photo of a score, read into LilyPond by Claude: the Import card sends the
# picture, then asks after it until the reading is done. Behind sign-in;
# a reading is only its owner's.
class AppScoreReadingsController < AppBaseController
  # POST /app/readings — JSON {picture: base64}: 202 {id}, or an {error}
  def create
    return render_json({"error": "Reading photos is not available here."}, 503) unless ScoreReader.available?()

    user = current_user()
    data = (req["json"] ?? params)["picture"].to_s
    return render_json({"error": "Choose a photo of the score."}, 422) if data.blank?
    return render_json({"error": "The photo is too large."}, 422) if data.length > SCORE_READER_BYTES

    picture = ScoreReader.picture(data)
    return render_json({"error": "That file is not a picture."}, 422) if picture.nil?

    used_up = "You have read #{SCORE_READINGS_PER_DAY} photos today: try again tomorrow."
    return render_json({"error": used_up}, 429) if ScoreReading.left_today(user) <= 0

    reading = ScoreReading.start(user, picture)
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
end
