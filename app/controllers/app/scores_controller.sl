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

  # POST /app/scores — a score from `source` (a template, an imported file,
  # the playground's draft), titled `title` when it has none; blank without
  # one. Opened in the editor.
  def create
    source = params["source"].to_s
    title = params["title"].to_s
    source = Score.blank_source(title) if source.blank?
    source = Score.with_title(source, title) if Score.title_in(source).nil? && !title.blank?
    score = Score.start(current_user(), source)
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
    @editing_score = @score
    @title = @score.title
    @description = "#{this.score.title}, in the EUI Score editor."
  end

  # PUT /app/scores/:id — the editor's autosave, JSON {source, revision}:
  # 200 {revision, title}, or 409 with the score as it now stands when it
  # was changed elsewhere since `revision` (see Score#save_from_editor)
  def update
    score = @_score("update")
    body = req["json"] ?? params
    saved = score.save_from_editor(body["source"].to_s, body["revision"].to_s.to_i)
    render_json(saved["body"], saved["status"])
  end

  # POST /app/scores/:id/versions — keep the score as it stands, from the editor
  def keep_version
    score = @_score("update")
    version = ScoreVersion.keep(score, score.source, "manual")
    render_json(
      {"version": version._key, "created_at": version.created_at},
      201
    )
  end

  # GET /app/scores/:id/versions — the score's history
  def versions
    @score = @_score("show")
    @versions = ScoreVersion.history(@score)
    @reasons = {
      "auto": "kept on the way",
      "manual": "kept on request",
      "restore": "before a restore",
      "conflict": "not saved: changed elsewhere"
    }
    @title = "History of #{this.score.title}"
    @description = "The versions kept of #{this.score.title}."
  end

  # GET /app/scores/:id/versions/:version_id — one version, engraved
  def version
    @score = @_score("show")
    @version = @_version_of(@score)
    @figure = ScoreSvg.figure(@version.source, 1000, 7)
    @title = "#{this.version.title} — a version"
    @description = "A version of #{this.score.title}."
  end

  # POST /app/scores/:id/versions/:version_id/restore — the score as it was
  def restore_version
    score = @_score("update")
    score.restore_version(@_version_of(score))
    flash("notice", "The score is back as it was. What it was just before is kept in its history.")
    redirect(app_score_path(score))
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

    ScoreVersion.delete_all_for(score)
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

  # The version of the route, if it is one of `score`'s (404 otherwise).
  def _version_of(score)
    version = ScoreVersion.find(params["version_id"])
    halt(404, "No such version of this score") unless version.score_id == score._key

    version
  end
end
