# Where browsers report what the Content-Security-Policy refused (#544,
# `report-uri /csp-report`): each report becomes one short log line — the
# page, the directive, what was blocked — and nothing is written to the
# database. Both report shapes are read; anything else, an oversized body or
# one address reporting too often, is refused.

# A legacy report (application/csp-report), as Firefox and Safari send it.
def csp_report_legacy
  JSON.stringify({"csp-report": {
    "document-uri": "https://score.example.com/app?x=1",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "blocked-uri": "inline",
    "source-file": "https://score.example.com/app",
    "line-number": 12,
    "original-policy": "default-src 'self'"
  }})
end

# A Reporting API list (application/reports+json), as Chrome sends it: a CSP
# report and a report of another kind.
def csp_report_reporting
  JSON.stringify([
    {
      "type": "csp-violation",
      "age": 3,
      "url": "https://score.example.com/s/abc",
      "body": {
        "documentURL": "https://score.example.com/s/abc",
        "effectiveDirective": "connect-src",
        "blockedURL": "https://evil.example/x",
        "lineNumber": 4,
        "sourceFile": "https://score.example.com/js/score.js"
      }
    },
    {"type": "deprecation", "body": {}}
  ])
end

def csp_report_post(content_type, body)
  set_header("Content-Type", content_type)
  response = post("/csp-report", body)
  clear_headers()
  response
end

describe("POST /csp-report") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  test("takes a report in either shape, without a CSRF token, and keeps nothing") do
    actions = AdminAction.count
    users = User.count
    assert_eq(res_status(csp_report_post("application/csp-report", csp_report_legacy())), 204)
    assert_eq(res_status(csp_report_post("application/reports+json", csp_report_reporting())), 204)
    assert_eq(res_status(csp_report_post("application/json", csp_report_legacy())), 204)
    assert_eq(AdminAction.count, actions)
    assert_eq(User.count, users)
  end

  test("refuses another kind of body, and one too long") do
    assert_eq(res_status(csp_report_post("application/x-www-form-urlencoded", "a=1")), 415)
    assert_eq(res_status(csp_report_post("text/plain", csp_report_legacy())), 415)
    long = "{\"csp-report\":{\"document-uri\":\"#{"x" * (CSP_REPORT_MAX_BYTES + 1)}\"}}"
    assert_eq(res_status(csp_report_post("application/csp-report", long)), 413)
  end

  test("only POST") do
    assert_eq(res_status(get("/csp-report")), 404)
  end

  # Last: the spec's address has spent its reports for the minute.
  test("an address that reports too often is answered 429") do
    statuses = (0 .. CSP_REPORTS_PER_IP + 1).map do |_|
      res_status(csp_report_post("application/csp-report", csp_report_legacy()))
    end
    assert_eq(statuses[statuses.length - 1], 429)
    assert(statuses.filter(&{ |status|
      status == 204
    }).length <= CSP_REPORTS_PER_IP)
  end
end

describe("ContentPolicy.report_allowed?") do
  test("so many reports a minute from one address, then none; another address is not held back") do
    ip = "192.0.2.#{uuid_v4}"
    (0 .. CSP_REPORTS_PER_IP).each do |_|
      assert(ContentPolicy.report_allowed?(ip))
    end
    assert_not(ContentPolicy.report_allowed?(ip))
    assert(ContentPolicy.report_allowed?("198.51.100.#{uuid_v4}"))
  end
end

describe("ContentPolicy.violations") do
  test("reads the legacy report: page without its query, directive, what was blocked, where") do
    assert_eq(ContentPolicy.violations("application/csp-report", csp_report_legacy()), [{
      "page": "https://score.example.com/app",
      "directive": "script-src-elem",
      "blocked": "inline",
      "source": "https://score.example.com/app:12"
    }])
  end

  test("reads the Reporting API's list, keeping only the CSP reports") do
    assert_eq(ContentPolicy.violations("application/reports+json; charset=utf-8", csp_report_reporting()), [{
      "page": "https://score.example.com/s/abc",
      "directive": "connect-src",
      "blocked": "https://evil.example/x",
      "source": "https://score.example.com/js/score.js:4"
    }])
  end

  test("a body that is not a report gives nothing, and does not raise") do
    assert_eq(ContentPolicy.violations("application/csp-report", "not json"), [])
    assert_eq(ContentPolicy.violations("application/csp-report", "[1, 2]"), [])
    assert_eq(ContentPolicy.violations("application/reports+json", "{\"a\": 1}"), [])
    assert_eq(ContentPolicy.violations("application/reports+json", "[{\"type\": \"csp-violation\"}]"), [])
  end

  test("cuts every field short, so a line stays a line") do
    long = "{\"csp-report\":{\"document-uri\":\"https://a.example/#{"p" * 500}\",\"blocked-uri\":\"x\\ny\"}}"
    found = ContentPolicy.violations("application/csp-report", long)[0]
    assert(found["page"].length <= CSP_REPORT_FIELD_CHARS)
    assert_eq(found["blocked"], "x y")
    assert_eq(found["directive"], "")
  end
end
