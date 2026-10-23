# Reading a photo of a score from the Start page: sent, asked after, its
# owner's only.

const READING_PASSWORD = "correct horse battery"
const SMALL_PNG = "iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAAAAADaLSBnAAAAFUlEQVR42mP4TyRgGFU4qnBUIQgAAIy4"
+ "HQ6Y693OAAAAAElFTkSuQmCC"

def reading_user
  user = User.new()
  user.email = "photo-#{uuid_v4}@example.com"
  user.set_password(READING_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  post(
    "/login",
    {"email": user.email, "password": READING_PASSWORD}
  )
  user
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

describe("AppScoreReadingsController") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  test("the Start page offers it, with the day's readings left") do
    reading_user()
    page = res_body(get("/app"))
    assert_contains(page, "From a photo")
    assert_contains(page, "<span data-photos-left>#{SCORE_READINGS_PER_DAY}</span> left today")
  end

  test("starts a reading of a picture, shrunk to a JPEG, kept for the job") do
    user = reading_user()
    response = send_picture(SMALL_PNG)
    assert_eq(res_status(response), 202)
    answer = res_json(response)
    assert_eq(answer["state"], "reading")
    stored = ScoreReading.find(answer["id"])
    assert_eq(stored.user_id, user._key)
    assert(stored.picture.starts_with?("/9j/"), "re-encoded as JPEG")
    assert_eq(res_json(get("/app/readings/#{answer["id"]}")), {"state": "reading"})
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

  test("refuses past the day's readings") do
    user = reading_user()
    (0 .. SCORE_READINGS_PER_DAY).each do |_|
      ScoreReading.create({
        "user_id": user._key,
        "state": "done",
        "created_at": DateTime.utc.to_unix
      })
    end
    response = send_picture(SMALL_PNG)
    assert_eq(res_status(response), 429)
    assert_contains(res_json(response)["error"], "try again tomorrow")
    assert_eq(readings_of(user), SCORE_READINGS_PER_DAY)
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
    assert_eq(res_status(send_picture(SMALL_PNG)), 302)
    assert_eq(ScoreReading.where({
      "state": "reading",
      "user_id": nil
    }).count, 0)
  end
end
