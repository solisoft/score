# Reading a photo of a score from the Start page: sent, asked after, its
# owner's only; and only on the person's own AI key (#396), the server's
# never, whatever its environment holds.

const READING_PASSWORD = "correct horse battery"
const SMALL_PNG = "iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAAAAADaLSBnAAAAFUlEQVR42mP4TyRgGFU4qnBUIQgAAIy4"
+ "HQ6Y693OAAAAAElFTkSuQmCC"

# Someone signed in, with a key of their own unless `keyless`.
def reading_user(keyless = false)
  user = User.new()
  user.email = "photo-#{uuid_v4}@example.com"
  user.set_password(READING_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user.keep_ai_key("mistral", "pixtral-large-latest", "sk-mistral-2222") unless keyless
  post(
    "/login",
    {"email": user.email, "password": READING_PASSWORD}
  )
  User.find(user._key)
end

def send_picture(picture)
  set_header("Content-Type", "application/json")
  response = post("/app/readings", JSON.stringify({"picture": picture}))
  clear_headers()
  response
end

def readings_of(user)
  ScoreReading.where({"user_id": user._key}).count
end

# The reading jobs waiting in the queue (`soli test` runs no worker).
def queued_reading_jobs
  Job.list().filter do |job|
    str(job["handler"]).contains("ScoreReading")
  end.length
end

# `count` readings `user` started in the last day.
def past_readings(user, count)
  rows = (0 .. count).map do |_|
    {
      "user_id": user._key,
      "state": "done",
      "created_at": DateTime.utc.to_unix
    }
  end
  ScoreReading.create_many(rows) if count > 0
end

describe("AppScoreReadingsController") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  test("the Start page offers it with one's own key, with the day's readings left") do
    reading_user()
    page = res_body(get("/app"))
    assert_contains(page, "From a photo")
    assert_contains(page, "read by Mistral, pixtral-large-latest")
    assert_contains(page, "<span data-photos-left>#{SCORE_READINGS_OWN_PER_DAY}</span> left today")
    assert_contains(page, "data-photo hidden>")
  end

  test("without a key, the Start page links the way to one before any photo is chosen") do
    assert(getenv("ANTHROPIC_API_KEY").present?, "the server's key is set, and still not offered")
    reading_user(true)
    page = res_body(get("/app"))
    assert_contains(page, "data-photos-refused")
    assert_contains(page, "the site has no AI of its own")
    assert_contains(page, "href=\"/app/account#ai\">Add an AI key</a>")
    assert_not(page.contains("data-photo hidden"), "no photo to choose")
    assert_not(page.contains("read by Claude"))
  end

  test("starts a reading of a picture, shrunk to a JPEG, kept for the job") do
    user = reading_user()
    jobs_before = queued_reading_jobs()
    response = send_picture(SMALL_PNG)
    assert_eq(res_status(response), 202)
    answer = res_json(response)
    assert_eq(answer["state"], "reading")
    stored = ScoreReading.find(answer["id"])
    assert_eq(stored.user_id, user._key)
    assert(stored.picture.starts_with?("/9j/"), "re-encoded as JPEG")
    assert_eq(queued_reading_jobs(), jobs_before + 1)
    queued = res_json(get("/app/readings/#{answer["id"]}"))
    assert_eq([queued["state"], queued["phase"], queued["draft"]], [
      "reading",
      "waiting",
      ""
    ])
    assert(queued["seconds"] <= 2, "just started: #{queued["seconds"]}")
  end

  test("without a key of one's own: refused with the way to Account, nothing kept or queued") do
    assert(getenv("ANTHROPIC_API_KEY").present?, "the server's key is set, and still not used")
    user = reading_user(true)
    jobs_before = queued_reading_jobs()
    refused = send_picture(SMALL_PNG)
    assert_eq(res_status(refused), 403)
    assert_eq(
      res_json(refused),
      {
        "error": "Add your own AI key in Account to read photos and use the assistant.",
        "link": "/app/account#ai",
        "link_text": "Add your key in Account"
      }
    )
    assert_eq(readings_of(user), 0)
    assert_eq(queued_reading_jobs(), jobs_before)
    # Refused before the picture is even looked at.
    assert_eq(res_status(send_picture("")), 403)
  end

  test("refuses no picture, or what is not one, and starts nothing") do
    user = reading_user()
    missing = send_picture("")
    assert_eq(res_status(missing), 422)
    assert_contains(res_json(missing)["error"], "Choose a photo")
    wrong = send_picture(Base64.encode("plain text"))
    assert_eq(res_status(wrong), 422)
    assert_contains(res_json(wrong)["error"], "not a picture")
    huge = send_picture("A" * (SCORE_READER_BYTES + 1))
    assert_eq(res_status(huge), 422)
    assert_eq(readings_of(user), 0)
  end

  test("one's own key: the 200th photo of the day is read, the 201st refused, nothing kept") do
    user = reading_user()
    assert_eq(SCORE_READINGS_OWN_PER_DAY, 200)
    past_readings(user, SCORE_READINGS_OWN_PER_DAY - 1)
    last = send_picture(SMALL_PNG)
    assert_eq(res_status(last), 202)
    jobs_before = queued_reading_jobs()
    refused = send_picture(SMALL_PNG)
    assert_eq(res_status(refused), 429)
    assert_eq(res_json(refused)["error"], "You have read all of today's photos: try again tomorrow.")
    assert_null(res_json(refused)["link"])
    assert_eq(readings_of(user), SCORE_READINGS_OWN_PER_DAY)
    assert_eq(queued_reading_jobs(), jobs_before)
    assert_contains(res_body(get("/app")), "data-photo hidden disabled")
  end

  test("answers the music once read, engraved") do
    user = reading_user()
    reading = ScoreReading.create({
      "user_id": user._key,
      "state": "done",
      "source": "{ c'4 d' e' f' }",
      "created_at": DateTime.utc.to_unix
    })
    answer = res_json(get("/app/readings/#{reading._key}"))
    assert_eq(answer["state"], "done")
    assert_eq(answer["source"], "{ c'4 d' e' f' }")
    assert_contains(answer["svg"], "<svg")
  end

  test("answers how a reading is going: its phase, the LilyPond so far, the seconds since it started (#435)") do
    user = reading_user()
    reading = ScoreReading.create({
      "user_id": user._key,
      "state": "reading",
      "picture": "base64-jpeg",
      "created_at": DateTime.utc.to_unix - 90
    })
    waiting = res_json(get("/app/readings/#{reading._key}"))
    assert_eq([waiting["state"], waiting["phase"], waiting["draft"]], [
      "reading",
      "waiting",
      ""
    ])
    assert(waiting["seconds"] >= 90 && waiting["seconds"] < 100, "seconds: #{waiting["seconds"]}")
    ScoreReading.find(reading._key).progressed("thinking", "")
    assert_eq(res_json(get("/app/readings/#{reading._key}"))["phase"], "thinking")
    ScoreReading.find(reading._key).progressed("writing", "{ c'4 d'")
    going = res_json(get("/app/readings/#{reading._key}"))
    assert_eq([going["phase"], going["draft"]], ["writing", "{ c'4 d'"])
    assert_not_null(ScoreReading.find(reading._key).progressed_at)
    assert_null(going["source"], "no source before it is done")
  end

  test("its events are its owner's, and an unknown one is 404 (#435)") do
    owner = reading_user()
    reading = ScoreReading.create({
      "user_id": owner._key,
      "state": "reading",
      "created_at": DateTime.utc.to_unix
    })
    clear_cookies()
    reading_user()
    assert_eq(res_status(get("/app/readings/#{reading._key}/events")), 404)
    assert_eq(res_status(get("/app/readings/no-such-reading/events")), 404)
  end

  test("answers why a reading failed") do
    user = reading_user()
    reading = ScoreReading.create({
      "user_id": user._key,
      "state": "failed",
      "error": "No music was found in the picture.",
      "created_at": DateTime.utc.to_unix
    })
    assert_eq(
      res_json(get("/app/readings/#{reading._key}")),
      {"state": "failed", "error": "No music was found in the picture."}
    )
  end

  test("keeps a reading to its owner, and an unknown one is 404") do
    owner = reading_user()
    reading = ScoreReading.create({
      "user_id": owner._key,
      "state": "done",
      "source": "{ c4 }",
      "created_at": DateTime.utc.to_unix
    })
    clear_cookies()
    reading_user()
    assert_eq(res_status(get("/app/readings/#{reading._key}")), 404)
    assert_eq(res_status(get("/app/readings/no-such-reading")), 404)
  end

  test("sends a guest to sign in") do
    assert_eq(res_status(send_picture(SMALL_PNG)), 401)
    assert_eq(ScoreReading.where({
      "state": "reading",
      "user_id": nil
    }).count, 0)
  end
end

describe("Photo imports (#465, #462)") do
  before_each() do
    as_guest()
    clear_headers()
    clear_cookies()
  end

  test("lists one's imports, the latest first, with how each stands; nobody else's") do
    user = reading_user()
    now = DateTime.utc.to_unix
    ScoreReading.create({
      "user_id": user._key,
      "state": "done",
      "source": "\\header { title = \"Read one\" }\n{ c'1 }\n",
      "created_at": now - 100
    })
    ScoreReading.create({
      "user_id": user._key,
      "state": "failed",
      "error": "The AI could not read it.",
      "created_at": now - 50
    })
    ScoreReading.create({
      "user_id": user._key,
      "state": "reading",
      "phase": "thinking",
      "created_at": now - 10,
      "progressed_at": now - 2
    })
    ScoreReading.create({
      "user_id": reading_user()._key,
      "state": "done",
      "source": "\\header { title = \"Not yours\" }\n{ c'1 }\n",
      "created_at": now
    })
    post(
      "/login",
      {"email": user.email, "password": READING_PASSWORD}
    )
    page = res_body(get("/app/imports"))
    assert_contains(page, "Read one")
    assert_contains(page, "The AI could not read it.")
    assert_contains(page, "being read")
    assert_not(page.contains("Not yours"))
    assert(page.index_of("being read") < page.index_of("Read one"), "the latest first")
    start = res_body(get("/app"))
    assert_contains(start, "data-imports-going", "the Start page points to the one going on")
  end

  test("an import's page: the photo and the score read, opened as a score; read again") do
    user = reading_user()
    reading = ScoreReading.create({
      "user_id": user._key,
      "state": "done",
      "picture": SMALL_PNG,
      "source": "\\header { title = \"Little\" }\n{ c'4 d' e' f' }\n",
      "created_at": DateTime.utc.to_unix
    })
    page = res_body(get("/app/imports/#{reading._key}"))
    assert_contains(page, "data:image/jpeg;base64,")
    assert_contains(page, "<svg")
    assert_contains(page, "Open as a score")
    count_before = Score.where({"user_id": user._key}).count
    opened = post("/app/imports/#{reading._key}/score", {})
    assert_eq(Score.where({"user_id": user._key}).count, count_before + 1)
    score = Score.where({"user_id": user._key}).order("created_at", "desc").first
    assert_eq(res_location(opened), "/app/scores/#{score._key}")
    assert_eq(score.title, "Little")
    readings_before = readings_of(user)
    again = post("/app/imports/#{reading._key}/retry", {})
    assert_eq(readings_of(user), readings_before + 1)
    fresh = ScoreReading.where({
      "user_id": user._key,
      "state": "reading"
    }).first
    assert_eq(res_location(again), "/app/imports/#{fresh._key}")
    assert_eq(fresh.picture, SMALL_PNG, "the same photo")
  end

  test("a reading being written: its music so far engraved, for the page that follows it") do
    user = reading_user()
    reading = ScoreReading.create({
      "user_id": user._key,
      "state": "reading",
      "phase": "writing",
      "draft": "\\new Staff { \\time 3/4 c'4 d' e' | f'2. | g'4",
      "created_at": DateTime.utc.to_unix,
      "progressed_at": DateTime.utc.to_unix
    })
    page = get("/app/imports/#{reading._key}")
    assert_eq(res_status(page), 200, "its page, while nothing is read yet")
    assert_contains(res_body(page), "Being read")
    followed = res_json(get("/app/readings/#{reading._key}?svg=1"))
    assert_eq(followed["state"], "reading")
    assert_contains(followed["draft_svg"], "<svg")
    assert_null(res_json(get("/app/readings/#{reading._key}"))["draft_svg"], "only asked for")
  end

  test("refused: another's import, an unknown one, opening one not read, reading again without the photo; a guest") do
    owner = reading_user()
    theirs = ScoreReading.create({
      "user_id": owner._key,
      "state": "done",
      "source": "{ c'1 }",
      "created_at": DateTime.utc.to_unix
    })
    pending = ScoreReading.create({
      "user_id": owner._key,
      "state": "failed",
      "error": "x",
      "created_at": DateTime.utc.to_unix
    })
    reading_user()
    assert_eq(res_status(get("/app/imports/#{theirs._key}")), 404)
    assert_eq(res_status(post("/app/imports/#{theirs._key}/score", {})), 404)
    assert_eq(res_status(get("/app/imports/no-such")), 404)
    post(
      "/login",
      {"email": owner.email, "password": READING_PASSWORD}
    )
    count_before = Score.where({"user_id": owner._key}).count
    assert_eq(res_status(post("/app/imports/#{pending._key}/score", {})), 422, "not read: nothing to open")
    assert_eq(res_status(post("/app/imports/#{pending._key}/retry", {})), 422, "no photo kept")
    assert_eq(Score.where({"user_id": owner._key}).count, count_before)
    as_guest()
    clear_cookies()
    assert_ne(res_status(get("/app/imports")), 200)
  end
end

describe("An AI key of one's own, on the account page") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  test("offers the providers, and keeps a key encrypted, shown by its end") do
    user = reading_user(true)
    page = res_body(get("/app/account"))
    # The key serves photos and the editor's assistant: the page says both.
    assert_contains(page, "<h2 id=\"ai-title\">AI for photos and the assistant</h2>")
    assert_contains(page, "the editor's assistant")
    assert_not(page.contains("AI for reading photos"))
    # Whose AI it is, and who pays for it.
    assert_contains(page, "The AI runs on your own key: the site has no AI of its own.")
    assert_contains(page, "that provider bills you for them.")
    assert_contains(page, "Without one, there is no AI.")
    # Payments not open: no plan stands in the way.
    assert_not(page.contains("data-ai-plan"))
    providers = ["Anthropic (Claude)", "OpenAI (GPT)", "Google (Gemini)", "Mistral", "DeepSeek", "Moonshot (Kimi)"]
    (providers + ["OpenRouter"]).each do |name|
      assert_contains(page, name)
    end
    response = post(
      "/app/account/ai",
      {
        "provider": "openai",
        "model": "gpt-5",
        "key": "sk-proj-abcdefgh4321"
      }
    )
    assert_eq(res_location(response), "/app/account")
    stored = User.find(user._key)
    assert_eq(stored.ai_provider, "openai")
    assert_ne(stored.ai_key, "sk-proj-abcdefgh4321")
    page = res_body(get("/app/account"))
    assert_contains(page, "<strong>OpenAI (GPT)</strong>")
    assert_contains(page, "…4321")
    assert_not(page.includes?("sk-proj-abcdefgh4321"), "the key is never shown again")
    start = res_body(get("/app"))
    assert_contains(start, "read by OpenAI (GPT), gpt-5")
    assert_contains(start, "<span data-photos-left>#{SCORE_READINGS_OWN_PER_DAY}</span> left today")
  end

  test("once payments open, Free is told AI with one's own key is Pro's; the key stays, unused") do
    free = reading_user()
    assert_eq(
      free.ai_plan_note(true),
      "AI with your own key is part of Pro. Your key stays kept, unused, until then; you can remove it."
    )
    assert_null(free.ai_plan_note(false))
    keyless = reading_user(true)
    assert_eq(keyless.ai_plan_note(true), "AI with your own key is part of Pro.")
    pro = reading_user()
    pro.plan = "pro"
    pro.plan_status = "active"
    pro.current_period_end = DateTime.utc.to_unix + 86400
    pro.update()
    assert_null(User.find(pro._key).ai_plan_note(true))
  end

  test("refuses an unknown provider or a missing key, and keeps nothing") do
    user = reading_user(true)
    response = post(
      "/app/account/ai",
      {
        "provider": "skynet",
        "model": "t-800",
        "key": "sk-123456789"
      }
    )
    assert_eq(res_status(response), 422)
    assert_contains(res_body(response), "Choose a provider.")
    response = post(
      "/app/account/ai",
      {
        "provider": "openai",
        "model": "gpt-5",
        "key": ""
      }
    )
    assert_eq(res_status(response), 422)
    assert_contains(res_body(response), "Paste the API key.")
    assert_not(User.find(user._key).own_ai?)
  end

  test("removes the key: no AI until another one, not the site's") do
    user = reading_user()
    assert(User.find(user._key).own_ai?)
    assert_eq(res_location(post("/app/account/ai/remove", {})), "/app/account")
    assert_not(User.find(user._key).own_ai?)
    start = res_body(get("/app"))
    assert_contains(start, "Add an AI key")
    assert_not(start.contains("read by Claude"))
    assert_eq(res_status(send_picture(SMALL_PNG)), 403)
  end

  test("a guest cannot keep one") do
    assert_eq(res_status(post(
      "/app/account/ai",
      {
        "provider": "openai",
        "model": "gpt-5",
        "key": "sk-123456789"
      }
    )), 401)
  end
end
