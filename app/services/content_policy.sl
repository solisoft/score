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
# back before it is handed over.
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

class ContentPolicy
  # The policy, with the inline scripts' `hashes` ("'sha256-…'" sources).
  static def policy(hashes)
    script_sources = ["'self'", "'wasm-unsafe-eval'"] + hashes + [CSP_MP3_ENCODER]
    [
      "default-src 'self'",
      "script-src #{script_sources.join(" ")}",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob:",
      "media-src 'self' data: blob:",
      "connect-src 'self' blob:",
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'self'"
    ].join("; ")
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
