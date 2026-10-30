# The shared library's reports, for an admin (#444): each section or
# comment people reported, with why, and what to do — hide it (and show it
# again), take it away, or dismiss the report.
class AdminReportsController < AdminBaseController
  # GET /admin/reports — the open reports, the oldest first
  def index
    reports = SectionReport.still_open
    sections = {}
    comments = {}
    reports.each do |report|
      sections[report.section_id] ||= SharedSection.find_by("_key", report.section_id)
      comments[report.target_id] ||= SectionComment.find_by("_key", report.target_id) if report.target == "comment"
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
    @_back("Hidden: no one but the admins sees it now.")
  end

  # POST /admin/reports/:id/show — what it reports shown again
  def unhide
    report = SectionReport.find(params["id"])
    @_set_hidden(report, false)
    report.close("shown")
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
    @_back("Taken away.")
  end

  # POST /admin/reports/:id/dismiss — nothing wrong: the report closed
  def dismiss
    report = SectionReport.find(params["id"])
    report.close("dismissed")
    @_back("Dismissed.")
  end

  private

  def _set_hidden(report, hidden)
    if report.target == "comment"
      comment = SectionComment.find_by("_key", report.target_id)
      unless comment.nil?
        comment.hidden = hidden
        comment.update()
      end
    else
      section = SharedSection.find_by("_key", report.section_id)
      unless section.nil?
        section.hidden = hidden
        section.update()
      end
    end
    SharedSection.find_by("_key", report.section_id)&.recount
  end

  def _back(message)
    flash("notice", message)
    redirect(admin_reports_path())
  end
end
