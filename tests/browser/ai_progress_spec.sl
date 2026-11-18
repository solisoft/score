# The editor's AI dialog following a question, in a real browser (#973).
# A question can take many minutes (a whole fugue, from a model that thinks
# first): the dialog says how it goes — waiting, thinking with how far the
# reasoning has gone, writing with the score written so far engraved — and
# shows the answer once ready, the day's questions left on show or not.
# `soli test` runs no worker: the test plays the job's part on the server.

const PROGRESS_PASSWORD = "correct horse battery"
const PROGRESS_SOURCE = "\\header { title = \"Fugue\" }\n\\new Staff { \\time 4/4 c'1 | d'1 }\n"

# Waits (`seconds` at most) for a JavaScript condition to hold.
def progress_wait(condition, seconds = 15)
  tries = 0
  check = "(() => { try { return Boolean(#{condition}); } catch (e) { return false; } })()"
  while tries < seconds * 5 && evaluate(check) != true
    sleep(0.2)
    tries = tries + 1
  end
  said = evaluate("[...document.querySelectorAll('[data-ai-status],[data-ai-error]')]"
  + ".map((e) => e.hidden + ':' + e.textContent).join(' / ')")
  assert(tries < seconds * 5, "waited for: #{condition} (the dialog says: #{said})")
end

# Signs up and in, with an AI key of one's own, and opens a score.
def progress_open
  email = "ai-progress-#{uuid_v4}@example.com"
  visit("/signup")
  fill_in("#email", email)
  fill_in("#password", PROGRESS_PASSWORD)
  # The form refuses what is sent back within two seconds of being shown.
  sleep(2.2)
  click("form.auth-form button[type=submit]")
  wait_for_text("Check your inbox")
  user = User.find_by("email", email)
  visit("/confirm_email?token=#{user.start_email_confirmation}")
  sleep(0.5)
  unless page_text().contains("Your email address is confirmed")
    again = User.find_by("email", email).start_email_confirmation
    visit("/confirm_email?token=#{again}")
  end
  wait_for_text("Your email address is confirmed")
  user = User.find_by("email", email)
  user.keep_ai_key("anthropic", "claude-opus-5-5", "sk-ant-1111")
  login(email, PROGRESS_PASSWORD)
  # In English, whatever language a test before left in the cookie.
  set_request_cookie("locale", "en")
  score = Score.start(user, PROGRESS_SOURCE)
  visit("/app/scores/#{score._key}")
  wait_for_text("Your changes save themselves")
  {"user": user, "score": score}
end

# Asks the dialog `question`; answers the suggestion it follows. The
# browser test server runs jobs, and a job would ask the provider with the
# test's key: the suggestion is made here instead, with no job, and the
# page's POST answered with it. Everything the page asks after is real.
def progress_ask(user, score, question)
  suggestion = ScoreSuggestion.create({
    "user_id": user._key,
    "score_id": score._key,
    "action": "ask",
    "request": question,
    "original": score.source,
    "state": "working",
    "created_at": DateTime.utc.to_unix
  })
  evaluate("(() => { const real = window.fetch; window.fetch = (url, options) => "
  + "options?.method === 'POST' && String(url).endsWith('/suggestions') "
  + "? Promise.resolve(new Response(JSON.stringify({ id: '#{suggestion._key}', state: 'working' }), { status: 202 })) "
  + ": real(url, options); })()")
  evaluate("document.querySelector('[data-ai-ask=ask]').click()")
  progress_wait("document.querySelector('[data-ai]').open")
  fill_in("[data-ai-request]", question)
  click("[data-ai-send]")
  progress_wait("!document.querySelector('[data-ai-status]').hidden")
  suggestion
end

def progress_status
  evaluate("document.querySelector('[data-ai-status]').textContent")
end

