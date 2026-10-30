# A section of the shared library, or a comment on one, reported to the
# admins by a signed-in person (#444): why, in their words. The admins see
# the open reports (/admin/reports), and hide what they show, or dismiss
# them. A person files SECTION_REPORTS_PER_DAY in any 24 hours, one a thing.
const SECTION_REPORTS_PER_DAY = 30
const SECTION_REPORT_LENGTH = 500
const SECTION_REPORT_TARGETS = ["section", "comment"]

class SectionReport < Model
  validates("section_id", {"presence": true})
  validates("user_id", {"presence": true})
  validates("target", {"inclusion": SECTION_REPORT_TARGETS})

  # `user` reports `section` — or, with `comment`, that comment on it — for
  # `reason`: nil once done, else why not. Reporting the same thing again
  # changes nothing.
  static def file(section, comment, user, reason)
    text = reason.to_s.trim
    return "Say what is wrong with it." if text.blank?
    return "A report holds #{SECTION_REPORT_LENGTH} characters at most." if text.chars().length > SECTION_REPORT_LENGTH

    target = comment.nil? ? "section" : "comment"
    target_id = comment.nil? ? section._key : comment._key
    already = SectionReport.where({
      "user_id": user._key,
      "target": target,
      "target_id": target_id
    }).first
    return nil unless already.nil?

    since = DateTime.utc.to_unix - 86400
    today = SectionReport.where(
      "doc.user_id == @user AND doc.created_at > @since",
      {"user": user._key, "since": since}
    ).count
    if today >= SECTION_REPORTS_PER_DAY
      return "You have filed the #{SECTION_REPORTS_PER_DAY} reports a day allows: try again tomorrow."
    end

    SectionReport.create({
      "section_id": section._key,
      "target": target,
      "target_id": target_id,
      "user_id": user._key,
      "reason": text,
      "created_at": DateTime.utc.to_unix,
      "resolved_at": nil
    })
    nil
  end

  # The reports still open, the oldest first.
  static def still_open
    SectionReport.where("doc.resolved_at == null", {}).order("created_at", "asc").limit(200).all
  end

  # Every open report on the same thing as this one closed, with `outcome`
  # ("hidden", "shown", "removed", "dismissed").
  def close(outcome)
    SectionReport.where({"target": @target, "target_id": @target_id}).all.each do |report|
      next unless report.resolved_at.nil?

      report.resolved_at = DateTime.utc.to_unix
      report.outcome = outcome
      report.update()
    end
    nil
  end
end
