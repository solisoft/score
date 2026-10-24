# Comments that follow their bars, the @ list, and the read page live, in a
# real browser (soli test --browser, #392): a bar put in before a comment's
# bar moves it, an Undo moves it back; @ lists the score's people and Enter
# chooses one; a read page open beside the editor hears a new comment.

const MOVING_PASSWORD = "correct horse battery"
const MOVING_SOURCE = "\\header { title = \"Moving\" }\n\\new Staff { \\time 4/4 c'4 d' e' f' | g'1 | a'1 | b'1 }\n"

# Waits (ten seconds at most) for a JavaScript condition to hold.
def moving_wait(condition)
  tries = 0
  check = "(() => { try { return Boolean(#{condition}); } catch (e) { return false; } })()"
  while tries < 50 && evaluate(check) != true
    sleep(0.2)
    tries = tries + 1
  end
  assert(tries < 50, "waited for: #{condition}")
end

# Waits (ten seconds at most) for the thread `key` to be on `bars`.
def moving_wait_bars(key, bars)
  tries = 0
  while tries < 50 && ScoreThread.find(key).bars != bars
    sleep(0.2)
    tries = tries + 1
  end
  assert_eq(ScoreThread.find(key).bars, bars)
end

# Signs up and in, makes the score and opens it in the editor. Answers {"score", "user"}.
def moving_open
  email = "moving-#{uuid_v4}@example.com"
  visit("/signup")
  fill_in("#email", email)
  fill_in("#password", MOVING_PASSWORD)
  # The form refuses what is sent back within two seconds of being shown.
  sleep(2.2)
  click("form.auth-form button[type=submit]")
  wait_for_text("Check your inbox")
  user = User.find_by("email", email)
  visit("/confirm_email?token=#{user.start_email_confirmation}")
  wait_for_text("Your email address is confirmed")
  login(email, MOVING_PASSWORD)
  score = Score.start(user, MOVING_SOURCE)
  visit("/app/scores/#{score._key}")
  wait_for_text("Your changes save themselves")
  {"score": score, "user": user}
end

# The note `token` chosen from the text, as a click in it does.
def moving_pick(token)
  evaluate("(() => { const box = document.querySelector('[data-source]');"
  + " const at = box.value.indexOf(#{JSON.stringify(token)}) + 1; box.focus(); box.setSelectionRange(at, at);"
  + " box.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()")
end

# Types `text` in the box `selector` (of document `doc`) and sends its form.
def moving_send(doc, selector, text)
  evaluate("(() => { const box = #{doc}.querySelector(#{JSON.stringify(selector)});"
  + " box.value = #{JSON.stringify(text)}; box.dispatchEvent(new Event('input', { bubbles: true }));"
  + " box.form.requestSubmit(); })()")
end

# `text` typed in the new comment's box, the caret at its end.
def moving_type(text)
  evaluate("(() => { const box = document.querySelector('[data-comment-new] textarea'); box.focus();"
  + " box.value = #{JSON.stringify(text)}; box.setSelectionRange(#{text.length}, #{text.length});"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
end

# A comment on the note `token`'s bar, from the Edit menu.
def moving_comment(token, text)
  moving_pick(token)
  moving_wait("document.querySelector('[data-state]')")
  evaluate("document.querySelector('.studio-dropdown [data-act=\"comment\"]').click()")
  wait_for("[data-comments-panel]:not([hidden]) [data-comment-new]")
  moving_send("document", "[data-comment-new] textarea", text)
  wait_for(".comment-thread")
end

describe("Comments that follow their bars, in a browser (#392)") do
  before_each() do
    logout()
  end

  test("a bar put in before a comment's bar moves the comment; Undo moves it back") do
    opened = moving_open()
    score = opened["score"]
    moving_comment("a'1", "Louder here?")
    thread = ScoreThread.where({"score_id": score._key}).first
    assert_eq(thread.bars, [2, 2])
    # A bar put in before bar 2: the comment's bar 3 becomes bar 4.
    moving_pick("g'1")
    moving_wait("document.querySelector('[data-state]')")
    evaluate("document.querySelector('.studio-dropdown [data-act=\"insert-bar\"]').click()")
    moving_wait_bars(thread._key, [3, 3])
    assert_eq(ScoreThread.find(thread._key).label, "Bar 4, Staff 1")
    moving_wait("document.querySelector('.comment-anchor').textContent.startsWith('Bar 4')")
    # Undo: the bar goes, the comment comes back to bar 3.
    evaluate("document.querySelector('.studio-dropdown [data-act=\"undo\"]').click()")
    moving_wait_bars(thread._key, [2, 2])
    # Its bar taken away: kept, and says so.
    moving_pick("a'1")
    moving_wait("document.querySelector('[data-state]')")
    evaluate("document.querySelector('.studio-dropdown [data-act=\"delete-bars\"]').click()")
    tries = 0
    while tries < 50 && ScoreThread.find(thread._key).detached.nil?
      sleep(0.2)
      tries = tries + 1
    end
    assert_eq(ScoreThread.find(thread._key).detached, "bars")
    moving_wait("document.querySelector('.comment-detached-note')")
    assert_text("Its bars were removed")
    moving_wait("!document.querySelector('.studio-note-marker')")
    assert_no_page_errors()
  end

  test("@ lists the score's people as one types; the arrows and Enter choose one") do
    opened = moving_open()
    score = opened["score"]
    friend = User.new()
    friend.email = "moving-friend-#{uuid_v4}@example.com"
    friend.name = "Zelda Friend"
    friend.set_password(MOVING_PASSWORD)
    friend.save
    ScoreShare.invite(score, friend.email, "read")
    moving_pick("a'1")
    moving_wait("document.querySelector('[data-state]')")
    evaluate("document.querySelector('.studio-dropdown [data-act=\"comment\"]').click()")
    wait_for("[data-comment-new] textarea")
    moving_type("Ask @zel")
    moving_wait("document.querySelector('.comment-mentions:not([hidden]) li')")
    assert_eq(evaluate("document.querySelectorAll('.comment-mentions li').length"), 1)
    assert_contains(evaluate("document.querySelector('.comment-mentions li').textContent"), "Zelda Friend")
    evaluate("document.querySelector('[data-comment-new] textarea').dispatchEvent("
    + "new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))")
    moving_wait("document.querySelector('.comment-mentions').hidden")
    assert_eq(evaluate("document.querySelector('[data-comment-new] textarea').value"), "Ask @#{friend.email} ")
    # Someone who is not one of the score's people is not listed.
    moving_type("@nobody")
    sleep(0.5)
    assert(evaluate("document.querySelector('.comment-mentions').hidden"), "nobody to list")
    assert_no_page_errors()
  end

  test("the read page, open beside the editor, hears a new comment as it is written") do
    opened = moving_open()
    score = opened["score"]
    evaluate("(() => { const frame = document.createElement('iframe'); frame.id = 'reading';"
    + " frame.src = '/s/#{score.share_token}';"
    + " frame.style.cssText = 'position:fixed;left:0;bottom:0;width:820px;height:600px;z-index:50;background:#fff';"
    + " document.body.append(frame); })()")
    reading = "document.getElementById('reading').contentDocument"
    moving_wait("#{reading}?.querySelector('[data-read-comments] .comment-panel-head')")
    # Both in the room (one person: the editor lists only the others).
    sleep(1.5)
    moving_comment("g'1", "Heard on the read page?")
    moving_wait("#{reading}.querySelector('.comment-thread')?.textContent.includes('Heard on the read page?')")
    assert_no_page_errors()
  end
end
