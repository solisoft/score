# The undo history kept in the browser (#387), in a real browser (soli test
# --browser): a reload can still undo; there is no limit of 300 steps; a
# history that ends at another text than the one opened is left in the
# playground; and in the app, someone else's change — saved live or while
# the page was closed — is never taken back by Undo, which merges around it
# or, where both changed the same bar, refuses.

const UH_PASSWORD = "correct horse battery"
const UH_SOURCE = "\\header { title = \"Kept\" }\n\\new Staff { \\time 4/4 c'4 d' e' f' | g'1 | a'1 | b'1 }\n"
const UH_MOON = "\\header { title = \"Au clair de la lune\" }\n{ \\time 4/4 c'4 c' c' d' | e'2 d' | c'1 }"

# The document of the editor `which`: "main" (the page) or "other" (a frame beside it).
def uh_doc(which)
  return "document" if which == "main"

  "document.getElementById('other').contentDocument"
end

def uh_text(which = "main")
  evaluate("#{uh_doc(which)}.querySelector('[data-source]').value")
end

def uh_status
  evaluate("document.querySelector('[data-status]').textContent")
end

# Waits (ten seconds at most) for a JavaScript condition to hold.
def uh_wait(condition)
  tries = 0
  check = "(() => { try { return Boolean(#{condition}); } catch (e) { return false; } })()"
  while tries < 50 && evaluate(check) != true
    sleep(0.2)
    tries = tries + 1
  end
  assert(tries < 50, "waited for: #{condition}")
end

