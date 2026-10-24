# Two editors on one score, in a real browser (soli test --browser): the
# score open twice — the page, and the same page in a frame beside it, each
# its own editor in the score's room — edits to different bars merged into
# both, the same bar changed two ways asked about by bar, and each editor's
# selection drawn on the other's score.

const CO_PASSWORD = "correct horse battery"
const CO_SOURCE = "\\header { title = \"Together\" }\n\\new Staff { \\time 4/4 c'4 d' e' f' | g'1 | a'1 | b'1 }\n"

# The document of the editor `which`: "main" (the page) or "other" (the frame).
def co_doc(which)
  return "document" if which == "main"

  "document.getElementById('other').contentDocument"
end

# Signs up and in, makes the score and opens it, and the same score in a
# frame beside it: two editors, two places in its room. Answers the score.
def co_open_twice
  email = "co-#{uuid_v4}@example.com"
  visit("/signup")
  fill_in("#email", email)
  fill_in("#password", CO_PASSWORD)
  # The form refuses what is sent back within two seconds of being shown.
  sleep(2.2)
  click("form.auth-form button[type=submit]")
  wait_for_text("Check your inbox")
  user = User.find_by("email", email)
  visit("/confirm_email?token=#{user.start_email_confirmation}")
  wait_for_text("Your email address is confirmed")
  login(email, CO_PASSWORD)
  score = Score.start(user, CO_SOURCE)
  visit("/app/scores/#{score._key}")
  wait_for_text("Your changes save themselves")
  evaluate("(() => { const frame = document.createElement('iframe'); frame.id = 'other'; frame.src = location.pathname;"
  + " frame.style.cssText = 'position:fixed;right:0;bottom:0;width:820px;height:600px;z-index:50;background:#fff';"
  + " document.body.append(frame); })()")
  co_wait("#{co_doc("other")}?.body?.innerText.includes('Your changes save themselves')")
  # Both in the room: each has sent where it works, and heard the other come in.
  sleep(1.5)
  score
end

# Waits (ten seconds at most) for a JavaScript condition to hold.
def co_wait(condition)
  tries = 0
  check = "(() => { try { return Boolean(#{condition}); } catch (e) { return false; } })()"
  while tries < 50 && evaluate(check) != true
    sleep(0.2)
    tries = tries + 1
  end
  assert(tries < 50, "waited for: #{condition}")
end

# Types in editor `which`'s text: `old_text` replaced by `new_text`, then left, as a person does.
def co_type(which, old_text, new_text)
  evaluate("(() => { const box = #{co_doc(which)}.querySelector('[data-source]');"
  + " box.value = box.value.replace(#{JSON.stringify(old_text)}, #{JSON.stringify(new_text)});"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("#{co_doc(which)}.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.3)
end

# The page's saves held back a few seconds, as on a slow network: the
# frame's save gets there first, and the page meets it with a change of its own.
def co_slow_saves
  evaluate("(() => { const sent = window.fetch; window.fetch = (url, options) => options?.method === 'PUT'"
  + " ? new Promise((done) => setTimeout(done, 2500)).then(() => sent(url, options)) : sent(url, options); })()")
end

def co_source(which)
  evaluate("#{co_doc(which)}.querySelector('[data-source]').value")
end

describe("Two editors on one score, in a browser") do
  before_each() do
    logout()
  end

  test("different bars changed in each: both end up with both changes, and so does the score") do
    score = co_open_twice()
    # The frame's save first, the page's change meeting it: the page merges.
    co_slow_saves()
    co_type("other", "a'1", "c''1")
    co_type("main", "g'1", "f'2 e'")
    co_wait("document.querySelector('[data-source]').value.includes(\"c''1\")")
    co_wait("#{co_doc("other")}.querySelector('[data-source]').value.includes(\"f'2 e'\")")
    assert_text("Merged with the changes from your other window")
    co_wait("document.querySelector('[data-save-state]').textContent === 'Saved, merged with your other window'")
    co_wait("document.querySelector('[data-save-state]').textContent.startsWith('Saved')")
    co_wait("#{co_doc("other")}.querySelector('[data-save-state]').textContent.startsWith('Saved')")
    saved = Score.find(score._key).source
    assert_contains(saved, "c''1")
    assert_contains(saved, "f'2 e'")
    assert_eq(co_source("main"), co_source("other"))
    assert_no_selector("[data-conflict][open]")
    assert_no_page_errors()
  end

  test("the same bar changed two ways: the dialog names the bar, and mine is kept there, theirs elsewhere") do
    score = co_open_twice()
    co_slow_saves()
    co_type("other", "a'1", "c''1")
    co_type("other", "b'1", "e''1")
    co_type("main", "a'1", "d''1")
    wait_for("[data-conflict][open]")
    assert_text("Everything else is merged")
    assert_text("Bar 3, the staff")
    assert_text("Keep mine for these")
    assert_text("Take theirs for these")
    assert_text("Save mine as a copy")
    click("[data-conflict-bars-mine]")
    co_wait("document.querySelector('[data-save-state]').textContent.startsWith('Saved')")
    saved = Score.find(score._key).source
    # Mine in bar 3, theirs in bar 4.
    assert_contains(saved, "d''1")
    assert_contains(saved, "e''1")
    assert_not(saved.contains("c''1"))
    co_wait("#{co_doc("other")}.querySelector('[data-source]').value.includes(\"d''1\")")
    # The text refused at the 409 is kept in the history.
    assert_eq(ScoreVersion.history(score).filter(&{ |version|
      version.reason == "conflict"
    }).length, 1)
    assert_no_page_errors()
  end

  test("each editor's selection is drawn on the other's score, and goes when that editor does") do
    co_open_twice()
    # A note of bar 3 chosen in the frame, from its text.
    evaluate("(() => { const box = #{co_doc("other")}.querySelector('[data-source]');"
    + " const at = box.value.indexOf(\"a'1\") + 1; box.focus(); box.setSelectionRange(at, at);"
    + " box.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()")
    co_wait("document.querySelector('.studio-peer')")
    assert_eq(evaluate("document.querySelectorAll('.studio-peer').length"), 1, "one bar, one band")
    assert_text("You, in another window")
    # In the MIDI view too.
    click("[data-midi-button]")
    co_wait("document.querySelector('.roll-peer rect')")
    click("[data-midi-button]")
    # The frame closed: its band goes.
    evaluate("document.getElementById('other').remove()")
    co_wait("!document.querySelector('.studio-peer')")
    assert_no_page_errors()
  end
end
