# The library: a signed-in person's scores — listed, opened in the editor,
# renamed, copied, moved to the trash and back. Behind `require_login`;
# ScorePolicy keeps each score to its owner.
class AppScoresController < AppBaseController
  # GET /app/scores — ?q= searches the titles, ?sort= updated|title|created
  def index
    @user = current_user()
    Score.purge_trash(@user)
    @query = params["q"].to_s
    @sort = ["title", "created"].includes?(params["sort"].to_s) ? params["sort"].to_s : "updated"
    @scores = Score.library(@user, @query, @sort)
    @trash_count = Score.trash_of(@user).length
    @title = "Your scores"
    @description = "Your scores, saved to your account."
  end

  # GET /app/trash — what was moved to the trash, kept SCORE_TRASH_DAYS days
  def trash
    @user = current_user()
    Score.purge_trash(@user)
    @scores = Score.trash_of(@user)
    @trash_days = SCORE_TRASH_DAYS
    @title = "Trash"
    @description = "Scores moved to the trash."
  end

  # POST /app/scores — a blank score, opened in the editor
  def create
    score = Score.start(current_user(), Score.blank_source(params["title"].to_s))
    halt(422, "That score could not be created.") if score._errors

    redirect(app_score_path(score))
  end

  # GET /app/scores/:id — the score in the editor
  def show
    @score = @_score("show")
    return redirect(app_trash_path()) if @score.trashed?

    @source = @score.source
    @figure = ScoreSvg.figure(@source, 1000, 7)
    @examples = ScoreLibrary.examples
    @eui_version = ScoreAssets.version
    @title = @score.title
    @description = "#{this.score.title}, in the EUI Score editor."
  end

  # GET /app/scores/:id/preview.svg — the first systems, for the library's card
  def preview
    score = @_score("show")
    {
      "status": 200,
      "headers": {"Content-Type": "image/svg+xml", "Cache-Control": "private, max-age=86400"},
      "body": ScoreSvg.preview(score.source)
    }
  end

  # POST /app/scores/:id/rename
  def rename
    score = @_score("update")
    score.rename(params["title"].to_s)
    flash("notice", "Renamed “#{score.title}”.")
    redirect(app_scores_path())
  end

  # POST /app/scores/:id/duplicate
  def duplicate
    score = @_score("update")
    copy = score.duplicate
    flash("notice", "“#{copy.title}” is a copy of “#{score.title}”.")
    redirect(app_scores_path())
  end

  # POST /app/scores/:id/trash
  def move_to_trash
    score = @_score("destroy")
    score.move_to_trash
    flash("notice", "“#{score.title}” is in the trash for #{SCORE_TRASH_DAYS} days.")
    redirect(app_scores_path())
  end

  # POST /app/scores/:id/restore
  def restore
    score = @_score("destroy")
    score.restore_from_trash
    flash("notice", "“#{score.title}” is back in your scores.")
    redirect(app_trash_path())
  end

  # DELETE /app/scores/:id — for good, from the trash only
  def destroy
    score = @_score("destroy")
    halt(422, "Move the score to the trash first.") unless score.trashed?

    score.delete
    flash("notice", "“#{score.title}” is deleted.")
    redirect(app_trash_path())
  end

  private

  # The score of the route, if the signed-in person may `action` it (403
  # otherwise; 404 for no such score).
  def _score(action)
    authorize(Score.find(params["id"]), action)
  end
end
