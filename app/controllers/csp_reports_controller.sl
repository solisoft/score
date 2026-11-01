# Where browsers report what the Content-Security-Policy refused (#544,
# `report-uri /csp-report` in ContentPolicy.policy): each violation becomes
# one compact log line — the page, the directive, what was blocked, where —
# so that a script the policy breaks shows up in the logs, not only in a
# visitor's console. Nothing is written to the database. A report has no
# CSRF token (config/application.sl skips the check here), so the endpoint
# reads only the two report types, a few kilobytes, a few times a minute
# per address.
class CspReportsController < Controller
  # POST /csp-report
  def create
    content_type = (req["headers"] ?? {})["content-type"].to_s.downcase
    kind = content_type.split(";")[0].trim
    unless ["application/csp-report", "application/reports+json", "application/json"].includes?(kind)
      return {"status": 415, "body": ""}
    end

    body = req["body"].to_s
    if body.length > CSP_REPORT_MAX_BYTES
      return {"status": 413, "body": ""}
    end

    unless ContentPolicy.report_allowed?(client_ip(req))
      return {"status": 429, "body": ""}
    end

    ContentPolicy.violations(kind, body).each do |violation|
      Logger.warn("csp violation", violation)
    end
    {"status": 204, "body": ""}
  end
end
