# The audio tracks of a score (#390), in JSON for the editor: the takes
# recorded from the microphone (ScoreTake), and their sound. Behind
# `require_login`; the score must be out of the trash and one the signed-in
# person may see through their account. Its owner and those it is shared
# with to change it record and delete (ScorePolicy update?); those it is
# shared with to read list and listen (show?).
class AppTakesController < AppBaseController
  # GET /app/scores/:id/takes — {takes, tracks, max_bytes, writable}
  def index
    score = @_score("show")
    render_json({
      "takes": ScoreTake.of(score).map(&:shown),
      "tracks": SCORE_TAKE_TRACKS,
      "max_bytes": SCORE_TAKE_MAX_BYTES,
      "writable": score.writable_by?(current_user())
    })
  end

  # POST /app/scores/:id/takes — multipart: `audio` (a WAV), `track`,
  # `name`, `offset`, `rate`, `duration`. 201 {take}, in place of the
  # track's last take; 422 {error} with nothing written
  def create
    score = @_score("update")
    recorded = ScoreTake.record(score, current_user(), params, find_uploaded_file(req, "audio"))
    return render_json({"error": recorded["error"]}, 422) unless recorded["error"].nil?

    render_json({"take": recorded["take"].shown}, 201)
  end

  # GET /app/scores/:id/takes/:take_id/audio — the take's WAV, streamed
  def audio
    score = @_score("show")
    @_take_of(score).audio_response(req)
  end

  # DELETE /app/scores/:id/takes/:take_id — {gone}
  def destroy
    score = @_score("update")
    take = @_take_of(score)
    take.remove
    render_json({"gone": take._key})
  end

  private

  # The score of the route, if the signed-in person may `action` it (403
  # otherwise; 404 for no such score, or one in the trash).
  def _score(action)
    score = authorize(Score.find(params["id"]), action)
    halt(404, "That score is in the trash.") if score.trashed?

    score
  end

  # The take of the route, if it is one of `score`'s (404 otherwise).
  def _take_of(score)
    take = ScoreTake.find(params["take_id"])
    halt(404, "No such take on this score") unless take.score_id == score._key

    take
  end
end
