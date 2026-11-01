# The Content-Security-Policy every page is sent with (#544): what a page
# may run, load and connect to, so that markup slipped into one cannot run a
# script the site did not write.
#
# Scripts: the site's own files ('self'), the engraver's WebAssembly
# ('wasm-unsafe-eval'), the MP3 encoder the audio export fetches with its
# integrity hash, and each inline script of the views by its SHA-256. Hashes,
# not nonces: instant navigation (/__soli/nav.js) swaps the next page's body
# into the current document and re-runs its inline scripts there, under the
# policy the *first* page arrived with — a per-response nonce would no longer
# match, a hash of the same text always does. The hashes are read from the
# views at boot (config/application.sl), so an inline script holds no
# template tag: what a page passes to its script goes in a JSON block
# (`page_data`, app/helpers/content_policy_helper.sl), which runs nothing.
#
# Connections: the site itself (its pages, its WebSocket, its event
# streams) and blob: — the files a page makes itself, a saved score read
# back before it is handed over. The WebSocket is also named by the host of
# APP_URL: an older Safari does not count wss: as 'self'.
#
# Inline event handlers (onclick=…) are blocked like any inline script: a
# view asks before a destructive submit with `data-confirm`, which
# /__soli/nav.js answers (`inline_handlers` finds any left).
#
# Enforced, and reported: a browser posts what it refused to /csp-report
# (CspReportsController), where each report is one log line (`violations`).
#
# Styles stay 'unsafe-inline': the views and the engraver's components set
# style attributes, and a style cannot run a script.
#
# The <eui-score> component other sites embed runs under *their* policy, not
# this one. HSTS is sent by soli-proxy in front of the app, not from here.

const CSP_VIEWS_DIR = "app/views"

# The audio export's MP3 encoder (public/eui-score/audio-export.js, LAME_URL),
# loaded only when someone exports an MP3, with its SRI hash.
const CSP_MP3_ENCODER = "https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js"

# The `type`s a browser runs; any other (application/json, text/x-lilypond)
# is a data block, outside the policy.
const CSP_SCRIPT_TYPES = [
  "",
  "module",
  "text/javascript",
  "application/javascript"
]

# Where browsers report a violation, and how much of one is read: a report
# is a few hundred bytes, each field a URL cut short in the log.
const CSP_REPORT_PATH = "/csp-report"
const CSP_REPORT_MAX_BYTES = 8192
const CSP_REPORT_FIELD_CHARS = 200
const CSP_REPORTS_PER_IP = 30
const CSP_REPORT_WINDOW_SECONDS = 60