describe("The AI dialog, while the AI works") do
  test("says how the question goes, shows the score as it is written, then the answer") do
    opened = progress_open
    # The day's questions on show: the counter must not end the waiting (#973).
    assert(evaluate("Boolean(document.querySelector('[data-ai-left]'))"), "the counter is shown")
    suggestion = progress_ask(
      opened["user"],
      opened["score"],
      "write a complete fugue for organ in the style of Bach"
    )
    assert(!suggestion.nil?, "a suggestion was started")
    progress_wait("document.querySelector('[data-ai-status]').textContent.includes('Waiting for the AI')")

    # Past the first three seconds, still followed: the time goes on.
    suggestion.progressed("thinking", "", 4200)
    progress_wait("document.querySelector('[data-ai-status]').textContent.includes('4,200 characters of reasoning')")
    first = progress_status
    sleep(2.2)
    assert(progress_status != first, "the time goes on between two answers: #{first}")

    # Writing: the bars written so far, engraved, under the status.
    suggestion.progressed("writing", "A fugue.\n\n```lilypond\n\\relative c' { c4 d e f | g a b c |", 4200)
    progress_wait("document.querySelector('[data-ai-status]').textContent.includes('writing the score')")
    progress_wait("document.querySelector('[data-ai-draft] svg') && !document.querySelector('[data-ai-draft]').hidden")

    # Ready: the answer replaces the draft, ready to apply.
    done = ScoreSuggestion.find(suggestion._key)
    done.state = "done"
    done.source = "\\new Staff { c'1 | d'1 | e'1 }"
    done.explanation = "A three-voice fugue."
    done.save
    progress_wait("!document.querySelector('[data-ai-result]').hidden")
    assert_contains(evaluate("document.querySelector('[data-ai-explanation]').textContent"), "A three-voice fugue.")
    assert_eq(evaluate("document.querySelector('[data-ai-draft]').hidden"), true)
    assert_eq(evaluate("document.querySelector('[data-ai-status]').hidden"), true)
    assert_eq(evaluate("document.querySelector('[data-ai-apply]').hidden"), false)
  end

  test("says why, and stops the clock, when the question fails") do
    opened = progress_open
    suggestion = progress_ask(opened["user"], opened["score"], "add a coda")
    suggestion.progressed("thinking", "", 10)
    progress_wait("document.querySelector('[data-ai-status]').textContent.includes('reasoning')")
    failed = ScoreSuggestion.find(suggestion._key)
    failed.state = "failed"
    failed.error = "Anthropic stopped answering. Try again in a moment."
    failed.save
    progress_wait("!document.querySelector('[data-ai-error]').hidden")
    assert_contains(evaluate("document.querySelector('[data-ai-error]').textContent"), "stopped answering")
    assert_eq(evaluate("document.querySelector('[data-ai-status]').hidden"), true)
    assert_eq(evaluate("document.querySelector('[data-ai-send]').disabled"), false)
  end

  test("finds the last question's answer again, after the page was closed (#975)") do
    opened = progress_open
    # No question yet on this score: nothing offered.
    evaluate("document.querySelector('[data-ai-ask=ask]').click()")
    progress_wait("document.querySelector('[data-ai]').open")
    assert_eq(evaluate("document.querySelector('[data-ai-last]').hidden"), true)
    # Asked, then answered while no page followed it.
    ScoreSuggestion.create({
      "user_id": opened["user"]._key,
      "score_id": opened["score"]._key,
      "action": "ask",
      "request": "write a complete fugue for organ in the style of Bach",
      "original": opened["score"].source,
      "state": "done",
      "source": "\\new Staff { c'1 | g'1 | c''1 }",
      "explanation": "The fugue, at last.",
      "created_at": DateTime.utc.to_unix - 1800
    })
    visit("/app/scores/#{opened["score"]._key}")
    wait_for_text("Your changes save themselves")
    evaluate("document.querySelector('[data-ai-ask=ask]').click()")
    progress_wait("!document.querySelector('[data-ai-last]').hidden")
    assert_contains(evaluate("document.querySelector('[data-ai-last]').textContent"), "Your last question")
    assert_contains(evaluate("document.querySelector('[data-ai-last]').textContent"), "write a complete fugue")
    click("[data-ai-last-show]")
    progress_wait("!document.querySelector('[data-ai-result]').hidden")
    assert_contains(evaluate("document.querySelector('[data-ai-explanation]').textContent"), "The fugue, at last.")
    assert_eq(evaluate("document.querySelector('[data-ai-apply]').hidden"), false)
    assert_eq(evaluate("document.querySelector('[data-ai-last]').hidden"), true)
    # Applied: the score is the answer.
    click("[data-ai-apply]")
    progress_wait("!document.querySelector('[data-ai]').open")
    tries = 0
    while tries < 50 && !Score.find(opened["score"]._key).source.contains("c''1")
      sleep(0.2)
      tries = tries + 1
    end
    assert_contains(Score.find(opened["score"]._key).source, "c''1", "the answer saved as the score")
  end
end
