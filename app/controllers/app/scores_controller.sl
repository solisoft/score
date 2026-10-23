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
    @shared = ScoreShare.shared_with(@user)
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
    # Shared to read only: the read page, not the editor.
    return redirect(shared_score_path(@score.share_token)) unless @score.writable_by?(current_user())

    @owner = @score.owned_by?(current_user())
    @source = @score.source
    @figure = ScoreSvg.figure(@source, 1000, 7)
    @examples = ScoreLibrary.examples
    @eui_version = ScoreAssets.version
    @editing_score = @score
    @ai_with = @_ai_with(current_user())
    @title = @score.title
    @description = "#{this.score.title}, in the EUI Score editor."
  end

  # GET /app/scores/:id/room_ticket — JSON {ticket}: the editor's way into the
  # score's live room (ScoreRoom), asked for before each (re)connect
  def room_ticket
    score = @_score("update")
    halt(404, "That score is in the trash.") if score.trashed?

    render_json({"ticket": ScoreRoom.ticket(score, current_user(), DateTime.utc.to_unix)})
  end

  # PUT /app/scores/:id — the editor's autosave, JSON {source, revision}:
  # 200 {revision, title}, or 409 with the score as it now stands when it
  # was changed elsewhere since `revision` (see Score#save_from_editor)
  def update
    score = @_score("update")
    body = req["json"] ?? params
    saved = score.save_from_editor(body["source"].to_s, body["revision"].to_s.to_i)
    ScoreRoom.tell_saved(score, body["origin"]) if saved["status"] == 200
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
    score = @_score("show")
    copy = score.duplicate(current_user())
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
    ScoreShare.delete_all_for(score)
    score.delete
    flash("notice", "“#{score.title}” is deleted.")
    redirect(app_trash_path())
  end

  # GET /app/scores/:id/share — who may read or change the score, its link,
  # the code to embed it on a site
  def share
    @score = @_score("share")
    @_share_page(@score)
    @error = ""
  end

  # POST /app/scores/:id/share — visibility: private, link or public
  def update_sharing
    score = @_score("share")
    halt(422, "Choose private, link or public.") unless score.make_visible(params["visibility"].to_s)

    flash("notice", "“#{score.title}” is now #{this._visibility_words[score.visibility]}.")
    redirect(app_score_share_path(score))
  end

  # POST /app/scores/:id/share/link — a new link; the old one stops working
  def new_link
    score = @_score("share")
    score.new_link
    flash("notice", "A new link: the old one no longer opens the score.")
    redirect(app_score_share_path(score))
  end

  # POST /app/scores/:id/invitations — share with an email address, read or write
  def invite
    @score = @_score("share")
    share = ScoreShare.invite(@score, params["email"].to_s, params["role"].to_s)
    if type(share) == "hash"
      @_share_page(@score)
      @error = share["error"]
      return render("app/scores/share", {}, {"status": 422})
    end

    ShareMailer.invited(share, @score, current_user().email).deliver_now rescue nil
    flash(
      "notice",
      "#{share.email} may now #{share.role == "write" ? "open and change" : "open"} “#{this.score.title}”."
    )
    redirect(app_score_share_path(@score))
  end

  # DELETE /app/scores/:id/invitations/:share_id — no longer shared with them
  def uninvite
    score = @_score("share")
    share = ScoreShare.find(params["share_id"])
    halt(404, "Not shared that way") unless share.score_id == score._key

    share.delete
    flash("notice", "#{share.email} no longer has “#{score.title}”.")
    redirect(app_score_share_path(score))
  end

  private

  # What the share page shows of `score`.
  def _share_page(score)

    # A score saved before links existed gets its own now (Score#stamp).
    score.save if score.share_token.blank?
    @shares = ScoreShare.of(score)
    # Paths: the view makes them absolute (absolute_url is a view helper).
    @read_path = shared_score_path(score.share_token)
    @source_path = "#{shared_score_path(score.share_token)}/source.ly"
    @choices = [
      ["private", "Private", "You, and the people you invite below."],
      ["link", "Anyone with the link", "Not listed anywhere: whoever has the link may read it, play it and print it."],
      ["public", "Public", "Anyone, and search engines may list it."]
    ]
    @title = "Share “#{score.title}”"
    @description = "Who may read or change #{score.title}."
  end

  def _visibility_words
    {
      "private": "private",
      "link": "open to whoever has its link",
      "public": "public"
    }
  end

  # Which AI the editor's assistant answers with, in a sentence.
  def _ai_with(user)
    settings = user.ai_settings
    return "There is no AI key yet: add one on your account page." if settings.nil?

    left = "#{ScoreSuggestion.left_today(user)} questions left today."
    return "Answered by Claude. #{left}" unless settings["own"]

    "Answered by #{AiClient.provider_name(settings["provider"])}, #{settings["model"]}, with your key. #{left}"
  end

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
