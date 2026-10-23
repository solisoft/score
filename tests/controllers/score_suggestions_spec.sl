# The editor's AI assistant over HTTP: asked from the editor, asked after,
# each suggestion its owner's, and only on a score one may change.

const SUGGEST_PASSWORD = "correct horse battery"
const SUGGEST_SOURCE = "{ c'4 d' e' f' | g'1 }"

def suggest_user
  user = User.new()
  user.email = "suggest-#{uuid_v4}@example.com"
  user.set_password(SUGGEST_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  post(
    "/login",
    {"email": user.email, "password": SUGGEST_PASSWORD}
  )
  user
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

describe("AppScoreSuggestionsController") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  test("the editor offers the AI menu, and says which AI answers") do
    user = suggest_user()
    score = Score.start(user, SUGGEST_SOURCE)
    page = res_body(get("/app/scores/#{score._key}"))
    assert_contains(page, "<summary class=\"studio-menu\">AI</summary>")
    assert_contains(page, "data-ai-ask=\"harmonize\"")
    assert_contains(page, "Answered by Claude. #{SCORE_READINGS_PER_DAY} questions left today.")
    user.keep_ai_key("mistral", "mistral-medium-latest", "sk-mistral-1111")
    assert_contains(
      res_body(get("/app/scores/#{score._key}")),
      "Answered by Mistral, mistral-medium-latest, with your key. #{SCORE_READINGS_OWN_PER_DAY} questions left today."
    )
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

  test("refuses past the day's questions") do
    user = suggest_user()
    score = Score.start(user, SUGGEST_SOURCE)
    (0 .. SCORE_READINGS_PER_DAY).each do |_|
      ScoreSuggestion.create({
        "user_id": user._key,
        "score_id": score._key,
        "action": "improve",
        "state": "done",
        "created_at": DateTime.utc.to_unix
      })
    end
    response = ask_assistant(score, {"action": "chords"})
    assert_eq(res_status(response), 429)
    assert_contains(res_json(response)["error"], "try again tomorrow")
    assert_eq(suggestions_of(user), SCORE_READINGS_PER_DAY)
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
