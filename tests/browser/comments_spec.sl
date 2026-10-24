# Comments in the editor, in a real browser (soli test --browser, #385): a
# note's bars commented on from the Edit menu, the bubble drawn on them, a
# reply, resolved (the bubble goes) and shown again; a thread clicked
# selects its bars; and a second window of the score hears the comment live.

const TALKING_PASSWORD = "correct horse battery"
const TALKING_SOURCE = "\\header { title = \"Talking\" }\n\\new Staff { \\time 4/4 c'4 d' e' f' | g'1 | a'1 | b'1 }\n"

# Waits (ten seconds at most) for a JavaScript condition to hold.
def talking_wait(condition)
  tries = 0
  check = "(() => { try { return Boolean(#{condition}); } catch (e) { return false; } })()"
  while tries < 50 && evaluate(check) != true
    sleep(0.2)
    tries = tries + 1
  end
  assert(tries < 50, "waited for: #{condition}")
end

# Signs up and in, makes the score and opens it in the editor. Answers {"score", "user"}.
def talking_open
  email = "talking-#{uuid_v4}@example.com"
  visit("/signup")
  fill_in("#email", email)
  fill_in("#password", TALKING_PASSWORD)
  # The form refuses what is sent back within two seconds of being shown.
  sleep(2.2)
  click("form.auth-form button[type=submit]")
  wait_for_text("Check your inbox")
  user = User.find_by("email", email)
  visit("/confirm_email?token=#{user.start_email_confirmation}")
  wait_for_text("Your email address is confirmed")
  login(email, TALKING_PASSWORD)
  score = Score.start(user, TALKING_SOURCE)
  visit("/app/scores/#{score._key}")
  wait_for_text("Your changes save themselves")
  {"score": score, "user": user}
end

# The note `token` chosen from the text, as a click in it does.
def talking_pick(doc, token)
  evaluate("(() => { const box = #{doc}.querySelector('[data-source]');"
  + " const at = box.value.indexOf(#{JSON.stringify(token)}) + 1; box.focus(); box.setSelectionRange(at, at);"
  + " box.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()")
end

# Types `text` in the box `selector` of the comments panel and sends its form.
def talking_send(selector, text)
  evaluate("(() => { const box = document.querySelector(#{JSON.stringify(selector)});"
  + " box.value = #{JSON.stringify(text)}; box.dispatchEvent(new Event('input', { bubbles: true }));"
  + " box.form.requestSubmit(); })()")
end

describe("Comments in the editor, in a browser") do
  before_each() do
    logout()
  end

  test("comment on a bar, reply, resolve: the bubble comes and goes; the thread selects its bars") do
    opened = talking_open()
    score = opened["score"]
    talking_pick("document", "a'1")
    talking_wait("document.querySelector('[data-state]')")
    # Edit › Comment on the selection.
    evaluate("document.querySelector('.studio-dropdown [data-act=\"comment\"]').click()")
    wait_for("[data-comments-panel]:not([hidden]) [data-comment-new]")
    assert_text("Bar 3")
    talking_send("[data-comment-new] textarea", "Should this be louder?")
    wait_for(".comment-thread")
    assert_text("Should this be louder?")
    assert_not(evaluate("document.querySelector('[data-comments]').textContent.includes('null')"), "no stray null")
    # The bubble, on the score.
    talking_wait("document.querySelector('.studio-note-marker')")
    assert_eq(evaluate("document.querySelector('[data-comments-count]').textContent"), "1")
    thread = ScoreThread.where({"score_id": score._key}).first
    assert_eq(thread.bars, [2, 2])
    assert_eq(thread.lane, 0)
    assert_contains(thread.label, "Bar 3")
    # A reply.
    talking_send(".comment-reply textarea", "Yes, forte.")
    talking_wait("document.querySelectorAll('.comment-message').length === 2")
    assert_eq(ScoreComment.where({"thread_id": thread._key}).count, 2)
    # The thread clicked: its bars selected.
    click(".comment-anchor")
    talking_wait("document.querySelector('.studio-bar-selected')")
    # Resolved: out of the list and off the score, back with "Show resolved".
    click(".comment-state")
    talking_wait("!document.querySelector('.comment-thread')")
    talking_wait("!document.querySelector('.studio-note-marker')")
    assert(ScoreThread.find(thread._key).resolved)
    evaluate("document.querySelector('.comment-toggle input').click()")
    wait_for(".comment-resolved")
    assert_text("Reopen")
    click(".comment-state")
    talking_wait("document.querySelector('.studio-note-marker')")
    assert_not(ScoreThread.find(thread._key).resolved)
    assert_no_page_errors()
  end

  test("a comment reaches the score's other window live, bubble and all") do
    opened = talking_open()
    evaluate("(() => { const frame = document.createElement('iframe'); frame.id = 'other';"
    + " frame.src = location.pathname;"
    + " frame.style.cssText = 'position:fixed;left:0;bottom:0;width:820px;height:600px;z-index:50;background:#fff';"
    + " document.body.append(frame); })()")
    other = "document.getElementById('other').contentDocument"
    talking_wait("#{other}?.body?.innerText.includes('Your changes save themselves')")
    # Both in the room.
    sleep(1.5)
    talking_pick("document", "g'1")
    # Ctrl+Alt+M, on the score.
    evaluate("document.querySelector('.studio-sheet').dispatchEvent(new KeyboardEvent('keydown',"
    + " { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true, bubbles: true }))")
    wait_for("[data-comment-new]")
    talking_send("[data-comment-new] textarea", "Heard over there?")
    wait_for(".comment-thread")
    talking_wait("#{other}.querySelector('.studio-note-marker')")
    talking_wait("#{other}.querySelector('[data-comments-count]').textContent === '1'")
    assert_eq(ScoreThread.where({"score_id": opened["score"]._key}).count, 1)
    assert_no_page_errors()
  end
end
