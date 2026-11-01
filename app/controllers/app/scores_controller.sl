# The library: a signed-in person's scores — listed, opened in the editor,
# renamed, copied, moved to the trash and back. Behind `require_login`;
# ScorePolicy keeps each score to its owner.
class AppScoresController < AppBaseController
  # GET /app/scores — ?q= searches the titles and the composers, ?sort=
  # updated|title|created, ?page= SCORE_PAGE_SIZE at a time
  def index
    @user = current_user()
    @query = params["q"].to_s
    @sort = ["title", "created"].includes?(params["sort"].to_s) ? params["sort"].to_s : "updated"
    @page = Score.page_number(params["page"])
    rows = []
    grouped(fn() {
      rows = Score.library_query(@user, @query, @sort, @page).all
      @trash_count = Score.trash_count(@user)
    })
    listing = Score.paged(rows)
    @scores = listing["scores"]
    @more = listing["more"]
    # Another page's address, but for its number, which the view adds.
    library_path = app_scores_path()
    @page_path = library_path + "?q=#{url_encode(this.query)}&sort=#{this.sort}&page="
    @shared = ScoreShare.shared_with(@user)
    @title = SiteText.t("app.scores.index.title")
    @description = SiteText.t("app.scores.index.description")
  end

  # GET /app/trash — what was moved to the trash, kept SCORE_TRASH_DAYS days
  def trash
    @user = current_user()
    @scores = Score.trash_of(@user)
    @trash_days = SCORE_TRASH_DAYS
    @title = SiteText.t("app.scores.trash.title")
    @description = SiteText.t("app.scores.trash.description")
  end

  # POST /app/trash/empty — every score in the trash deleted for good
  def empty_trash
    erased = Score.empty_trash_of(current_user())
    flash(
      "notice",
      SiteText.t(erased == 1 ? "app.scores.flash.erased_one" : "app.scores.flash.erased_other", {"n": erased})
    )
    redirect(app_trash_path())
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
    @studio_preloads = ScoreAssets.studio_preloads
    @editing_score = @score
    @_ai_entry(current_user())
    @ai_request_limit = SCORE_SUGGESTION_REQUEST_LIMIT
    # A section of the library to add after its bars (#451): its data, which the editor fetches.
    section_key = params["section"].to_s
    wanted = Regex.matches("^[A-Za-z0-9-]{1,64}$", section_key)
    @import_section = wanted ? section_data_path(section_key) : ""
    @title = @score.title
    @description = "#{this.score.title}, in the Score editor."
  end

  # GET /app/scores/:id/room_ticket — JSON {ticket}: the editor's way into the
  # score's live room (ScoreRoom), asked for before each (re)connect
  def room_ticket
    score = @_score("update")
    halt(404, "That score is in the trash.") if score.trashed?

    render_json({"ticket": ScoreRoom.ticket(score, current_user(), DateTime.utc.to_unix)})
  end

  # PUT /app/scores/:id — the editor's autosave, JSON {source, revision,
  # anchors}: 200 {revision, title, threads (the comments `anchors` moved,
  # ScoreThread.follow)}, or 409 with the score as it now stands when it
  # was changed elsewhere since `revision` (see Score#save_from_editor);
  # 403 JSON for someone who may not (or no longer) change it
  def update
    score = Score.find(params["id"])
    return @_not_writable unless score.writable_by?(current_user())

    body = req["json"] ?? params
    saved = score.save_from_editor(body["source"].to_s, body["revision"].to_s.to_i, current_user())
    if saved["status"] == 200
      ScoreRoom.tell_saved(score, body["origin"])
      # The comments follow their bars (#392): moved by where the save says they went.
      moved = ScoreThread.moved_views(score, ScoreThread.follow(score, body["anchors"]))
      if moved.length > 0
        ScoreRoom.tell_comments(score, ScoreRoom.moved_news(moved, body["origin"]))
        saved["body"]["threads"] = moved
      end
      # The others who may see it are told, once an hour (#385).
      UserNotification.changed(score, current_user())
    end
    render_json(saved["body"], saved["status"])
  end

  # POST /app/scores/:id/versions — keep the score as it stands, from the editor
  def keep_version
    score = Score.find(params["id"])
    return @_not_writable unless score.writable_by?(current_user())

    version = ScoreVersion.keep(score, score.source, "manual", current_user()._key)
    render_json(
      {"version": version._key, "created_at": version.created_at},
      201
    )
  end

  # GET /app/scores/:id/versions — the score's history, who saved each
  def versions
    @score = @_score("show")
    @versions = ScoreVersion.history(@score)
    @authors = ScoreVersion.authors_of(@versions)
    @reasons = {
      "auto": SiteText.t("app.scores.versions.reason_auto"),
      "manual": SiteText.t("app.scores.versions.reason_manual"),
      "restore": SiteText.t("app.scores.versions.reason_restore"),
      "conflict": SiteText.t("app.scores.versions.reason_conflict")
    }
    @title = SiteText.t("app.scores.versions.title", {"title": @score.title})
    @description = SiteText.t("app.scores.versions.description", {"title": @score.title})
  end

  # GET /app/scores/:id/versions/:version_id — one version, engraved, to
  # play, restore or copy
  def version
    @score = @_score("show")
    @version = @_version_of(@score)
    @figure = ScoreSvg.figure(@version.source, 1000, 7)
    @file_name = @score.file_name
    @can_restore = @score.writable_by?(current_user())
    @title = SiteText.t("app.scores.version.title", {"title": @version.title})
    @description = SiteText.t("app.scores.version.description", {"title": @score.title})
  end

  # POST /app/scores/:id/versions/:version_id/restore — the score as it was
  def restore_version
    score = @_score("update")
    score.restore_version(@_version_of(score), current_user())
    flash("notice", SiteText.t("app.scores.flash.version_restored"))
    redirect(app_score_path(score))
  end

  # POST /app/scores/:id/versions/:version_id/copy — a new score from the
  # version, in the signed-in person's library, opened in the editor
  def copy_version
    score = @_score("show")
    version = @_version_of(score)
    copy = Score.copy_of(current_user()._key, version.source, version.title ?? score.title)
    halt(422, SiteText.t("app.scores.errors.version_not_copied")) if copy._errors

    flash("notice", SiteText.t(
      "app.scores.flash.version_copied",
      {"copy": copy.title, "title": score.title}
    ))
    redirect(app_score_path(copy))
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
    flash("notice", SiteText.t("app.scores.flash.renamed", {"title": score.title}))
    redirect(app_scores_path())
  end

  # POST /app/scores/:id/duplicate — the copy opened in the editor
  def duplicate
    score = @_score("show")
    copy = score.duplicate(current_user())
    halt(422, SiteText.t("app.scores.errors.not_copied")) if copy._errors

    flash("notice", SiteText.t(
      "app.scores.flash.copied",
      {"copy": copy.title, "title": score.title}
    ))
    redirect(app_score_path(copy))
  end

  # POST /app/scores/:id/leave — a score shared with you, off your list: your
  # share goes, the score stays its owner's, untouched
  def leave
    score = @_score("show")
    halt(422, SiteText.t("app.scores.errors.not_shared")) unless ScoreShare.leave(score, current_user())

    flash("notice", SiteText.t("app.scores.flash.left", {"title": score.title}))
    redirect(app_scores_path())
  end

  # POST /app/scores/:id/trash
  def move_to_trash
    score = @_score("destroy")
    score.move_to_trash
    trashed = SCORE_TRASH_DAYS == 1 ? "app.scores.flash.trashed_one" : "app.scores.flash.trashed_other"
    flash("notice", SiteText.t(
      trashed,
      {"title": score.title, "n": SCORE_TRASH_DAYS}
    ))
    redirect(app_scores_path())
  end

  # POST /app/scores/:id/restore
  def restore
    score = @_score("destroy")
    score.restore_from_trash
    flash("notice", SiteText.t("app.scores.flash.restored", {"title": score.title}))
    redirect(app_trash_path())
  end

  # DELETE /app/scores/:id — for good, from the trash only
  def destroy
    score = @_score("destroy")
    halt(422, SiteText.t("app.scores.errors.trash_first")) unless score.trashed?

    score.erase
    flash("notice", SiteText.t("app.scores.flash.deleted", {"title": score.title}))
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
    halt(422, SiteText.t("app.scores.errors.choose_visibility")) unless score.make_visible(params["visibility"].to_s)

    visibility = SiteText.t("app.scores.flash.visibility_#{score.visibility}")
    flash("notice", SiteText.t(
      "app.scores.flash.visibility",
      {"title": score.title, "visibility": visibility}
    ))
    redirect(app_score_share_path(score))
  end

  # POST /app/scores/:id/share/link — a new link; the old one stops working
  def new_link
    score = @_score("share")
    score.new_link
    flash("notice", SiteText.t("app.scores.flash.new_link"))
    redirect(app_score_share_path(score))
  end

  # POST /app/scores/:id/invitations — share with an email address, read or write
  def invite
    @score = @_score("share")
    share = ScoreShare.invite_by(current_user(), @score, params["email"].to_s, params["role"].to_s)
    if type(share) == "hash"
      @_share_page(@score)
      @error = share["error"]
      @upgrade = share["upgrade"] ? pricing_path() : nil
      return render("app/scores/share", {}, {"status": share["limit"] ? 429 : 422})
    end

    inviter = current_user().email
    # Told in the app (#385); the invitation e-mail is the only one, unless
    # the invitee turned the e-mails of shares off.
    UserNotification.shared(share, @score, current_user())
    mailed = true
    if share.mail_wanted?
      mailed = MailDelivery.attempt("invitation", fn() { ShareMailer.invited(share, @score, inviter) })
    end
    flash("notice", ScoreShare.invited_notice(share, @score.title, mailed))
    redirect(app_score_share_path(@score))
  end

  # DELETE /app/scores/:id/invitations/:share_id — no longer shared with them
  def uninvite
    score = @_score("share")
    share = ScoreShare.find(params["share_id"])
    halt(404, SiteText.t("app.scores.errors.no_such_share")) unless share.score_id == score._key

    share.delete
    flash("notice", SiteText.t(
      "app.scores.flash.uninvited",
      {"email": share.email, "title": score.title}
    ))
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
    @choices = ["private", "link", "public"].map do |choice|
      [choice, SiteText.t("app.scores.share.#{choice}"), SiteText.t("app.scores.share.#{choice}_hint")]
    end
    @title = SiteText.t("app.scores.share.title", {"title": score.title})
    @description = SiteText.t("app.scores.share.description", {"title": score.title})
  end

  # The editor's AI entry points (File › Open a photo, the AI menu): which
  # AI answers and how many questions are left today (@ai_with, @ai_left);
  # or, when it cannot (AiClient.refusal), why, and the page that lifts it
  # (@ai_link), shown before anything is sent.
  def _ai_entry(user)
    refusal = AiClient.refusal(user)
    unless refusal.nil?
      @ai_with = AiClient.refusal_words(refusal)
      @ai_left = nil
      @ai_link = @_ai_link(refusal)
      return nil
    end

    @ai_with = "Answered by #{AiClient.provider_name(user.ai_provider)}, #{user.ai_model}, with your key."
    @ai_left = ScoreSuggestion.left_today(user)
    @ai_link = nil
  end

  # The editor's JSON calls on a score this person may not (or no longer)
  # change: an answer the editor can read, not the 403 page.
  def _not_writable
    render_json({"error": "you may no longer change this score"}, 403)
  end

  # The score of the route, if the signed-in person may `action` it (403
  # otherwise; 404 for no such score).
  def _score(action)
    authorize(Score.find(params["id"]), action)
  end

  # The version of the route, if it is one of `score`'s (404 otherwise).
  def _version_of(score)
    version = ScoreVersion.find(params["version_id"])
    halt(404, SiteText.t("app.scores.errors.no_such_version")) unless version.score_id == score._key

    version
  end
end