# Types in editor `which`'s text: `old_text` replaced by `new_text`, then left, as a person does.
def uh_type(which, old_text, new_text)
  evaluate("(() => { const box = #{uh_doc(which)}.querySelector('[data-source]');"
  + " box.value = box.value.replace(#{JSON.stringify(old_text)}, #{JSON.stringify(new_text)});"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("#{uh_doc(which)}.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.3)
end

# Edit ▸ Undo (or Redo), as the menu's item does.
def uh_menu(what)
  evaluate("document.querySelector('.studio-dropdown-items [data-act=\"#{what}\"]').click()")
  sleep(0.3)
end

def uh_steps
  evaluate("document.getElementById('studio').studio.past.length")
end

# The playground opened, the page's history and draft as the last visit left them.
def uh_playground
  visit("/playground")
  wait_for("[data-source]")
  uh_wait("document.getElementById('studio')?.dataset.history")
  sleep(0.5)
end

# Leaves the history time to be written (it waits for the edits to stop).
def uh_settle
  sleep(1.0)
end

# Signs up and in, and makes a score: answers [user, score].
def uh_sign_up
  email = "uh-#{uuid_v4}@example.com"
  visit("/signup")
  fill_in("#email", email)
  fill_in("#password", UH_PASSWORD)
  sleep(2.2)
  click("form.auth-form button[type=submit]")
  wait_for_text("Check your inbox")
  user = User.find_by("email", email)
  visit("/confirm_email?token=#{user.start_email_confirmation}")
  wait_for_text("Your email address is confirmed")
  login(email, UH_PASSWORD)
  [user, Score.start(user, UH_SOURCE)]
end

def uh_open(score)
  visit("/app/scores/#{score._key}")
  wait_for_text("Your changes save themselves")
  uh_wait("document.getElementById('studio')?.dataset.history")
  sleep(0.5)
end

# The same score open in a frame beside the page: a second editor in its room.
def uh_frame
  evaluate("(() => { const frame = document.createElement('iframe'); frame.id = 'other';"
  + " frame.src = location.pathname; frame.style.cssText = 'position:fixed;right:0;bottom:0;"
  + "width:820px;height:600px;z-index:50;background:#fff'; document.body.append(frame); })()")
  uh_wait("#{uh_doc("other")}?.body?.innerText.includes('Your changes save themselves')")
  sleep(1.5)
end

def uh_saved
  uh_wait("document.querySelector('[data-save-state]').textContent.startsWith('Saved')")
end

describe("The undo history, kept in the browser") do
  before_each() do
    logout()
  end

  test("the playground: an edit, a reload, and Undo still takes it back; Redo puts it again") do
    uh_playground()
    uh_type("main", uh_text(), UH_MOON)
    before = uh_text()
    uh_type("main", "e'2", "f'2")
    edited = uh_text()
    assert_contains(edited, "f'2")
    uh_settle()
    uh_playground()
    assert_eq(uh_text(), edited, "the draft opened")
    assert_contains(uh_status(), "Your undo history is back")
    assert_eq(evaluate("document.querySelector('[data-act=\"undo\"]').disabled"), false)
    uh_menu("undo")
    assert_eq(uh_text(), before, "the edit taken back")
    uh_menu("redo")
    assert_eq(uh_text(), edited, "and put again")
    assert_no_page_errors()
  end

  test("the playground: a history that ends at another text than the one opened is left") do
    uh_playground()
    uh_type("main", uh_text(), UH_MOON)
    uh_type("main", "e'2", "f'2")
    uh_settle()
    # The draft changed behind the history's back (another tab, say).
    evaluate("localStorage.setItem('eui-score-studio-draft', #{JSON.stringify(UH_MOON.replace("c'1", "g'1"))})")
    uh_playground()
    assert_contains(uh_text(), "g'1")
    assert_not(uh_status().contains("Your undo history is back"))
    assert_eq(uh_steps(), 0, "nothing to undo")
    assert_eq(evaluate("document.querySelector('[data-act=\"undo\"]').disabled"), true)
    assert_no_page_errors()
  end

  test("no limit of 300: 320 steps, a reload, and every one of them undone") do
    uh_playground()
    uh_type("main", uh_text(), UH_MOON)
    before = uh_text()
    # A note selected, then moved up and down 320 times: 320 steps.
    evaluate("(() => { const box = document.querySelector('[data-source]'); const at = box.value.indexOf(\"e'2\") + 1;"
    + " box.focus(); box.setSelectionRange(at, at);"
    + " box.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()")
    sleep(0.4)
    evaluate("(() => { const sheet = document.querySelector('.studio-sheet'); sheet.focus();"
    + " for (let i = 0; i < 320; i++) sheet.dispatchEvent(new KeyboardEvent('keydown',"
    + " { key: i % 2 ? 'ArrowDown' : 'ArrowUp', bubbles: true })); })()")
    sleep(0.5)
    assert_gt(uh_steps(), 320)
    uh_settle()
    uh_playground()
    steps = uh_steps()
    assert_gt(steps, 320, "all kept across the reload")
    evaluate("(() => { const undo = document.querySelector('.studio-dropdown-items [data-act=\"undo\"]');"
    + " for (let i = 0; i < 320; i++) undo.click(); })()")
    sleep(0.5)
    assert_eq(uh_steps(), steps - 320)
    assert_eq(uh_text(), before, "back to before the first of them")
    assert_no_page_errors()
  end

  test("the app: an edit saved, a reload, Undo takes it back and saves that") do
    pair = uh_sign_up()
    score = pair[1]
    uh_open(score)
    uh_type("main", "g'1", "f'2 e'")
    uh_saved()
    assert_contains(Score.find(score._key).source, "f'2 e'")
    uh_settle()
    uh_open(score)
    assert_contains(uh_status(), "Your undo history is back")
    uh_menu("undo")
    assert_not(uh_text().contains("f'2 e'"))
    uh_saved()
    assert_not(Score.find(score._key).source.contains("f'2 e'"), "the undo saved")
    assert_no_page_errors()
  end

  test("the app: someone else's change saved live, then Undo: mine goes, theirs stays") do
    pair = uh_sign_up()
    score = pair[1]
    uh_open(score)
    uh_frame()
    uh_type("main", "g'1", "f'2 e'")
    uh_saved()
    uh_wait("#{uh_doc("other")}.querySelector('[data-source]').value.includes(\"f'2 e'\")")
    # Theirs, in another bar, arrives here live.
    uh_type("other", "a'1", "c''1")
    uh_wait("document.querySelector('[data-source]').value.includes(\"c''1\")")
    uh_menu("undo")
    assert_not(uh_text().contains("f'2 e'"), "my step taken back")
    assert_contains(uh_text(), "c''1", "theirs kept")
    assert_contains(uh_status(), "around the changes made elsewhere")
    uh_saved()
    saved = Score.find(score._key).source
    assert_contains(saved, "c''1")
    assert_not(saved.contains("f'2 e'"))
    # Undo once more: nothing of mine left before that, and theirs still there.
    uh_menu("undo")
    assert_contains(uh_text(), "c''1")
    assert_no_page_errors()
  end

  test("the app: someone else rewrote the bar I changed: Undo refuses, and changes nothing") do
    pair = uh_sign_up()
    score = pair[1]
    uh_open(score)
    uh_frame()
    uh_type("main", "g'1", "f'2 e'")
    uh_saved()
    uh_wait("#{uh_doc("other")}.querySelector('[data-source]').value.includes(\"f'2 e'\")")
    uh_type("other", "f'2 e'", "d''2 e'")
    uh_wait("document.querySelector('[data-source]').value.includes(\"d''2\")")
    text_before = uh_text()
    steps_before = uh_steps()
    uh_menu("undo")
    assert_contains(uh_status(), "Undo stops here")
    assert_contains(uh_status(), "Bar 2")
    assert_eq(uh_text(), text_before, "nothing changed")
    assert_eq(uh_steps(), steps_before, "the step stays")
    sleep(2)
    assert_contains(Score.find(score._key).source, "d''2", "theirs saved, untouched")
    assert_no_page_errors()
  end

  test("the app: saved by someone else while the page was closed: the history comes back, and Undo keeps theirs") do
    pair = uh_sign_up()
    user = pair[0]
    score = pair[1]
    uh_open(score)
    uh_type("main", "g'1", "f'2 e'")
    uh_saved()
    uh_settle()
    visit("/app")
    # Someone else's save, in bar 3, while this person is away.
    stored = Score.find(score._key)
    answer = stored.save_from_editor(stored.source.replace("a'1", "c''1"), stored.revision, user)
    assert_eq(answer["status"], 200)
    uh_open(score)
    assert_contains(uh_text(), "c''1")
    assert_contains(uh_status(), "changed elsewhere since")
    uh_menu("undo")
    assert_not(uh_text().contains("f'2 e'"), "my step taken back")
    assert_contains(uh_text(), "c''1", "theirs kept")
    uh_saved()
    assert_contains(Score.find(score._key).source, "c''1")
    assert_no_page_errors()
  end
end
