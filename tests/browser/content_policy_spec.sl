# The Content-Security-Policy in a real browser (soli test --browser, #544):
# the main pages and the editor's parts that load the most — the engraver's
# WebAssembly, the mixer, the MIDI view, the microphone's worklet, Play's
# synthesizer — break no rule of it.
#
# What the browser refused is read from its `securitypolicyviolation`
# events, which a page cannot be watched for before it starts. So a page is
# watched once, and every other one is reached from it by a link, as people
# reach them: instant navigation (/__soli/nav.js) swaps each next page into
# that document and runs its inline scripts there, under the first page's
# policy — the case a per-response nonce would break. A page reached by a
# full load instead would come back "not watched", and fail. One refusal is
# made on purpose, to prove refusals are seen.

const CSP_BROWSER_PASSWORD = "correct horse battery"
const CSP_BROWSER_SOURCE = "\\header { title = \"Policed\" }\n"
+ "\\new Staff { \\time 4/4 \\tempo 4 = 120 c'4 d' e' f' | g'1 }\n"

# Starts noting this document's refusals.
const CSP_WATCH = """
(() => {
  window.cspRefused = [];
  document.addEventListener('securitypolicyviolation', (event) => {
    window.cspRefused.push(`${event.effectiveDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}`);
  });
  return true;
})()
"""

def csp_watch
  assert_eq(evaluate(CSP_WATCH.trim), true)
end

# What the browser refused in this document so far, each once.
def csp_refused
  sleep(0.5)
  evaluate("JSON.stringify(window.cspRefused ? [...new Set(window.cspRefused)]"
  + " : ['not watched: the page was loaded, not swapped in'])")
end

def csp_none_refused(where)
  assert_eq(csp_refused(), "[]", where)
end

# To `path` by a link, as a click on one: instant navigation swaps it in.
def csp_go(path)
  evaluate("(() => { const link = Object.assign(document.createElement('a'), { href: '#{path}' });"
  + " document.body.append(link); link.click(); return true; })()")
  tries = 0
  while tries < 100 && evaluate("location.pathname + location.search") != path
    sleep(0.1)
    tries = tries + 1
  end
  assert_eq(evaluate("location.pathname + location.search"), path)
  sleep(1)
end

describe("The Content-Security-Policy, in a browser") do
  before_each() do
    logout()
  end

  test("a script slipped into a page does not run, and the refusal is seen") do
    visit("/")
    wait_for(".hero-app")
    csp_watch()
    evaluate("(() => { const s = document.createElement('script'); s.textContent = 'window.slipped = 1';"
    + " document.body.append(s); return true; })()")
    assert_eq(evaluate("window.slipped === undefined"), true)
    assert_contains(csp_refused(), "script-src")
  end

  test("the site's pages refuse nothing, the engraver's included") do
    visit("/")
    wait_for(".hero-app")
    csp_watch()
    ["/pricing", "/sections", "/embed", "/login", "/signup", "/guide", "/"].each do |path|
      csp_go(path)
      csp_none_refused(path)
    end
    csp_go("/playground")
    wait_for("#studio svg", {"timeout": 20})
    # The playground's own script ran: its studio is started.
    assert_eq(evaluate("Boolean(document.getElementById('studio').studio)"), true)
    csp_none_refused("the playground, engraved")
    assert_no_page_errors()
  end

  test("the app: home, the editor with its mixer, MIDI view, microphone and Play, the account, a read page") do
    email = "csp-#{uuid_v4}@example.com"
    user = User.new()
    user.email = email
    user.set_password(CSP_BROWSER_PASSWORD)
    user.confirmed_at = DateTime.utc.to_unix
    user.save
    score = Score.start(User.find_by("email", email), CSP_BROWSER_SOURCE)
    login(email, CSP_BROWSER_PASSWORD)
    post("/app/scores/#{score._key}/share", {"visibility": "link"})
    shared = Score.find(score._key)

    visit("/app")
    wait_for("#new-score")
    csp_watch()
    csp_go("/app/scores/#{score._key}")
    wait_for("#studio svg", {"timeout": 20})
    # The editor's own script ran: the save state is its.
    wait_for("[data-save-state]")
    assert_eq(evaluate("Boolean(document.getElementById('studio').studio)"), true)
    csp_none_refused("the editor")

    evaluate("document.querySelector('.tool-mixer').click()")
    wait_for(".studio-mixer[open]")
    click("[data-midi-button]")
    sleep(1)
    click("[data-midi-button]")
    # The tuner: the microphone's worklet, on an oscillator for a microphone.
    evaluate("(() => { const ctx = new AudioContext(); const osc = ctx.createOscillator();"
    + " const out = ctx.createMediaStreamDestination(); osc.connect(out); osc.start();"
    + " navigator.mediaDevices.getUserMedia = async () => { await ctx.resume(); return out.stream; };"
    + " return true; })()")
    evaluate("document.querySelector('.studio-dropdown [data-act=\"tuner\"]').click()")
    wait_for(".studio-tuner[open]")
    click(".studio-tuner [data-tuner-start]")
    sleep(2)
    click(".studio-tuner [data-tuner-start]")
    # Play: the synthesizer's worklet and its sounds.
    evaluate("document.querySelector('.studio-play').click()")
    sleep(3)
    evaluate("document.querySelector('.studio-play').click()")
    csp_none_refused("the editor's mixer, MIDI view, tuner and Play")

    csp_go("/app/account")
    csp_none_refused("/app/account")
    csp_go("/s/#{shared.share_token}")
    wait_for("svg", {"timeout": 20})
    csp_none_refused("the read page")
    csp_go("/app")
    wait_for("#new-score")
    csp_none_refused("back to /app")
  end

  test("the admin: a customer's scores, and one read with its engraving (#626)") do
    customer = User.new()
    customer.email = "csp-customer-#{uuid_v4}@example.com"
    customer.set_password(CSP_BROWSER_PASSWORD)
    customer.confirmed_at = DateTime.utc.to_unix
    customer.save
    score = Score.start(User.find_by("email", customer.email), CSP_BROWSER_SOURCE)
    email = "csp-admin-#{uuid_v4}@example.com"
    admin = User.new()
    admin.email = email
    admin.role = "admin"
    admin.set_password(CSP_BROWSER_PASSWORD)
    admin.confirmed_at = DateTime.utc.to_unix
    admin.save
    secret = User.find_by("email", email).start_two_step
    User.find_by("email", email).confirm_two_step(Crypto.totp_generate(secret, DateTime.utc.to_unix, 30))
    login(email, CSP_BROWSER_PASSWORD)
    post("/login/code", {"code": Crypto.totp_generate(secret, DateTime.utc.to_unix + 30, 30)})

    visit("/admin")
    wait_for("[data-admin=\"dashboard\"]")
    csp_watch()
    csp_go("/admin/customers/#{score.user_id}")
    wait_for("[data-customer-scores]")
    csp_none_refused("a customer's scores")
    csp_go("/admin/customers/#{score.user_id}/scores/#{score._key}")
    wait_for("[data-admin-score-figure] svg", {"timeout": 20})
    csp_none_refused("a customer's score, read by an admin")
    assert_no_page_errors()
  end