class ContentPolicy
  # The policy, with the inline scripts' `hashes` ("'sha256-…'" sources),
  # for the site at `app_url` (its WebSocket's host).
  static def policy(hashes, app_url = getenv("APP_URL"))
    script_sources = ["'self'", "'wasm-unsafe-eval'"] + hashes + [CSP_MP3_ENCODER]
    connect_sources = ["'self'"] + ContentPolicy.socket_sources(app_url) + ["blob:"]
    [
      "default-src 'self'",
      "script-src #{script_sources.join(" ")}",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob:",
      "media-src 'self' data: blob:",
      "connect-src #{connect_sources.join(" ")}",
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'self'",
      "report-uri #{CSP_REPORT_PATH}"
    ].join("; ")
  end

  # The site's WebSocket, by the host of `app_url`: wss:// for https, ws://
  # for http; none when no address is configured.
  static def socket_sources(app_url)
    found = Regex.capture("^(?P<scheme>https?)://(?P<host>[^/?#\\s]+)", app_url.to_s.trim)
    return [] if found.nil?

    scheme = found["scheme"] == "https" ? "wss" : "ws"
    ["#{scheme}://#{found["host"]}"]
  end

  # The policy for the views under `dir`, set on every response.
  static def apply(dir = CSP_VIEWS_DIR)
    templated = ContentPolicy.templated_scripts(dir)
    unless templated.length == 0
      Logger.warn(
        "content policy: an inline script holds a template tag, its hash cannot match",
        {"views": templated}
      )
    end
    handled = ContentPolicy.inline_handlers(dir)
    unless handled.length == 0
      Logger.warn("content policy: an inline event handler is blocked, use data-confirm", {"views": handled})
    end
    set_csp(ContentPolicy.policy(ContentPolicy.script_hashes(dir)))
  end

  # The CSP source of one inline script: the SHA-256 of its text, in Base64.
  static def hash_of(body)
    "'sha256-#{Base64.encode(Hex.decode(Crypto.sha256(body)))}'"
  end

  # The hash of every inline script of the views under `dir`, each once.
  static def script_hashes(dir = CSP_VIEWS_DIR)
    hashes = []
    ContentPolicy.view_files(dir).each do |path|
      ContentPolicy.inline_scripts(File.read(path)).each do |body|
        hashes.push(ContentPolicy.hash_of(body))
      end
    end
    hashes.uniq.sort()
  end

  # The views whose inline scripts hold a template tag (`<%`): their text,
  # and so their hash, changes with what the page renders. Must be none.
  static def templated_scripts(dir = CSP_VIEWS_DIR)
    ContentPolicy.view_files(dir).filter do |path|
      ContentPolicy.inline_scripts(File.read(path)).any? do |body|
        body.contains("<%")
      end
    end
  end

  # The views with an inline event handler (onsubmit=…, onclick=…), which
  # the policy blocks. Must be none.
  static def inline_handlers(dir = CSP_VIEWS_DIR)
    ContentPolicy.view_files(dir).filter do |path|
      ContentPolicy.handlers_in(File.read(path)).length > 0
    end
  end

  # The handler attributes (lower-cased) in the tags of `html`, outside its
  # scripts, whose own `button.onclick = …` is code, not an attribute.
  static def handlers_in(html)
    markup = Regex.replace_all("(?s)<%.*?%>", html, "x")
    markup = Regex.replace_all("(?s)<script\\b[^>]*>.*?</script>", markup, "")
    handlers = []
    Regex.find_all("(?i)<[a-z][^>]*>", markup).each do |tag|
      Regex.find_all("(?i)\\s(on[a-z]+)\\s*=", tag["match"]).each do |found|
        handlers.push(found["match"].trim.replace("=", "").trim.downcase)
      end
    end
    handlers
  end

  # What a browser's report says was refused, one compact hash per
  # violation: the page (without its query), the directive, what was
  # blocked, and where. Reads the legacy report (application/csp-report,
  # {"csp-report": {…}}) and the Reporting API's list
  # (application/reports+json, [{"type": "csp-violation", "body": {…}}]);
  # anything else gives none, and nothing raises.
  static def violations(content_type, body)
    parsed = JSON.parse(body.to_s) rescue nil
    return [] if parsed.nil?

    reporting_api = content_type.to_s.downcase.starts_with("application/reports+json")
    return ContentPolicy.reported_violations(parsed) if reporting_api
    return [] unless parsed.class == "hash" && parsed["csp-report"].class == "hash"

    found = parsed["csp-report"]
    [ContentPolicy.violation(
      found["document-uri"],
      found["effective-directive"] ?? found["violated-directive"],
      found["blocked-uri"],
      found["source-file"],
      found["line-number"]
    )]
  end

  # The CSP reports of a Reporting API list; its other kinds left out.
  static def reported_violations(parsed)
    return [] unless parsed.class == "array"

    reports = parsed.filter do |entry|
      entry.class == "hash" && entry["type"] == "csp-violation" && entry["body"].class == "hash"
    end
    reports.map do |entry|
      found = entry["body"]
      ContentPolicy.violation(
        found["documentURL"],
        found["effectiveDirective"],
        found["blockedURL"],
        found["sourceFile"],
        found["lineNumber"]
      )
    end
  end

  # Whether address `ip` may send one more report this minute.
  static def report_allowed?(ip)
    RateLimiter("csp-report:#{ip}", CSP_REPORTS_PER_IP, CSP_REPORT_WINDOW_SECONDS).allowed()
  end

  # One violation, each field on one line and cut short.
  static def violation(page, directive, blocked, source, line)
    where = ContentPolicy.report_field(source)
    where = "#{where}:#{line}" unless where.blank? || line.nil?
    {
      "page": ContentPolicy.report_field(page.to_s.split("?")[0]),
      "directive": ContentPolicy.report_field(directive),
      "blocked": ContentPolicy.report_field(blocked),
      "source": where
    }
  end

  static def report_field(value)
    text = Regex.replace_all("\\s+", value.to_s, " ").trim
    text.length > CSP_REPORT_FIELD_CHARS ? text.substring(0, CSP_REPORT_FIELD_CHARS) : text
  end

  # The text of each script `html` holds that a browser runs inline: no
  # `src`, and a `type` that is JavaScript (or none).
  static def inline_scripts(html)
    bodies = []
    Regex.find_all("(?s)<script\\b[^>]*>.*?</script>", html).each do |found|
      parts = Regex.capture("(?s)^<script(?P<attrs>[^>]*)>(?P<body>.*)</script>$", found["match"])
      attrs = parts["attrs"]
      next if Regex.matches("(?i)\\ssrc\\s*=", attrs)

      typed = Regex.capture("(?i)\\stype\\s*=\\s*\"(?P<type>[^\"]*)\"", attrs)
      type = typed.nil? ? "" : typed["type"].trim.downcase
      bodies.push(parts["body"]) if CSP_SCRIPT_TYPES.includes?(type)
    end
    bodies
  end

  # Every file under `dir`, at any depth.
  static def view_files(dir)
    files = []
    File.glob("#{dir}/*").sort().each do |path|
      if File.is_dir(path)
        files = files + ContentPolicy.view_files(path)
      else
        files.push(path) if path.ends_with(".slv") || (path.ends_with(".md") && !path.ends_with("CLAUDE.md"))
      end
    end
    files
  end
end
