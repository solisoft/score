# A score in someone's library: its LilyPond source — which holds its title
# too, in \header, so the library and the engraving never disagree — and,
# once moved to the trash, when (trashed_at). The trash keeps a score
# SCORE_TRASH_DAYS days.
const SCORE_TRASH_DAYS = 30
const SCORE_UNTITLED = "Untitled score"
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
  validates(
    "visibility",
    {"inclusion": SCORE_VISIBILITIES, "allow_nil": true}
  )
  before_save("stamp")

  # Every save: the title read from the source, the times, the revision a
  # later save must start from (see #320's conflict check).
  def stamp
    @title = Score.title_in(@source) ?? @title ?? SCORE_UNTITLED
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

  # The scores `user` has out of the trash, matching `query` (in the title),
  # in `sort` order: "updated" (the default), "title" or "created".
  static def library(user, query, sort)
    needle = query.to_s.trim.downcase
    condition = "doc.user_id == @user AND doc.trashed_at == null"
    condition = condition + " AND CONTAINS(LOWER(doc.title), @needle)" unless needle.blank?
    binds = {"user": user._key}
    binds["needle"] = needle unless needle.blank?
    builder = Score.where(condition, binds)
    builder = builder.order("title", "asc") if sort == "title"
    builder = builder.order("created_at", "desc") if sort == "created"
    builder = builder.order("updated_at", "desc") unless ["title", "created"].includes?(sort)
    builder.limit(500).all
  end

  # The `count` scores `user` changed last, out of the trash.
  static def recent(user, count)
    mine = Score.where("doc.user_id == @user AND doc.trashed_at == null", {"user": user._key})
    mine.order("updated_at", "desc").limit(count).all
  end

  # The scores `user` moved to the trash, the latest first.
  static def trash_of(user)
    trashed = Score.where("doc.user_id == @user AND doc.trashed_at != null", {"user": user._key})
    trashed.order("trashed_at", "desc").limit(500).all
  end

  # What has been in `user`'s trash longer than SCORE_TRASH_DAYS goes.
  static def purge_trash(user)
    before = DateTime.utc.to_unix - SCORE_TRASH_DAYS * 86400
    Score.where(
      "doc.user_id == @user AND doc.trashed_at != null AND doc.trashed_at < @before",
      {"user": user._key, "before": before}
    ).delete_all
  end

  # Every score of `user`, trash included: their account is going.
  static def delete_all_of(user)
    ScoreShare.delete_all_of(user)
    ScoreVersion.delete_all_of(user)
    Score.where("doc.user_id == @user", {"user": user._key}).delete_all
  end

  # A new score in `user`'s library.
  static def start(user, source)
    Score.create({
      "user_id": user._key,
      "source": source,
      "title": Score.title_in(source) ?? SCORE_UNTITLED
    })
  end

  # The title a source's \header gives, or nil.
  static def title_in(source)
    found = Regex.capture("\\\\header\\s*\\{[^}]*?title\\s*=\\s*\"(?P<title>[^\"]*)\"", source.to_s)
    return nil if found.nil?

    title = found["title"].trim
    title.blank? ? nil : title
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
  # Answers {"status", "body"}.
  def save_from_editor(source, base_revision)
    if base_revision != @revision
      ScoreVersion.keep(this, source, "conflict") unless source.blank?
      return {"status": 409, "body": {
        "error": "changed elsewhere",
        "revision": @revision,
        "source": @source,
        "title": @title
      }}
    end

    if source.blank?
      return {"status": 422, "body": {
        "error": "an empty score is not saved",
        "revision": @revision
      }}
    end

    ScoreVersion.keep_if_due(this)
    @source = source
    unless @save
      return {"status": 422, "body": {
        "error": @_errors[0]["message"],
        "revision": base_revision
      }}
    end

    {"status": 200, "body": {
      "revision": @revision,
      "title": @title,
      "updated_at": @updated_at
    }}
  end

  # Back to `version`: the score as it stands is kept first.
  def restore_version(version)
    ScoreVersion.keep(this, @source, "restore")
    @source = version.source
    @save
  end

  def owned_by?(user)
    !user.nil? && @user_id == user._key
  end

  # "owner", "write", "read" or nil: what `user` may do with this score
  # through their account. (A link or public score is also readable by
  # anyone: `readable_by?`.)
  def access_of(user)
    return nil if user.nil?
    return "owner" if this.owned_by?(user)

    ScoreShare.role_for(this, user)
  end

  def writable_by?(user)
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
    Score.create({
      "user_id": user.nil? ? @user_id : user._key,
      "source": Score.with_title(@source, "#{this.title} (copy)"),
      "title": "#{this.title} (copy)"
    })
  end
end
