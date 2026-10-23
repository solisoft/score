# The app as someone uses it, in a real browser (soli test --browser): sign
# up, start a score from a template, write notes, find them after a reload,
# go back to a version, share it, and be refused someone else's.

const JOURNEY_PASSWORD = "correct horse battery"

def journey_email
  "journey-#{uuid_v4}@example.com"
end

# The score open in the editor: the LilyPond its source box holds.
def editor_source
  evaluate("document.querySelector('[data-source]').value")
end

# Waits for the editor to have read its score: its tools are off until then.
def wait_editor
  wait_for_text("Your changes save themselves")
end

# Writes `letters` (C=0 … B=6) at the cursor, in note input mode.
def write_notes(steps)
  wait_editor()
  click(".studio-toolbox [data-act='mode-input']")
  steps.each do |step|
    click(".studio-toolbox [data-act='letter'][data-step='#{step}']")
  end
end

# One more note at the cursor, the editor already in note input mode (its
# greeting, which `write_notes` waits for, is gone by then).
def write_more(step)
  click(".studio-toolbox [data-act='letter'][data-step='#{step}']")
end

# Waits for the editor's save to go through.
def wait_saved
  sleep(2)
  wait_for_text("Saved")
end

# Signs out as a person does, from the account page (the request helpers'
# logout() leaves the browser's own session alone).
def sign_out_in_browser
  visit("/app/account")
  # The logout form's own button: the page has others that speak of signing in.
  evaluate("document.querySelector('form[action=\"/logout\"] button').click()")
  assert_page_path("/login")
end

def sign_up_in_browser(email)
  visit("/signup")
  fill_in("#email", email)
  fill_in("#password", JOURNEY_PASSWORD)
  # The form refuses what is sent back within two seconds of being shown.
  sleep(2.2)
  click("form.auth-form button[type=submit]")
  # The address is confirmed from the link in the email: here, from a fresh
  # link, opened in the browser. Then a sign-in, through the cookie jar the
  # browser shares with the request helpers (a sign-in clicked in the browser
  # renews the session, which the next visit() would put back as it was).
  wait_for_text("Check your inbox")
  token = User.find_by("email", email).start_email_confirmation
  visit("/confirm_email?token=#{token}")
  wait_for_text("Your email address is confirmed")
  login(email, JOURNEY_PASSWORD)
  visit("/app")
  wait_for_text("Your scores")
end

