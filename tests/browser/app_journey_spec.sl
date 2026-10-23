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

# Waits for the editor's save to go through.
def wait_saved
  sleep(2)
  wait_for_text("Saved")
end

# Signs out as a person does, from the account page (the request helpers'
# logout() leaves the browser's own session alone).
def sign_out_in_browser
  visit("/app/account")
  click_button("Sign out")
  assert_page_path("/login")
end

def sign_up_in_browser(email)
  visit("/signup")
  fill_in("#email", email)
  fill_in("#password", JOURNEY_PASSWORD)
  # The form refuses what is sent back within two seconds of being shown.
  sleep(2.2)
  click("form.auth-form button[type=submit]")
  assert_page_path("/app")
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
    someone_else.save
    login(someone_else.email, JOURNEY_PASSWORD)
    visit(score_path)
    assert_text("Forbidden")
    visit(read_path)
    assert_text("No such score")
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

  test("import a file that is not MusicXML: refused, nothing created") do
    email = journey_email()
    sign_up_in_browser(email)
    import_in_browser("page.xml", "<html></html>")
    wait_for_text("This is not a MusicXML score")
    assert_page_path("/app")
    assert_eq(Score.where({"user_id": User.find_by("email", email)._key}).count, 0)
  end
end
