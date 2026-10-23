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

# Whose suggestions fill the server key's day in a spec: theirs go after it.
const SITE_BUSY_ASKER = "site-busy-suggestions-spec"

# The day's AI_SERVER_ASKS_PER_DAY asked of the server's key, by someone else.
def fill_site_day
  rows = (0 .. AI_SERVER_ASKS_PER_DAY).map do |_|
    {
      "user_id": SITE_BUSY_ASKER,
      "score_id": "s",
      "action": "improve",
      "state": "done",
      "own": false,
      "created_at": DateTime.utc.to_unix
    }
  end
  ScoreSuggestion.create_many(rows)
end

# `user`'s session cookie ("name=value"), signed in anew.
def suggest_session_cookie(user)
  signed_in = post(
    "/login",
    {"email": user.email, "password": SUGGEST_PASSWORD}
  )
  res_header(signed_in, "Set-Cookie").to_s.split(";")[0]
end

# The address of this spec's own test server: the one that opens `score`'s
# editor to `cookie`. With several workers, `test_server_url()` names one of
# their servers, not necessarily this one's, so its neighbours are tried too.
def suggest_server_of(score, cookie)
  named = test_server_url()
  port = named.split(":").last.to_i
  candidates = [named] + (1 .. 40).map do |step|
    "http://127.0.0.1:#{port + step - 20}"
  end
  candidates.find do |base|
    answer = HTTP.request("GET", "#{base}/app/scores/#{score._key}", {
      "headers": {"Cookie": cookie},
      "timeout": 2
    }) rescue nil
    !answer.nil? && answer["status"] == 200 && answer["body"].to_s.contains(score.title)
  end
end

