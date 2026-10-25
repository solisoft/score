# The editor's AI assistant over HTTP: asked from the editor, asked after,
# each suggestion its owner's, only on a score one may change, and only on
# the person's own AI key (#396), the server's never.

const SUGGEST_PASSWORD = "correct horse battery"
const SUGGEST_SOURCE = "{ c'4 d' e' f' | g'1 }"

# Someone signed in, with a key of their own unless `keyless`.
def suggest_user(keyless = false)
  user = User.new()
  user.email = "suggest-#{uuid_v4}@example.com"
  user.set_password(SUGGEST_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user.keep_ai_key("mistral", "mistral-medium-latest", "sk-mistral-1111") unless keyless
  post(
    "/login",
    {"email": user.email, "password": SUGGEST_PASSWORD}
  )
  User.find(user._key)
end

def ask_assistant(score, body)
  set_header("Content-Type", "application/json")
  response = post("/app/scores/#{score._key}/suggestions", JSON.stringify(body))
  clear_headers()
  response
end

def suggestions_of(user)
  ScoreSuggestion.where({"user_id": user._key}).count
end

# `count` suggestions `user` asked of `score` already, at `at`.
def past_suggestions(user, score, count, at = nil)
  asked_at = at ?? DateTime.utc.to_unix
  rows = (0 .. count).map do |_|
    {
      "user_id": user._key,
      "score_id": score._key,
      "action": "improve",
      "state": "done",
      "created_at": asked_at
    }
  end
  ScoreSuggestion.create_many(rows) if count > 0
end

# The assistant's jobs waiting in the queue (`soli test` runs no worker).
def queued_suggestion_jobs
  Job.list().filter do |job|
    str(job["handler"]).contains("ScoreSuggestion")
  end.length
end

describe("AppScoreSuggestionsController") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  test("the editor offers the AI menu and the photo, and says which AI answers") do
    user = suggest_user()
    score = Score.start(user, SUGGEST_SOURCE)
    page = res_body(get("/app/scores/#{score._key}"))
    assert_contains(page, "<summary class=\"studio-menu\">AI</summary>")
    assert_contains(page, "data-ai-ask=\"harmonize\"")
    assert_contains(
      page,
      "Answered by Mistral, mistral-medium-latest, with your key. "
      + "<span data-ai-left>#{SCORE_SUGGESTIONS_OWN_PER_DAY}</span> questions left today."
    )
    assert_contains(page, "data-photo-open hidden")
    # The page's script names both hooks: the elements are what must not carry them.
    assert_contains(page, "data-ai aria-labelledby=\"studio-ai-title\">")
    assert_not(page.contains("data-photo-refused>"))
  end

  test("without a key, the editor's photo and assistant explain and link the way to one, before anything is sent") do
    assert(getenv("ANTHROPIC_API_KEY").present?, "the server's key is set, and still not offered")
    user = suggest_user(true)
    score = Score.start(user, SUGGEST_SOURCE)
    page = res_body(get("/app/scores/#{score._key}"))
    # The menus stay, their hooks too; the dialog says why and sends nothing.
    assert_contains(page, "data-ai-ask=\"chords\"")
    assert_contains(page, "data-ai-refused")
    assert_contains(
      page,
      "Add your own AI key in Account to read photos and use the assistant. "
      + "<a href=\"/app/account#ai\">Add your key in Account</a></p>"
    )
    assert_not(page.contains("data-ai-left"))
    assert_not(page.contains("Answered by Claude"))
    # File › Open a photo… links to the account instead of taking a file.
    assert_contains(page, "href=\"/app/account#ai\" data-photo-refused>Open a photo…")
    assert_not(page.contains("data-photo-open hidden"))
  end

  test("starts a suggestion from the editor's text, leaving the score as it is") do
    user = suggest_user()
    score = Score.start(user, SUGGEST_SOURCE)
    response = ask_assistant(
      score,
      {
        "action": "harmonize",
        "request": "for SATB",
        "source": "{ a'2 b' }"
      }
    )
    assert_eq(res_status(response), 202)
    stored = ScoreSuggestion.find(res_json(response)["id"])
    assert_eq(stored.action, "harmonize")
    assert_eq(stored.request, "for SATB")
    assert_eq(stored.original, "{ a'2 b' }")
    assert_eq(stored.user_id, user._key)
    assert_eq(Score.find(score._key).source, SUGGEST_SOURCE)
    assert_eq(res_json(get("/app/suggestions/#{stored._key}")), {"state": "working"})
    # Without text from the editor, the score as saved.
    saved = ask_assistant(score, {"action": "chords"})
    assert_eq(ScoreSuggestion.find(res_json(saved)["id"]).original, SUGGEST_SOURCE)
  end

  test("refuses an unknown action, an empty request, a score too long, and starts nothing") do
    user = suggest_user()
    score = Score.start(user, SUGGEST_SOURCE)
    unknown = ask_assistant(score, {"action": "compose"})
    assert_eq(res_status(unknown), 422)
    assert_eq(res_json(unknown)["error"], "Choose what to ask.")
    empty = ask_assistant(
      score,
      {"action": "ask", "request": "   "}
    )
    assert_eq(res_status(empty), 422)
    assert_eq(res_json(empty)["error"], "Write what you would like done.")
    long = ask_assistant(
      score,
      {"action": "improve", "source": "c" * (SCORE_ASSISTANT_SOURCE_LIMIT + 1)}
    )
    assert_eq(res_status(long), 422)
    assert_eq(suggestions_of(user), 0)
  end

  test("one's own key: the 200th question of the day goes, the 201st is refused, nothing written or queued") do
    user = suggest_user()
    score = Score.start(user, SUGGEST_SOURCE)
    assert_eq(SCORE_SUGGESTIONS_OWN_PER_DAY, 200)
    past_suggestions(user, score, SCORE_SUGGESTIONS_OWN_PER_DAY - 1)
    # An older one no longer counts.
    past_suggestions(user, score, 1, DateTime.utc.to_unix - 86400 - 60)
    assert_contains(res_body(get("/app/scores/#{score._key}")), "<span data-ai-left>1</span> questions left today.")
    jobs_before = queued_suggestion_jobs()
    last = ask_assistant(score, {"action": "chords"})
    assert_eq(res_status(last), 202)
    assert_eq(queued_suggestion_jobs(), jobs_before + 1)
    assert_eq(suggestions_of(user), SCORE_SUGGESTIONS_OWN_PER_DAY + 1)
    assert_contains(res_body(get("/app/scores/#{score._key}")), "<span data-ai-left>0</span> questions left today.")
    refused = ask_assistant(
      score,
      {"action": "ask", "request": "a coda"}
    )
    assert_eq(res_status(refused), 429)
    assert_eq(res_json(refused)["error"], "You have asked all of today's questions: try again tomorrow.")
    assert_null(res_json(refused)["link"])
    assert_eq(suggestions_of(user), SCORE_SUGGESTIONS_OWN_PER_DAY + 1)
    assert_eq(queued_suggestion_jobs(), jobs_before + 1)
  end

  test("refuses a request longer than the limit, and writes nothing") do
    user = suggest_user()
    score = Score.start(user, SUGGEST_SOURCE)
    assert_eq(SCORE_SUGGESTION_REQUEST_LIMIT, 2000)
    assert_contains(res_body(get("/app/scores/#{score._key}")), "maxlength=\"2000\"")
    long = ask_assistant(
      score,
      {"action": "ask", "request": "a" * (SCORE_SUGGESTION_REQUEST_LIMIT + 1)}
    )
    assert_eq(res_status(long), 422)
    assert_eq(res_json(long)["error"], "Your request is too long: keep it under 2000 characters.")
    assert_eq(suggestions_of(user), 0)
    longest = ask_assistant(
      score,
      {"action": "ask", "request": "a" * SCORE_SUGGESTION_REQUEST_LIMIT}
    )
    assert_eq(res_status(longest), 202)
  end

  test("without a key of one's own: refused with the way to Account, nothing written or queued") do
    assert(getenv("ANTHROPIC_API_KEY").present?, "the server's key is set, and still not used")
    user = suggest_user(true)
    score = Score.start(user, SUGGEST_SOURCE)
    jobs_before = queued_suggestion_jobs()
    refused = ask_assistant(score, {"action": "chords"})
    assert_eq(res_status(refused), 403)
    assert_eq(
      res_json(refused),
      {
        "error": "Add your own AI key in Account to read photos and use the assistant.",
        "link": "/app/account#ai",
        "link_text": "Add your key in Account"
      }
    )
    assert_eq(suggestions_of(user), 0)
    assert_eq(queued_suggestion_jobs(), jobs_before)
    # A key added: answered.
    user.keep_ai_key("mistral", "mistral-medium-latest", "sk-mistral-1111")
    assert_eq(res_status(ask_assistant(score, {"action": "chords"})), 202)
    assert_eq(suggestions_of(user), 1)
  end

  test("answers the suggestion once ready, engraved, with its explanation; or why it failed") do
    user = suggest_user()
    done = ScoreSuggestion.create({
      "user_id": user._key,
      "score_id": "s",
      "action": "chords",
      "state": "done",
      "source": "{ c'4 d' e' f' }",
      "explanation": "C major, then G.",
      "created_at": DateTime.utc.to_unix
    })
    answer = res_json(get("/app/suggestions/#{done._key}"))
    assert_eq(answer["state"], "done")
    assert_eq(answer["source"], "{ c'4 d' e' f' }")
    assert_eq(answer["explanation"], "C major, then G.")
    assert_contains(answer["svg"], "<svg")
    failed = ScoreSuggestion.create({
      "user_id": user._key,
      "score_id": "s",
      "action": "ask",
      "state": "failed",
      "error": "Mistral is busy. Try again in a moment.",
      "created_at": DateTime.utc.to_unix
    })
    assert_eq(
      res_json(get("/app/suggestions/#{failed._key}")),
      {"state": "failed", "error": "Mistral is busy. Try again in a moment."}
    )
  end

  test("keeps a score and its suggestions to their owner") do
    owner = suggest_user()
    score = Score.start(owner, SUGGEST_SOURCE)
    mine = ScoreSuggestion.start(owner, score, "chords", "", SUGGEST_SOURCE)
    clear_cookies()
    stranger = suggest_user()
    assert_ne(res_status(ask_assistant(score, {"action": "chords"})), 202)
    assert_eq(suggestions_of(stranger), 0)
    assert_eq(res_status(get("/app/suggestions/#{mine._key}")), 404)
    assert_eq(res_status(get("/app/suggestions/no-such-suggestion")), 404)
  end

  test("sends a guest to sign in") do
    assert_eq(res_status(post("/app/scores/x/suggestions", {"action": "chords"})), 401)
    assert_eq(res_status(get("/app/suggestions/x")), 302)
  end
end
