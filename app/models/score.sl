# A score in someone's library: its LilyPond source — which holds its title
# too, in \header, so the library and the engraving never disagree — and,
# once moved to the trash, when (trashed_at). The trash keeps a score
# SCORE_TRASH_DAYS days.
const SCORE_TRASH_DAYS = 30
const SCORE_UNTITLED = "Untitled score"
# How many scores a page of the library shows.
const SCORE_PAGE_SIZE = 60
# Who may read a score without an invitation: nobody but its owner and the
# people it is shared with ("private"), whoever has its link ("link"), or
# anyone, search engines included ("public").
const SCORE_VISIBILITIES = [
  "private",
  "link",
  "public"
]

class Score < Model
  validates("user_id", {"presence": true})
  validates(
    "title",
    {"presence": true, "max_length": 200}
  )
  validates(
    "source",
    {"presence": true, "max_length": 1000000}
  )
  # The engraver's limits on a new score's music (Score.limit_refusal): on
  # create only — an update's record knows nothing of what changed, and a
  # score stored before them must still be renamed, trashed, restored or
  # shared. The updates that bring new music check them themselves (the
  # editor's save, Score.refusal_of; a version restored).
  validates(
    "source",
    {"custom": fn(value) { Score.limit_refusal(value) }, "on": "create"}
  )
  # How many scores an account keeps (#684, Plan.limits "scores"): on
  # create only, so one past it still renames, trashes or restores.
  validates(
    "user_id",
    {"custom": fn(value) { Score.room_refusal(value) }, "on": "create"}
  )
  validates(
    "visibility",
    {"inclusion": SCORE_VISIBILITIES, "allow_nil": true}
  )
  before_save("stamp")

  # Every save: the title and the composer read from the source (the
  # composer "" when it names none, so the library's search reads a string),
  # the times, the revision a later save must start from (see #320's
  # conflict check).
  def stamp
    @title = Score.title_in(@source) ?? @title ?? SCORE_UNTITLED
    @composer = Score.composer_in(@source).to_s
    now = DateTime.utc.to_unix
    @created_at ||= now
    @updated_at = now
    @revision = (@revision ?? 0) + 1
    @visibility ||= "private"
    @share_token ||= Score.new_token
    true
  end

  # The address of a score's read page, /s/<token>: random, so a private
  # score's cannot be guessed, and replaced at will (`new_link`).
  static def new_token
    Crypto.random_token(16)
  end

  # The score whose read page this is, out of the trash, or nil.
  static def by_token(token)
    return nil if token.to_s.blank?

    Score.where("doc.share_token == @token AND doc.trashed_at == null", {"token": token.to_s}).first
  end

  # The first page of `library_page`.
  static def library(user, query, sort)
    Score.library_page(user, query, sort, 1)["scores"]
  end

  # Page `page` (from 1) of the scores `user` has out of the trash, matching
  # `query` (in the title or the composer), in `sort` order: "updated" (the
  # default), "title" or "created". SCORE_PAGE_SIZE a page, as a list shows
  # them (`listed`): without their sources. Answers {"scores", "more"}:
  # "more" when a later page has some, read with one row past the page.
  static def library_page(user, query, sort, page)
    Score.paged(Score.library_query(user, query, sort, page).all)
  end

  # The query `library_page` runs: the page's rows and one past them. To
  # run alone, or among other reads in `grouped`, then given to `paged`.
  static def library_query(user, query, sort, page)
    needle = query.to_s.trim.downcase
    condition = "doc.user_id == @user AND doc.trashed_at == null"
    unless needle.blank?
      condition = condition + " AND (CONTAINS(LOWER(doc.title), @needle)"
      condition = condition + " OR (doc.composer != null AND CONTAINS(LOWER(doc.composer), @needle)))"
    end
    binds = {"user": user._key}
    binds["needle"] = needle unless needle.blank?
    builder = Score.listed(Score.where(condition, binds))
    builder = builder.order("title", "asc") if sort == "title"
    builder = builder.order("created_at", "desc") if sort == "created"
    builder = builder.order("updated_at", "desc") unless ["title", "created"].includes?(sort)
    first = (Score.page_number(page) - 1) * SCORE_PAGE_SIZE
    builder.offset(first).limit(SCORE_PAGE_SIZE + 1)
  end

  # The rows `library_query` read, as a page: {"scores", "more"}.
  static def paged(rows)
    more = rows.length > SCORE_PAGE_SIZE
    {"scores": more ? rows.slice(0, SCORE_PAGE_SIZE) : rows, "more": more}
  end

  # A page number read from a request: 1 for anything not a whole number
  # of at least 1.
  static def page_number(value)
    number = value.to_s.trim.to_i
    number < 1 ? 1 : number
  end

  # What a list of scores shows of each — its title, its composer, its
  # owner, its times, its revision (in its preview's address) — and not its
  # source, which may run to a megabyte: `query` reading only those. Read,
  # never saved back.
  static def listed(query)
    query.select("title", "composer", "user_id", "updated_at", "created_at", "revision", "trashed_at")
  end

  # The `count` scores `user` changed last, out of the trash.
  static def recent(user, count)
    mine = Score.where("doc.user_id == @user AND doc.trashed_at == null", {"user": user._key})
    Score.listed(mine).order("updated_at", "desc").limit(count).all
  end

  # The scores in `user`'s trash, the latest first: those moved there less
  # than SCORE_TRASH_DAYS ago. An older one is past its time: the nightly
  # DataCleanupJob erases it (`purge_all_trash`).
  static def trash_of(user)
    Score.listed(Score.trashed_by(user)).order("trashed_at", "desc").limit(500).all
  end

  # How many scores `user`'s trash shows, counted by the database.
  static def trash_count(user)
    Score.trashed_by(user).count
  end

  # "Empty the trash": every score `user` has in the trash erased, with all
  # that hangs off it (`erase`); nobody else's, and nothing out of the trash.
  # Answers how many went.
  static def empty_trash_of(user)
    Score.erase_each(Score.where("doc.user_id == @user AND doc.trashed_at != null", {"user": user._key}))
  end

  static def trashed_by(user)
    Score.where(
      "doc.user_id == @user AND doc.trashed_at != null AND doc.trashed_at >= @since",
      {"user": user._key, "since": Score.trash_cutoff}
    )
  end

  # What has been in the trash longer than SCORE_TRASH_DAYS goes, with all
  # that hangs off it (`erase`), every owner's: the nightly DataCleanupJob's.
  # Answers how many scores went.
  static def purge_all_trash
    Score.erase_each(Score.where(
      "doc.trashed_at != null AND doc.trashed_at < @before",
      {"before": Score.trash_cutoff}
    ))
  end

  # A score trashed before this has been in the trash long enough to go.
  static def trash_cutoff
    DateTime.utc.to_unix - SCORE_TRASH_DAYS * 86400
  end

  # Every score `query` finds (up to 5000 a run), erased. Answers how many.
  static def erase_each(query)
    scores = query.limit(5000).all
    scores.each do |score|
      score.erase
    end
    scores.length
  end

  # Every score of `user`, trash included, with all that hangs off them,
  # and what was shared with them: their account is going.
  static def delete_all_of(user)
    Score.erase_each(Score.where("doc.user_id == @user", {"user": user._key}))
    ScoreShare.delete_all_of(user)
    ScoreVersion.delete_all_of(user)
  end

  # A new score in `user`'s library, saved by them.
  static def start(user, source)
    Score.create({
      "user_id": user._key,
      "saved_by": user._key,
      "source": source,
      "title": Score.title_in(source) ?? SCORE_UNTITLED
    })
  end

  # The title a source's \header gives, or nil.
  static def title_in(source)
    Score.header_field(source, "title")
  end

  # The composer a source's \header gives, or nil.
  static def composer_in(source)
    Score.header_field(source, "composer")
  end

  # The \header's `field` (a plain word: "title", "composer"), on one line
  # and trimmed, or nil when it is not there or blank.
  static def header_field(source, field)
    found = Regex.capture("\\\\header\\s*\\{[^}]*?#{field}\\s*=\\s*\"(?P<value>[^\"]*)\"", source.to_s)
    return nil if found.nil?

    value = Score.one_line(found["value"])
    value.blank? ? nil : value
  end

  # `text` on one line (#687): its line breaks, tabs and other control
  # characters each run made one space, then trimmed. A title goes in an
  # e-mail's subject, in a list, in a file name: a line break in it could
  # start a new header or a whole paragraph of someone else's words.
  static def one_line(text)
    Regex.replace_all("[\\p{Cc}\\p{Zl}\\p{Zp}\\s]+", text.to_s, " ").trim
  end

  # The scores saved before their composer was kept (#370), given it from
  # their source, `batch` at a time, without touching their times or their
  # revision: the migration's backfill. Answers how many were given one.
  static def backfill_composers(batch = 200)
    done = 0
    scores = Score.backfill_batch(batch)
    while scores.length > 0
      scores.each do |score|
        composer = Score.composer_in(score.source).to_s
        Score.where("doc._key == @key", {"key": score._key}).update_all({"composer": composer})
      end
      done = done + scores.length
      scores = Score.backfill_batch(batch)
    end
    done
  end

  static def backfill_batch(batch)
    Score.where("doc.composer == null", {}).select("source").limit(batch).all
  end

  # `source` with `title` as its title: in its \header, or a header of its
  # own on top. Quotes and backslashes, which would end the LilyPond string,
  # are left out.
  static def with_title(source, title)
    clean = title.to_s.replace("\"", "").replace("\\", "").trim
    clean = SCORE_UNTITLED if clean.blank?
    if Score.title_in(source).nil? && !Regex.matches("\\\\header\\s*\\{", source.to_s)
      return "\\header { title = \"#{clean}\" }\n" + source.to_s
    end

    if Regex.matches("\\\\header\\s*\\{[^}]*?title\\s*=", source.to_s)
      return Regex.replace("(\\\\header\\s*\\{[^}]*?title\\s*=\\s*)\"[^\"]*\"", source.to_s, "${1}\"#{clean}\"")
    end

    Regex.replace("\\\\header\\s*\\{", source.to_s, "\\header { title = \"#{clean}\"")
  end

  # The score `user` starts from a blank page.
  static def blank_source(title)
    Score.with_title(
      "\\relative c' {\n  \\clef treble \\key c \\major \\time 4/4\n  r1 | r1 | r1 | r1 \\bar \"|.\"\n}\n",
      title
    )
  end

  # The editor's save: `source`, typed over `base_revision`. Refused (409)
  # when the score has moved on since — saved from another window — with
  # the refused text kept as a "conflict" version and the score as it now
  # stands in the answer, so the editor can show it and nothing is lost.
  # The write itself matches only while the score is still at
  # `base_revision` (`_write_over`): of two saves over the same revision,
  # one wins and the other is that 409. `author` is the one saving: the
  # score's last saver (saved_by) once it goes through, the refused text's
  # author when it does not; the 409 names who saved last (`saved_by_name`).
  # Answers {"status", "body"}.
  #
  # The bounds read without the engraver come first, before a conflict
  # keeps anything (#684): a refused text is kept as a version only when it
  # could be saved. The engraver's reading of its limits is counted against
  # `sender`'s engravings of the minute (ScoreSvg.sender, "save"): past
  # them, 429, and nothing written.
  def save_from_editor(source, base_revision, author = nil, sender = nil)
    bounds = Score.bounds_refusal(source)
    unless bounds.nil?
      return {"status": 422, "body": {
        "error": bounds,
        "revision": @revision
      }}
    end

    return @_conflict(source, author) if base_revision != @revision

    if source.blank?
      return {"status": 422, "body": {
        "error": "Not saved: the score is empty.",
        "revision": @revision
      }}
    end

    if Score.engraving_held?(source, sender)
      return {"status": 429, "body": {
        "error": SiteText.t("security_540.too_many_engravings"),
        "revision": @revision,
        "retry_after": ENGRAVING_RETRY_AFTER
      }}
    end

    refusal = Score.refusal_of(source)
    unless refusal.nil?
      return {"status": 422, "body": {
        "error": refusal,
        "revision": base_revision
      }}
    end

    ScoreVersion.keep_if_due(this)
    unless @_write_over(source, base_revision, author&._key)
      @reload
      return @_conflict(source, author)
    end

    {"status": 200, "body": {
      "revision": @revision,
      "title": @title,
      "updated_at": @updated_at
    }}
  end

  # Why the editor's `source` may not be saved, or nil: the validations
  # above (source and title lengths, the engraver's limits), read before
  # the conditional write, which does not run them.
  static def refusal_of(source)
    bounds = Score.bounds_refusal(source)
    return bounds unless bounds.nil?

    limit = EngraverLimit.of(source)
    return nil if limit.nil?

    SiteText.t("security_540.not_saved", {"why": EngraverLimit.said(limit)})
  end

  # The bounds read without the engraver — the source's and the title's
  # lengths — or nil. What the MCP tools read before an engraving they count.
  static def bounds_refusal(source)
    return "Not saved: the score is too long to keep (a million characters at most)." if source.length > 1000000

    title = Score.title_in(source) ?? SCORE_UNTITLED
    return "Not saved: the title is too long (200 characters at most)." if title.length > 200

    nil
  end

  # Whether `sender` is past its engravings of the minute for the
  # engraver's reading of `source` before it is written (#684): a save, a
  # new score, a copy, a version restored. Counted as any engraving is
  # (ScoreSvg.check): a source read before is read back, not counted; one
  # past the bounds is refused without the engraver, and not counted
  # either. Never held without a sender (a job, a spec).
  static def engraving_held?(source, sender)
    text = source.to_s
    return false if sender.nil? || text.blank? || !Score.bounds_refusal(text).nil?

    ScoreSvg.check(text, sender)["throttled"] == true
  end

  # The validation of an account's room for one more score (#684): true,
  # or why not, when the scores of the user whose key is `user_id` — those
  # in the trash too, which the database keeps until they go — reach their
  # plan's "scores". Counted before the write: two created at the same
  # instant may both pass, one past the bound.
  static def room_refusal(user_id)
    owner = User.find_by("_key", user_id.to_s)
    return true if owner.nil?

    most = Plan.limits(owner)["scores"]
    return true if most.nil? || Score.where({"user_id": owner._key}).count < most

    SiteText.t("security_684.too_many_scores", {"n": most})
  end

  # Why `score`, just created, was not: the first of its errors, said, or
  # `otherwise`.
  static def refusal_in(score, otherwise)
    return otherwise if score._errors.nil? || score._errors.length == 0

    score._errors[0]["message"].to_s.blank? ? otherwise : score._errors[0]["message"].to_s
  end

  # The validation of the engraver's limits, for every new score (a blank
  # one, an import, an AI reading kept, a copy): its refusal, or true. Past
  # a million characters the length's own validation answers, without the
  # engraver reading it.
  static def limit_refusal(source)
    return true if source.to_s.length > 1000000

    limit = EngraverLimit.of(source)
    limit.nil? ? true : SiteText.t("security_540.too_much_music", {"why": EngraverLimit.said(limit)})
  end

  # Back to `version`, by `author`: the score as it stands is kept first.
  # False, and nothing kept, when the version is past the engraver's limits
  # (Score.restore_refusal says why).
  def restore_version(version, author = nil)
    return false if version.source != @source && !EngraverLimit.of(version.source).nil?

    ScoreVersion.keep(this, @source, "restore", @saved_by)
    @source = version.source
    @saved_by = author&._key
    @save
  end

  # Why `version` is not restored: the engraver's limit it passes, said.
  static def restore_refusal(version)
    SiteText.t("security_540.not_restored", {"why": EngraverLimit.said(EngraverLimit.of(version.source).to_s)})
  end

  # Who saved the score last, as the app names them to `viewer`: nil when
  # it was `viewer` themself (from another window), or nobody is known.
  def saved_by_name(viewer)
    return nil if @saved_by.blank? || @saved_by == viewer&._key

    User.names_of([@saved_by])[@saved_by]
  end

  # The score gone for good, with all that hangs off it: its versions, its
  # shares, the AI suggestions asked of it, its comments and what was told of it. "Delete for good", the trash's
  # purge and a deleted account all go through here.
  def erase
    ScoreVersion.delete_all_for(this)
    ScoreShare.delete_all_for(this)
    ScoreSuggestion.delete_all_for(this)
    ScoreThread.delete_all_for(this)
    ScoreTake.delete_all_for(this)
    UserNotification.delete_all_for(this)
    @delete
  end

  def owned_by?(user)
    !user.nil? && @user_id == user._key
  end

  # "owner", "write", "read" or nil: what `user` may do with this score
  # through their account. (A link or public score is also readable by
  # anyone: `readable_by?`.) In the trash it is its owner's alone (#542).
  def access_of(user)
    return nil if user.nil?
    return "owner" if this.owned_by?(user)
    return nil if this.trashed?

    ScoreShare.role_for(this, user)
  end

  # Nobody changes a score in the trash, its owner included: they restore it
  # first (#542).
  def writable_by?(user)
    return false if this.trashed?

    ["owner", "write"].includes?(this.access_of(user))
  end

  def readable_by?(user)
    return true if ["link", "public"].includes?(@visibility)

    !this.access_of(user).nil?
  end

  def make_visible(visibility)
    return false unless SCORE_VISIBILITIES.includes?(visibility)

    @visibility = visibility
    @save
  end

  # A new read-page address; the old one stops working.
  def new_link
    @share_token = Score.new_token
    @save
  end

  def trashed?
    !@trashed_at.nil?
  end

  # The title as a downloaded file's name, before its extension: its letters
  # and digits (accents kept), each run of anything else one dash, in lower
  # case; "score" when nothing is left. Nothing in it can end a header's
  # quoted string or name a folder. The editor names its files the same way
  # (fileName, public/eui-score/studio.js).
  def file_name
    name = Regex.replace_all("[^\\p{L}\\p{N}]+", @title.to_s, "-")
    name = Regex.replace_all("^-+|-+$", name, "").downcase
    name.blank? ? "score" : name
  end

  # The Content-Disposition of a file of this score, `extension` its own
  # ("pdf"): `filename` in ASCII for the browsers that read only it, its
  # letters outside ASCII each a dash, and `filename*` the name as it is,
  # percent-encoded (RFC 6266).
  def content_disposition(how, extension)
    plain = Regex.replace_all("[^A-Za-z0-9]+", @file_name, "-")
    plain = Regex.replace_all("^-+|-+$", plain, "")
    plain = "score" if plain.blank?
    "#{how}; filename=\"#{plain}.#{extension}\"; filename*=UTF-8''#{url_encode(this.file_name)}.#{extension}"
  end

  def rename(title)
    @source = Score.with_title(@source, title)
    @save
  end

  def move_to_trash
    @trashed_at = DateTime.utc.to_unix
    @save
  end

  def restore_from_trash
    @trashed_at = nil
    @save
  end

  # A copy in `user`'s library (the owner's, by default), "(copy)" after
  # its title. It is private, with a link of its own.
  def duplicate(user = nil)
    Score.copy_of(user.nil? ? @user_id : user._key, @source, this.title)
  end

  # A new score in the library of the user whose key is `user_id`, from
  # `source` titled `title` "(copy)": a score's copy, or a version's.
  static def copy_of(user_id, source, title)
    Score.create({
      "user_id": user_id,
      "saved_by": user_id,
      "source": Score.copy_source(source, title),
      "title": "#{title} (copy)"
    })
  end

  # The source of a copy of `source` titled `title`: what `copy_of` writes,
  # and what the engraver is asked of before it is (engraving_held?).
  static def copy_source(source, title)
    Score.with_title(source, "#{title} (copy)")
  end

  private

  # `source` written over `base_revision` by the user whose key is
  # `saved_by`, in one statement, which matches only while the score is
  # still at that revision: false when another save got there first. It
  # sets what `stamp` would, to the same values.
  def _write_over(source, base_revision, saved_by)
    title = Score.title_in(source) ?? @title ?? SCORE_UNTITLED
    composer = Score.composer_in(source).to_s
    now = DateTime.utc.to_unix
    next_revision = base_revision + 1
    visibility = @visibility ?? "private"
    share_token = @share_token ?? Score.new_token
    created_at = @created_at ?? now
    score_key = @_key
    written = @sdbql{
      FOR s IN scores
      FILTER s._key == #{score_key} AND s.revision == #{base_revision}
      UPDATE s WITH {
        source: #{source},
        title: #{title},
        composer: #{composer},
        saved_by: #{saved_by},
        updated_at: #{now},
        created_at: #{created_at},
        revision: #{next_revision},
        visibility: #{visibility},
        share_token: #{share_token}
      } IN scores
      RETURN NEW
    }
    raise("The save could not be written: #{written}") if type(written) == "string"
    return false if written.length == 0

    @source = source
    @title = title
    @composer = composer
    @saved_by = saved_by
    @updated_at = now
    @created_at = created_at
    @revision = next_revision
    @visibility = visibility
    @share_token = share_token
    true
  end

  # The 409: `source` kept as a "conflict" version by `author`, and the
  # score as it stands in the answer, with who saved it last ("saved_by":
  # nil when it was `author`, from another window, or nobody is known).
  # Not kept past SCORE_CONFLICTS_PER_HOUR of the score's in the last hour
  # (#684): the editor keeps the text in the browser too, and merges it.
  def _conflict(source, author)
    unless source.blank? || ScoreVersion.conflicts_full?(this)
      ScoreVersion.keep(this, source, "conflict", author&._key)
    end
    {"status": 409, "body": {
      "error": "changed elsewhere",
      "revision": @revision,
      "source": @source,
      "title": @title,
      "saved_by": this.saved_by_name(author)
    }}
  end
end