end

# The OAuth consent's answer under form-action (#688): the browser goes on
# to the client's address, another origin — here the site under its other
# name, localhost, which a loopback client may use — with the code, or the
# refusal. A redirect answering the form would be refused by the policy.
const CSP_OAUTH_VERIFIER = "csp-verifier-0123456789-abcdefghijklmnopqrstuvwxyz"

# The consent page of a client sending its answer to `redirect_uri`, opened
# by a signed-in person as a client opens it: by a full load.
def csp_consent_for(redirect_uri)
  set_header("Content-Type", "application/json")
  registered = post("/oauth/register", {
    "client_name": "Policed client",
    "redirect_uris": [redirect_uri]
  }.to_json)
  clear_headers()
  client_id = res_json(registered)["client_id"]
  challenge = Base64.urlsafe_encode(Hex.decode(Crypto.sha256(CSP_OAUTH_VERIFIER)))
  visit("/oauth/authorize?response_type=code&client_id=#{client_id}&redirect_uri=#{url(redirect_uri)}"
  + "&code_challenge=#{challenge}&code_challenge_method=S256&state=st4te")
  wait_for("[data-oauth-consent]")
end

# Waits for the browser to be at `host`, and answers where it is.
def csp_wait_for_host(host)
  tries = 0
  while tries < 100 && evaluate("location.host") != host
    sleep(0.1)
    tries = tries + 1
  end
  evaluate("location.href")
end

describe("The OAuth consent under the form policy, in a browser") do
  before_each() do
    logout()
  end

  test("allowing goes on to the client's address with the code; denying, with the refusal") do
    email = "csp-oauth-#{uuid_v4}@example.com"
    user = User.new()
    user.email = email
    user.set_password(CSP_BROWSER_PASSWORD)
    user.confirmed_at = DateTime.utc.to_unix
    user.save
    login(email, CSP_BROWSER_PASSWORD)
    visit("/pricing")
    port = evaluate("location.port")
    client_host = "localhost:#{port}"
    redirect_uri = "http://#{client_host}/pricing"

    csp_consent_for(redirect_uri)
    click("[data-oauth-allow]")
    landed = csp_wait_for_host(client_host)
    assert_match(landed, "^http://localhost:#{port}/pricing\\?code=[^&]+&state=st4te&iss=")
    code = Regex.capture("code=(?P<code>[^&]+)", landed)["code"]
    assert_not_null(OauthCode.find_by("code_digest", Crypto.sha256(code)), "the code sent is one issued")

    csp_consent_for(redirect_uri)
    click("[data-oauth-deny]")
    assert_eq(csp_wait_for_host(client_host), "http://localhost:#{port}/pricing?error=access_denied&state=st4te")
  end
end
