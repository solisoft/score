# The Content-Security-Policy (#544): every page is sent with it, and every
# inline script a page carries is one the policy names by its hash — on the
# site's pages, the app's home, the editor, the account, a read page — while
# a script it does not name (one slipped into a page) would not run.

const CSP_SPEC_PASSWORD = "correct horse battery"

def csp_spec_user
  user = User.new()
  user.email = "csp-#{uuid_v4}@example.com"
  user.set_password(CSP_SPEC_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

def csp_spec_sign_in(user)
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": CSP_SPEC_PASSWORD}
  )
end

# The policy `response` was sent with; fails when it has none.
def csp_spec_policy(response)
  policy = res_header(response, "Content-Security-Policy")
  assert_not_null(policy, "a Content-Security-Policy header")
  policy
end

# Every inline script of `response`'s page is named by its policy; how many.
def csp_spec_scripts_allowed(response)
  policy = csp_spec_policy(response)
  scripts = ContentPolicy.inline_scripts(res_body(response))
  scripts.each do |body|
    assert_contains(policy, ContentPolicy.hash_of(body), "the hash of: #{body.substring(0, [body.length, 80].min)}")
  end
  scripts.length
end

describe("The Content-Security-Policy") do
  before_each() do
    as_guest()
    clear_cookies()
  end

  describe("the policy") do
    test("runs the site's scripts and the engraver, never a plugin, a <base> or a frame of another site") do
      policy = ContentPolicy.policy(["'sha256-abc='"])
      assert_contains(policy, "default-src 'self'")
      assert_contains(policy, "script-src 'self' 'wasm-unsafe-eval' 'sha256-abc=' #{CSP_MP3_ENCODER}")
      assert_contains(policy, "object-src 'none'")
      assert_contains(policy, "base-uri 'none'")
      assert_contains(policy, "frame-ancestors 'self'")
      assert_contains(policy, "connect-src 'self' blob:;")
      # No inline script but those named: neither 'unsafe-inline' nor eval for scripts.
      script_src = policy.split("; ").filter do |directive|
        directive.starts_with("script-src")
      end[0]
      assert_not(script_src.contains("unsafe-inline"))
      assert_not(script_src.contains("'unsafe-eval'"))
    end

    test("the MP3 encoder named is the one the audio export loads") do
      assert_contains(File.read("public/eui-score/audio-export.js"), "LAME_URL = \"#{CSP_MP3_ENCODER}\"")
    end

    test("hashes a script as the browser does: SHA-256 of its text, in Base64") do
      # printf 'alert(1)' | openssl dgst -sha256 -binary | base64
      assert_eq(ContentPolicy.hash_of("alert(1)"), "'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='")
    end

    test("finds the scripts a browser runs inline, and leaves data blocks and files alone") do
      html = "<script>a()</script><script type=\"module\">b()</script>"
      + "<script src=\"/x.js\"></script><script type=\"module\" src=\"/y.js\"></script>"
      + "<script type=\"application/json\" id=\"d\">{}</script>"
      + "<script type=\"text/x-lilypond\">{ c'4 }</script><script data-x>\nc()\n</script>"
      assert_eq(ContentPolicy.inline_scripts(html), [
        "a()",
        "b()",
        "\nc()\n"
      ])
      assert_eq(ContentPolicy.inline_scripts("<p>none</p>"), [])
    end

    test("no inline script of the views holds a template tag, so each hash holds for every page") do
      assert_eq(ContentPolicy.templated_scripts("app/views"), [])
      hashes = ContentPolicy.script_hashes("app/views")
      assert(hashes.length >= 15, "the views' inline scripts")
      assert_eq(hashes, hashes.uniq)
    end
  end

  describe("on the pages") do
    test("the site's pages carry it, and each of their inline scripts is named") do
      ["/", "/playground", "/embed", "/fr/embed", "/pricing", "/sections", "/login"].each do |path|
        response = get(path)
        assert_eq(res_status(response), 200, path)
        csp_spec_scripts_allowed(response)
      end
      assert(csp_spec_scripts_allowed(get("/playground")) >= 2, "the playground's words and its module")
    end

    test("a script that is not the site's is not named") do
      policy = csp_spec_policy(get("/"))
      assert_not(policy.contains(ContentPolicy.hash_of("alert(document.cookie)")))
      assert_not(policy.contains("'unsafe-inline' 'sha256"))
    end

    test("the app's home, the editor, the account and a read page") do
      owner = csp_spec_user()
      score = Score.start(owner, Score.blank_source("Policy"))
      csp_spec_sign_in(owner)
      assert(csp_spec_scripts_allowed(get("/app")) >= 3, "the bell, the words, the home's module")
      editor = get("/app/scores/#{score._key}")
      assert_eq(res_status(editor), 200)
      assert(csp_spec_scripts_allowed(editor) >= 3, "the bell, the words, the editor's module")
      # What the editor's script reads, beside it: escaped so it cannot close its block.
      assert_contains(res_body(editor), "<script type=\"application/json\" id=\"editor-data\">")
      assert(csp_spec_scripts_allowed(get("/app/account")) >= 2)
      post("/app/scores/#{score._key}/share", {"visibility": "link"})
      clear_cookies()
      read = get("/s/#{score.share_token}")
      assert_eq(res_status(read), 200)
      assert(csp_spec_scripts_allowed(read) >= 1)
    end
  end
end

describe("page_data") do
  test("holds the value as JSON a script parses, and nothing that closes the block") do
    block = page_data(
      "x-data",
      {
        "title": "</script><script>alert(1)</script>",
        "n": 2,
        "a": "&"
      }
    )
    assert(block.starts_with("<script type=\"application/json\" id=\"x-data\">"))
    assert(block.ends_with("</script>"))
    inner = block.replace("<script type=\"application/json\" id=\"x-data\">", "").replace("</script>", "")
    assert_not(inner.contains("<"))
    assert_not(inner.contains(">"))
    assert_eq(JSON.parse(inner)["title"], "</script><script>alert(1)</script>")
    assert_eq(JSON.parse(inner)["n"], 2)
    assert_eq(JSON.parse(inner)["a"], "&")
  end
end
