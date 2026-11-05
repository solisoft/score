# What an admin did from the admin section (#544): each change it makes —
# Pro offered or taken back, signing in unlocked, an address confirmed, a
# report acted on — kept with who made it, on what, and when, so a change
# to an account can always be traced to the admin who made it. Written by
# the actions themselves, never edited, read back on a customer's page and
# in the admin section's list (/admin/actions).
#
# A customer's score read by an admin is kept too ("view_score", #626):
# nothing changes, but someone else's music was opened — the score is the
# target, its owner in the details, so the owner's page lists it.
const ADMIN_ACTIONS_SHOWN = 100
const ADMIN_ACTION_KINDS = [
  "gift",
  "stop_gift",
  "unlock",
  "confirm",
  "report_hide",
  "report_show",
  "report_remove",
  "report_dismiss",
  "view_score"
]

class AdminAction < Model
  validates("admin_id", {"presence": true})
  validates("action", {"inclusion": ADMIN_ACTION_KINDS})
  validates("target_id", {"presence": true})

  # `admin` did `action` to `target_type` ("user" or "report") `target_id`;
  # `details` says how (a hash, kept as given). The admin's address is kept
  # too, so the line still names them if the account goes, and `at` is to
  # the microsecond: two changes in the same second keep their order.
  static def record(admin, action, target_type, target_id, details = {})
    AdminAction.create({
      "admin_id": admin._key,
      "admin_email": admin.email,
      "action": action,
      "target_type": target_type,
      "target_id": target_id.to_s,
      "details": details,
      "created_at": DateTime.utc.to_unix,
      "at": clock()
    })
  end

  # What was done to one account or report, the latest first — for an
  # account, its scores read by an admin among them (#626). The owner is
  # read as details['owner']: the query builder rewrites a second dotted
  # step (details.owner) to details.doc.owner, which matches nothing.
  static def about(target_id)
    AdminAction.where(
      "doc.target_id == @target OR (doc.target_type == 'score' AND doc.details['owner'] == @target)",
      {"target": target_id.to_s}
    ).order("at", "desc").limit(ADMIN_ACTIONS_SHOWN).all
  end

  # The latest actions, of every admin on everything.
  static def latest
    AdminAction.where("doc.at > 0", {}).order("at", "desc").limit(ADMIN_ACTIONS_SHOWN).all
  end

  # The line an admin reads: what was done, in a few words.
  def summary
    details = @details ?? {}
    days = details["days"]
    outcome = details["outcome"]
    return "Offered #{days} days of Pro" if @action == "gift" && !days.nil?
    return "Ended the offer of Pro" if @action == "stop_gift"
    return "Unlocked signing in" if @action == "unlock"
    return "Confirmed the address" if @action == "confirm"
    return "Report: #{outcome}" if @action.starts_with?("report_") && !outcome.nil?
    return @_viewed(details) if @action == "view_score"

    @action
  end

  # The account a line is about: the target for an account, the owner for
  # one of its scores read (#626); nil for a report.
  def account_key
    return @target_id if @target_type == "user"
    return (@details ?? {})["owner"] if @target_type == "score"

    nil
  end

  private

  # "Read the score “Title”", or one of its versions, in the admin's language.
  def _viewed(details)
    title = details["title"].to_s
    return SiteText.t("admin_626.viewed_version", {"title": title}) unless details["version"].blank?

    SiteText.t("admin_626.viewed_score", {"title": title})
  end
end
