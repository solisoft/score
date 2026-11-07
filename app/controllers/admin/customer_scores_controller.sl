# A customer's score as an admin reads it (#626): engraved, its LilyPond,
# its facts and its versions — read only. Nothing here changes the score,
# its sharing or its trash; there is no editor. The score must be the
# customer's own (404 otherwise), in the trash or not. Each read is kept as
# an AdminAction ("view_score"), shown on the customer's page and in the
# admin section's Activity.
class AdminCustomerScoresController < AdminBaseController
  # GET /admin/customers/:id/scores/:score_id
  def show
    @customer = User.find(params["id"])
    @score = @_score_of(@customer)
    @figure = @_figure(@score.source)
    return ScoreSvg.too_many if @figure["throttled"]

    @versions = ScoreVersion.history(@score)
    @authors = ScoreVersion.authors_of(@versions)
    @shares = ScoreShare.of(@score)
    # Only a score open by link or to everyone, out of the trash, has a read page.
    by_link = ["link", "public"].includes?(@score.visibility) && !@score.trashed?
    @read_page = by_link ? shared_score_path(this.score.share_token) : nil
    @_record({})
    @title = "#{this.score.title} · Admin"
    @description = "One score of an account, read only."
  end

  # GET /admin/customers/:id/scores/:score_id/versions/:version_id
  def version
    @customer = User.find(params["id"])
    @score = @_score_of(@customer)
    @version = ScoreVersion.find(params["version_id"])
    halt(404, "Not found") unless @version.score_id == @score._key

    @figure = @_figure(@version.source)
    return ScoreSvg.too_many if @figure["throttled"]

    @_record({"version": @version._key})
    @title = "#{this.version.title} · Admin"
    @description = "One version of a score of an account, read only."
  end

  private

  # The score of the URL, if it is `customer`'s own; a 404 otherwise.
  def _score_of(customer)
    score = Score.find(params["score_id"])
    halt(404, "Not found") unless score.user_id == customer._key

    score
  end

  # Engraved as the read page does, counted against the admin's engravings.
  def _figure(source)
    ScoreSvg.figure(source, 1040, 7, ScoreSvg.sender("page", current_user(), client_ip(req)))
  end

  # The read kept: which admin, which score, whose — or a 503 and no page
  # when it cannot be (#687, AdminAction.kept).
  def _record(details)
    AdminAction.kept(current_user(), "view_score", "score", @score._key, {
      "owner": @customer._key,
      "title": @score.title
    }.merge(details))
  end
end
