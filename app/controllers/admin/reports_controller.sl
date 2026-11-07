# The shared library's reports, for an admin (#444): each section or
# comment people reported, with why, and what to do — hide it (and show it
# again), take it away, or dismiss the report. What an admin does to a
# report is kept as an AdminAction (#544).
class AdminReportsController < AdminBaseController
  # GET /admin/reports — the open reports, the oldest first
  def index
    reports = SectionReport.still_open
    # What they report, read together (#689): not a read for each report.
    section_keys = reports.map(&:section_id).uniq
    comment_keys = reports.filter do |report|
      report.target == "comment"
    end.map(&:target_id).uniq
    found_sections = []
    found_comments = []
    grouped(fn() {
      found_sections = SharedSection.where("doc._key IN @keys", {"keys": section_keys}).all if section_keys.length > 0
      found_comments = SectionComment.where("doc._key IN @keys", {"keys": comment_keys}).all if comment_keys.length > 0
    })
    sections = {}
    comments = {}
    found_sections.each do |section|
      sections[section._key] = section
    end
    found_comments.each do |comment|
      comments[comment._key] = comment
    end
    keys = reports.map do |report|
      report.user_id
    end
    keys = keys + sections.values.filter do |section|
      !section.nil?
    end.map do |section|
      section.user_id
    end
    keys = keys + comments.values.filter do |comment|
      !comment.nil?
    end.map do |comment|
      comment.user_id
    end
    @names = User.names_of(keys)
    @reports = reports
    @sections = sections
    @comments = comments
    @title = "Reports · Admin"
    @description = "What people reported in the shared library."
  end

  # POST /admin/reports/:id/hide — what it reports hidden from everyone
  def hide
    report = SectionReport.find(params["id"])
    @_set_hidden(report, true)
    report.close("hidden")
    @_record("report_hide", report, "hidden")
    @_back("Hidden: no one but the admins sees it now.")
  end

  # POST /admin/reports/:id/show — what it reports shown again
  def unhide
    report = SectionReport.find(params["id"])
    @_set_hidden(report, false)
    report.close("shown")
    @_record("report_show", report, "shown")
    @_back("Shown again.")
  end

  # POST /admin/reports/:id/remove — what it reports taken away for good
  def remove
    report = SectionReport.find(params["id"])
    if report.target == "comment"
      comment = SectionComment.find_by("_key", report.target_id)
      comment&.delete
      SharedSection.find_by("_key", report.section_id)&.recount
      report.close("removed")
    else
      report.close("removed")
      SharedSection.find_by("_key", report.section_id)&.remove
    end
    @_record("report_remove", report, "removed")
    @_back("Taken away.")
  end

  # POST /admin/reports/:id/dismiss — nothing wrong: the report closed
  def dismiss
    report = SectionReport.find(params["id"])
    report.close("dismissed")
    @_record("report_dismiss", report, "dismissed")
    @_back("Dismissed.")
  end

  private

  # What was done to `report`, kept with the thing it reports.
  def _record(action, report, outcome)
    AdminAction.record(current_user(), action, "report", report._key, {
      "outcome": outcome,
      "target": report.target,
      "target_id": report.target_id,
      "section_id": report.section_id
    })
  end

  # The flag alone is written (#685): a copy saved whole would put back the
  # counters a rating or a comment changed meanwhile.
  def _set_hidden(report, hidden)
    if report.target == "comment"
      SectionComment.where({"_key": report.target_id.to_s}).update_all({"hidden": hidden})
    else
      SharedSection.where({"_key": report.section_id.to_s}).update_all({"hidden": hidden})
    end
    SharedSection.find_by("_key", report.section_id)&.recount
  end

  def _back(message)
    flash("notice", message)
    redirect(admin_reports_path())
  end
end