# Two bars for a violin and a third voice the editor does not write, as MusicXML.
const VIOLIN_XML = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><work><work-title>Imported</work-title></work>
<part-list><score-part id="P1"><part-name>Violin</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions>
<time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note>
<backup><duration>2</duration></backup>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>2</voice><type>half</type></note>
<backup><duration>2</duration></backup>
<note><pitch><step>A</step><octave>4</octave></pitch><duration>2</duration><voice>3</voice><type>half</type></note>
</measure></part></score-partwise>"""

# Chooses a file for the start screen's Import, as a person does.
def import_in_browser(name, text)
  evaluate("(() => { const input = document.querySelector('[data-import]'); const files = new DataTransfer();"
  + " files.items.add(new File([#{JSON.stringify(text)}], #{JSON.stringify(name)})); input.files = files.files;"
  + " input.dispatchEvent(new Event('change', { bubbles: true })); })()")
end

# Two staves, four bars, imported as a person does.
const DUET = "\\score { \\new PianoStaff << \\new Staff { c'4 d' e' f' | g'1 | a'2 g' | c''1 }"
+ " \\new Staff { \\clef bass c1 | g,1 | f,2 g, | c1 } >> }"

# A press and a release on the MIDI view, from bar `a` of track `l0` to bar
# `b` of track `l1`: pointer events, as a mouse sends them.
const ROLL_DRAG = """
(a, l0, b, l1) => {
  const svg = document.querySelector('.studio-roll-scroll svg');
  const box = svg.getBoundingClientRect();
  const tracks = [...svg.querySelectorAll('.roll-track')].map((r) => r.getBBox());
  const bars = [...svg.querySelectorAll('.roll-ruler')].map((r) => r.getBBox());
  const at = (bar, lane) => [box.left + bars[bar].x + 8, box.top + tracks[lane].y + 6];
  const [x1, y1] = at(a, l0);
  const [x2, y2] = at(b, l1);
  const host = document.querySelector('.studio-roll');
  const press = (type, x, y, el) =>
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
  press('pointerdown', x1, y1, document.elementFromPoint(x1, y1));
  press('pointermove', x2, y2, host);
  press('pointerup', x2, y2, host);
}
"""

def roll_drag(a, l0, b, l1)
  evaluate("(#{ROLL_DRAG.trim})(#{a}, #{l0}, #{b}, #{l1})")
end

# A drag (or a click) on the MIDI view's ruler, from bar `a` to bar `b`: the loop's.
const ROLL_RULER = """
(a, b) => {
  const svg = document.querySelector('.studio-roll-scroll svg');
  const box = svg.getBoundingClientRect();
  const bars = [...svg.querySelectorAll('.roll-ruler')].map((r) => r.getBBox());
  const host = document.querySelector('.studio-roll');
  const at = (bar) => [box.left + bars[bar].x + 8, box.top + 10];
  const [x1, y1] = at(a);
  const [x2, y2] = at(b);
  const press = (type, x, y, el) =>
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
  press('pointerdown', x1, y1, document.elementFromPoint(x1, y1));
  if (a !== b) press('pointermove', x2, y2, host);
  press('pointerup', x2, y2, host);
}
"""

# A double click on track `lane`'s name in the MIDI view.
const ROLL_TRACK_NAME = """
(lane) => {
  const svg = document.querySelector('.studio-roll-scroll svg');
  const box = svg.getBoundingClientRect();
  const track = [...svg.querySelectorAll('.roll-track')][lane].getBBox();
  const [x, y] = [box.left + 30, box.top + track.y + 12];
  document.elementFromPoint(x, y).dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: x, clientY: y }));
}
"""

# The keyboard's note `nth` of the first track, dragged up `rows` rows.
const ROLL_NOTE_DRAG = """
(nth, rows) => {
  const note = [...document.querySelectorAll('.roll-keys .roll-note[data-lane="0"]')][nth];
  const r = note.getBoundingClientRect();
  const host = document.querySelector('.studio-roll');
  const [x, y] = [r.left + 3, r.top + r.height / 2];
  const press = (type, dy, el) =>
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y - dy, pointerId: 1 }));
  press('pointerdown', 0, note);
  press('pointermove', rows * 11, host);
  press('pointerup', rows * 11, host);
}
"""

# The note first drawn on the MIDI view, pressed.
const ROLL_PICK = """
(() => {
  const note = document.querySelector('.roll-note');
  const b = note.getBoundingClientRect();
  const at = { bubbles: true, clientX: b.left + 2, clientY: b.top + 2, pointerId: 1 };
  note.dispatchEvent(new PointerEvent('pointerdown', at));
})()
"""

# File › Open an example: the gallery's first.
const OPEN_FIRST_EXAMPLE = """
(() => {
  const select = document.querySelector('[data-act="example"]');
  select.value = select.options[1].value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
})()
"""

def roll_keys(key, shift)
  evaluate("document.querySelector('.studio-roll').dispatchEvent(new KeyboardEvent('keydown',"
  + " { key: '#{key}', ctrlKey: true, shiftKey: #{shift}, bubbles: true }))")
end

describe("The app, in a browser") do
  before_each() do
    logout()
  end

  test("sign up, start a quartet, write, reload, keep a version, go back to it") do
    sign_up_in_browser(journey_email())
    assert_text("New score")
    choose("input[value='string-quartet']")
    fill_in("#new-title", "Quartet in G")
    click_button("Create the score")
    wait_for("[data-save-state]")
    assert_text("Quartet in G")
    score_path = page_path()
    assert_match(score_path, "^/app/scores/")

    write_notes([4, 5, 6])
    wait_saved()
    assert_match(editor_source(), "g'*4 a'*4 b'*4")

    visit(score_path)
    wait_editor()
    assert_match(editor_source(), "g'*4 a'*4 b'*4")

    click_button("Keep a version")
    wait_for_text("Version kept")
    write_notes([0, 0])
    wait_saved()
    # A page opened afresh writes from the start: the Cs over the G and the A.
    assert_match(editor_source(), "c'*4 c'*4 b'*4")

    click_link("History")
    assert_text("kept on request")
    # The version asked for (an automatic one may share its second).
    rows = "[...document.querySelectorAll('.trash-list li')]"
    evaluate(rows + ".find((row) => row.textContent.includes('kept on request')).querySelector('a').click()")
    wait_for_text("Restore this version")
    click_button("Restore this version")
    assert_page_path(score_path)
    assert_text("The score is back as it was")
    assert_not(Regex.matches("c'*4 c'*4 b'*4", editor_source()))
    assert_match(editor_source(), "g'*4 a'*4 b'*4")
    assert_no_page_errors()
  end

  test("share a score by its link: a guest reads and plays it, but cannot edit it") do
    sign_up_in_browser(journey_email())
    click_button("Create the score")
    wait_for("[data-save-state]")
    score_path = page_path()
    write_notes([2, 4])
    wait_saved()

    click_link("Share")
    choose("input[value='link']")
    click_button("Save")
    assert_text("open to whoever has its link")
    read_path = evaluate("/\\/s\\/[A-Za-z0-9_-]+/.exec(document.getElementById('read-url').value)[0]")
    assert_match(read_path, "^/s/")

    sign_out_in_browser()
    visit(read_path)
    assert_selector("[data-score-play]")
    assert_selector(".score-sheet svg")
    assert_no_text("Open in the editor")
    visit(score_path)
    assert_match(page_path(), "^/login")
    assert_text("Sign in")
  end

  test("someone else's private score stays closed") do
    owner = journey_email()
    sign_up_in_browser(owner)
    click_button("Create the score")
    wait_for("[data-save-state]")
    score_path = page_path()
    share_page = "fetch(location.pathname + '/share').then(r => r.text())"
    read_path = "/s/" + evaluate(share_page + ".then(t => /\\/s\\/([A-Za-z0-9_-]+)/.exec(t)[1])")

    sign_out_in_browser()
    someone_else = User.new()
    someone_else.email = journey_email()
    someone_else.set_password(JOURNEY_PASSWORD)
    someone_else.confirmed_at = DateTime.utc.to_unix
    someone_else.save
    login(someone_else.email, JOURNEY_PASSWORD)
    visit(score_path)
    assert_text("Forbidden")
    visit(read_path)
    assert_text("No such score")
  end

  test("an example opened from the editor becomes a new score; the one open stays as it was") do
    sign_up_in_browser(journey_email())
    choose("input[value='string-quartet']")
    fill_in("#new-title", "Kept quartet")
    click_button("Create the score")
    wait_for("[data-save-state]")
    first_path = page_path()
    write_notes([4, 5, 6])
    wait_saved()

    evaluate(OPEN_FIRST_EXAMPLE)
    sleep(3)
    wait_editor()
    assert_match(page_path(), "^/app/scores/")
    assert_not(page_path() == first_path)
    assert_not(Regex.matches("g'*4 a'*4 b'*4", editor_source()))

    visit(first_path)
    wait_editor()
    assert_text("Kept quartet")
    assert_match(editor_source(), "g'*4 a'*4 b'*4")
    assert_no_page_errors()
  end

  test("import a MusicXML file: what it leaves out is named first, then the score is created") do
    sign_up_in_browser(journey_email())
    import_in_browser("imported.musicxml", VIOLIN_XML)
    wait_for_text("Left out of imported.musicxml: a third voice on a staff, left out.")
    assert_page_path("/app")
    click_button("Create the score anyway")
    wait_for("[data-save-state]")
    assert_match(page_path(), "^/app/scores/")
    assert_text("Imported")
    assert_contains(editor_source(), "e''2")
    assert_contains(editor_source(), "c''2")
    assert_not(editor_source().includes?("a'2"))
  end

  test("the MIDI view: a section of two tracks copied, then put in as new bars") do
    sign_up_in_browser(journey_email())
    import_in_browser("duet.ly", DUET)
    wait_for("[data-save-state]")
    wait_editor()
    click("[data-midi-button]")
    wait_for(".studio-roll-scroll svg.roll-tracks")
    assert_eq(evaluate("document.querySelectorAll('.roll-track').length"), 2)
    roll_drag(0, 0, 1, 1)
    wait_for_text("Bars 1–2, 2 tracks")
    roll_keys("c", false)
    wait_for_text("2 bars of 2 tracks copied")
    # A click elsewhere lets the selection go; a click then picks bar 3.
    roll_drag(2, 0, 2, 0)
    assert_null(evaluate("document.querySelector('#studio').studio.sel"))
    roll_drag(2, 0, 2, 0)
    assert_eq(evaluate("document.querySelector('#studio').studio.sel.bars[0]"), 2)
    roll_keys("V", true)
    wait_for_text("2 bars put in as bars 3–4")
    wait_saved()
    assert_contains(editor_source(), "c'4 d'4 e'4 f'4 | g'1 | c'4 d'4 e'4 f'4 | g'1 |")
    assert_contains(editor_source(), "c1 | g,1 | c1 | g,1 |")
    assert_contains(
      evaluate("document.querySelector('.studio-roll-scroll svg').getAttribute('aria-label')"),
      "6 bars"
    )
    # The loop is set on the ruler, apart from the selection, and a click on it takes it away.
    evaluate("(#{ROLL_RULER.trim})(0, 1)")
    assert_eq(evaluate("JSON.stringify(document.querySelector('#studio').studio.loopBars)"), "[0,1]")
    wait_for(".roll-loop")
    evaluate("(#{ROLL_RULER.trim})(1, 1)")
    assert_null(evaluate("document.querySelector('#studio').studio.loopBars"))
    # A double click on a track's name: that track alone, on the keyboard.
    evaluate("(#{ROLL_TRACK_NAME.trim})(1)")
    wait_for(".studio-roll-scroll svg.roll-keys")
    assert_eq(evaluate("document.querySelectorAll('.roll-note[data-lane=\"0\"]').length"), 0)
    assert_contains(evaluate("document.querySelector('[data-roll-only]').textContent"), "only")
    # The keyboard layout, every track, and a note picked there is the editor's selection.
    click("[data-layout='keys']")
    wait_for(".studio-roll-scroll svg.roll-keys")
    evaluate(ROLL_PICK.trim)
    wait_for(".roll-note-chosen")
    # Dragged up two rows: the first c' is a d'; Ctrl+Z puts it back.
    evaluate("(#{ROLL_NOTE_DRAG.trim})(0, 2)")
    wait_for_text("Note moved")
    assert_contains(editor_source(), "d'4 d'4 e'4 f'4 | g'1 | c'4")
    roll_keys("z", false)
    assert_contains(editor_source(), "c'4 d'4 e'4 f'4 | g'1 | c'4")
    # Saved before the next page: a change not yet saved holds the page.
    wait_saved()
    # Back to the score: the engraving, with the bars put in.
    click("[data-midi-button]")
    wait_for(".studio-sheet:not([hidden]) svg")
    assert_no_page_errors()
  end

  test("import a file that is not MusicXML: refused, nothing created") do
    email = journey_email()
    sign_up_in_browser(email)
    import_in_browser("page.xml", "<html></html>")
    wait_for_text("This is not a MusicXML score")
    assert_page_path("/app")
    assert_eq(Score.where({"user_id": User.find_by("email", email)._key}).count, 0)
  end

  test("two-step sign-in: set up from a QR code, then asked for at sign-in") do
    email = journey_email()
    sign_up_in_browser(email)
    visit("/app/account")
    click_button("Turn two-step sign-in on")
    wait_for(".two-step-qr svg")
    secret = User.find_by("email", email).pending_two_step
    assert_text(secret)
    fill_in("#code", Crypto.totp_generate(secret, DateTime.utc.to_unix, 30))
    click("form.auth-form button[type=submit]")
    wait_for_text("Two-step sign-in is on")
    assert_eq(evaluate("document.querySelectorAll('.two-step-codes li').length"), 10)
    sign_out_in_browser()
    fill_in("#email", email)
    fill_in("#password", JOURNEY_PASSWORD)
    click("form.auth-form button[type=submit]")
    assert_page_path("/login/code")
    fill_in("#code", Crypto.totp_generate(secret, DateTime.utc.to_unix + 30, 30))
    click("form.auth-form button[type=submit]")
    assert_page_path("/app")
    assert_no_page_errors()
  end

  test("a save refused because the score changed elsewhere: keep mine, or save it as a copy") do
    email = journey_email()
    sign_up_in_browser(email)
    click_button("Create the score")
    wait_for("[data-save-state]")
    score_path = page_path()
    write_notes([2])
    wait_saved()
    # Saved from another window meanwhile.
    score = Score.find(score_path.replace("/app/scores/", ""))
    score.save_from_editor(score.source + "\n% theirs", score.revision)

    write_more(4)
    wait_for("[data-conflict][open]")
    assert_text("Changed elsewhere")
    assert_text("Keep mine")
    assert_text("Load theirs")
    assert_text("Save mine as a copy")
    click("[data-conflict-mine]")
    wait_saved()
    assert_eq(Score.find(score._key).source, editor_source())
    assert_not(Score.find(score._key).source.contains("% theirs"))
    assert_eq(ScoreVersion.history(score).filter(&{ |version|
      version.reason == "conflict"
    }).length, 1)

    score = Score.find(score._key)
    score.save_from_editor(score.source + "\n% theirs again", score.revision)
    write_more(5)
    wait_for("[data-conflict][open]")
    click("[data-conflict-copy]")
    wait_for_text("Your changes save themselves")
    assert_ne(page_path(), score_path)
    assert_eq(Score.where({"user_id": User.find_by("email", email)._key}).count, 2)
    assert_no_page_errors()
  end

  test("signed out while editing: the editor says so, keeps the text, and stops trying") do
    sign_up_in_browser(journey_email())
    click_button("Create the score")
    wait_for("[data-save-state]")
    score_path = page_path()
    write_notes([2])
    wait_saved()
    # Signed out from another tab: the account page's own sign-out form.
    evaluate("fetch('/app/account').then((r) => r.text()).then((page) => { const form = new DOMParser()"
    + ".parseFromString(page, 'text/html').querySelector('form[action=\"/logout\"]');"
    + " return fetch('/logout', { method: 'POST', body: new URLSearchParams(new FormData(form)) }); })")
    sleep(1)
    write_more(4)
    wait_for("[data-save-state] [data-sign-in]")
    assert_text("Signed out: sign in again to save (your changes are kept here)")
    kept = evaluate("localStorage.getItem('eui-score-pending:' + location.pathname.split('/').pop())")
    assert_eq(JSON.parse(kept)["text"], editor_source())
    stored_source = Score.find(score_path.replace("/app/scores/", "")).source
    assert_ne(stored_source, editor_source())
    # No retry: the page stays signed out, and still says so.
    sleep(2)
    assert_text("Signed out: sign in again")
    assert_eq(Score.find(score_path.replace("/app/scores/", "")).source, stored_source)
    assert_no_page_errors()
  end
end