describe("AppScoreSuggestionsController") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  after_each() do
    ScoreSuggestion.where({"user_id": SITE_BUSY_ASKER}).delete_all
  end

  test("the editor offers the AI menu, and says which AI answers") do
    user = suggest_user()
    score = Score.start(user, SUGGEST_SOURCE)
    page = res_body(get("/app/scores/#{score._key}"))
    assert_contains(page, "<summary class=\"studio-menu\">AI</summary>")
    assert_contains(page, "data-ai-ask=\"harmonize\"")
    assert_contains(
      page,
      "Answered by Claude. <span data-ai-left>#{SCORE_SUGGESTIONS_PER_DAY}</span> questions left today."
    )
    user.keep_ai_key("mistral", "mistral-medium-latest", "sk-mistral-1111")
    assert_contains(
      res_body(get("/app/scores/#{score._key}")),
      "Answered by Mistral, mistral-medium-latest, with your key. "
      + "<span data-ai-left>#{SCORE_SUGGESTIONS_OWN_PER_DAY}</span> questions left today."
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

  test("on the site's AI: the 30th question goes, the 31st is refused, nothing written or queued") do
    user = suggest_user()
    score = Score.start(user, SUGGEST_SOURCE)
    assert_eq(SCORE_SUGGESTIONS_PER_DAY, 30)
    past_suggestions(user, score, SCORE_SUGGESTIONS_PER_DAY - 1)
    # An older one no longer counts.
    past_suggestions(user, score, 1, DateTime.utc.to_unix - 86400 - 60)
    assert_contains(res_body(get("/app/scores/#{score._key}")), "<span data-ai-left>1</span> questions left today.")
    jobs_before = queued_suggestion_jobs()
    last = ask_assistant(score, {"action": "chords"})
    assert_eq(res_status(last), 202)
    assert_eq(queued_suggestion_jobs(), jobs_before + 1)
    assert_eq(suggestions_of(user), SCORE_SUGGESTIONS_PER_DAY + 1)
    assert_contains(res_body(get("/app/scores/#{score._key}")), "<span data-ai-left>0</span> questions left today.")
    refused = ask_assistant(
      score,
      {"action": "ask", "request": "a coda"}
    )
    assert_eq(res_status(refused), 429)
    assert_eq(
      res_json(refused)["error"],
      "You have asked the 30 questions a day the site's AI answers: try again tomorrow, "
      + "or add your own AI key on your account page to ask more."
    )
    assert_eq(suggestions_of(user), SCORE_SUGGESTIONS_PER_DAY + 1)
    assert_eq(queued_suggestion_jobs(), jobs_before + 1)
  end

  test("with one's own key: past the site's 30, up to the own key's day") do
    user = suggest_user()
    score = Score.start(user, SUGGEST_SOURCE)
    user.keep_ai_key("mistral", "mistral-medium-latest", "sk-mistral-1111")
    past_suggestions(user, score, SCORE_SUGGESTIONS_PER_DAY)
    beyond = ask_assistant(score, {"action": "chords"})
    assert_eq(res_status(beyond), 202)
    assert_eq(suggestions_of(user), SCORE_SUGGESTIONS_PER_DAY + 1)
    past_suggestions(user, score, SCORE_SUGGESTIONS_OWN_PER_DAY - SCORE_SUGGESTIONS_PER_DAY - 1)
    jobs_before = queued_suggestion_jobs()
    refused = ask_assistant(score, {"action": "chords"})
    assert_eq(res_status(refused), 429)
    assert_eq(res_json(refused)["error"], "You have asked all of today's questions: try again tomorrow.")
    assert_eq(suggestions_of(user), SCORE_SUGGESTIONS_OWN_PER_DAY)
    assert_eq(queued_suggestion_jobs(), jobs_before)
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

  test("once the site's AI has answered its day, the server's key is refused; one's own key is not") do
    user = suggest_user()
    score = Score.start(user, SUGGEST_SOURCE)
    assert_eq(AI_SERVER_ASKS_PER_DAY, 400)
    fill_site_day()
    jobs_before = queued_suggestion_jobs()
    refused = ask_assistant(score, {"action": "chords"})
    assert_eq(res_status(refused), 429)
    assert_eq(
      res_json(refused)["error"],
      "The site's AI is busy for today: add your own key in Account to keep going."
    )
    assert_eq(suggestions_of(user), 0)
    assert_eq(queued_suggestion_jobs(), jobs_before)
    # Asked with one's own key: answered, and not counted against the site.
    site_used = AiClient.server_used_today
    assert(site_used >= AI_SERVER_ASKS_PER_DAY)
    user.keep_ai_key("mistral", "mistral-medium-latest", "sk-mistral-1111")
    own = ask_assistant(score, {"action": "chords"})
    assert_eq(res_status(own), 202)
    assert_eq(ScoreSuggestion.find(res_json(own)["id"]).own, true)
    assert_eq(AiClient.server_used_today, site_used)
  end

  test("two asked at once for the last question: one at most goes, never both") do
    user = suggest_user()
    score = Score.start(user, SUGGEST_SOURCE)
    past_suggestions(user, score, SCORE_SUGGESTIONS_PER_DAY - 1)
    cookie = suggest_session_cookie(user)
    assert(cookie.contains("="), "signed in")
    server = suggest_server_of(score, cookie)
    assert_not_null(server, "this spec's server, found")
    jobs_before = queued_suggestion_jobs()
    ask = {
      "method": "POST",
      "url": "#{server}/app/scores/#{score._key}/suggestions",
      "headers": {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Cookie": cookie
      },
      "body": JSON.stringify({"action": "chords"}),
      "timeout": 30
    }
    answers = HTTP.parallel([ask, ask])
    statuses = answers.map do |answer|
      answer["status"]
    end
    statuses.each do |status|
      assert([202, 429].includes?(status), "answered #{status}")
    end
    accepted = statuses.filter do |status|
      status == 202
    end.length
    assert(accepted <= 1, "both passed the last slot")
    assert_eq(suggestions_of(user), SCORE_SUGGESTIONS_PER_DAY - 1 + accepted)
    assert_eq(queued_suggestion_jobs(), jobs_before + accepted)
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
