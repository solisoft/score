# What a person says of a section of the shared library (#444). Anyone
# reads them; a signed-in person writes SECTION_COMMENTS_PER_DAY in any 24
# hours, and takes their own away; an admin hides one that is reported.
const SECTION_COMMENT_LENGTH = 2000
const SECTION_COMMENTS_PER_DAY = 100

class SectionComment < Model
  validates("section_id", {"presence": true})
  validates("user_id", {"presence": true})
  validates("body", {"presence": true})

  # `user` says `body` of `section`: {"comment"}, or {"error"} with nothing written.
  static def write(section, user, body)
    text = body.to_s.trim
    return {"error": "Write something first."} if text.blank?
    if text.chars().length > SECTION_COMMENT_LENGTH
      return {"error": "A comment holds #{SECTION_COMMENT_LENGTH} characters at most."}
    end

    since = DateTime.utc.to_unix - 86400
    today = SectionComment.where(
      "doc.user_id == @user AND doc.created_at > @since",
      {"user": user._key, "since": since}
    ).count
    if today >= SECTION_COMMENTS_PER_DAY
      return {"error": "You have written the #{SECTION_COMMENTS_PER_DAY} comments a day allows: try again tomorrow."}
    end

    comment = SectionComment.create({
      "section_id": section._key,
      "user_id": user._key,
      "body": text,
      "hidden": false,
      "created_at": DateTime.utc.to_unix
    })
    return {"error": "The comment could not be saved: try again."} unless comment._errors.nil?

    section.recount
    {"comment": comment}
  end

  # The comments everyone may see under `section`, the oldest first.
  static def shown(section)
    SectionComment.where("doc.section_id == @section AND doc.hidden != true", {"section": section._key}).order(
      "created_at",
      "asc"
    ).limit(500).all
  end

  def by?(user)
    !user.nil? && @user_id == user._key
  end

  # Whether `user` may take it away: its author, or an admin whose session
  # passed the second step (#687, SecondStep.admin?) — an admin's password
  # alone does not.
  def removable_by?(user)
    !user.nil? && (@by?(user) || SecondStep.admin?(user))
  end
end
