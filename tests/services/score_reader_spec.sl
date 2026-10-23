# Reading a photo of a score: the picture sent, the conversation built, the
# answer read as a source, and a reading kept per person.

# A white PNG 3000 pixels wide: past the long edge Claude takes.
const WIDE_PNG = "iVBORw0KGgoAAAANSUhEUgAAC7gAAAAUCAAAAAA4py/KAAAAbklEQVR42u3WIQEAAADCMPqXhhqILcLV"
+ "UwAA4F4kAAAA4w4AABh3AAAw7gAAgHEHAACMOwAAGHcAAMC4AwAAxh0AAIw7AABg3AEAwLgDAADGHQAA"
+ "MO4AAGDcAQAA4w4AABh3AAAw7gAAgHEHAAAGoXmDSK5q5+0AAAAASUVORK5CYII="

def reader_user
  user = User.new()
  user.email = "reader-#{uuid_v4}@example.com"
  user.set_password("correct horse battery")
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

describe("ScoreReader") do
  describe("the picture") do
    test("is a JPEG no longer than the edge Claude takes") do
      picture = ScoreReader.picture(WIDE_PNG)
      image = Image.from_buffer(picture)
      assert_eq(image.width, SCORE_READER_EDGE)
      assert_eq(Base64.decode(picture).slice(0, 3).length, 3)
      assert(picture.starts_with?("/9j/"), "JPEG bytes")
    end

    test("is nil for bytes that are not a picture") do
      assert_null(ScoreReader.picture(Base64.encode("not an image")))
      assert_null(ScoreReader.picture("%%% not base64"))
    end
  end

  describe("the conversation") do
    test("sends the picture with the instructions") do
      turns = ScoreReader.turns("abc", nil, nil)
      assert_eq(turns.length, 1)
      assert_eq(turns[0]["image"], "abc")
      assert_contains(turns[0]["text"], "LilyPond source only")
    end

    test("on a second try, carries the first answer and the engraver's words") do
      turns = ScoreReader.turns("abc", "{ c4 ( }", "unclosed slur")
      assert_eq(turns.length, 3)
      assert_eq(
        turns[1],
        {"role": "assistant", "text": "{ c4 ( }"}
      )
      assert_contains(turns[2]["text"], "unclosed slur")
      assert_null(turns[2]["image"])
    end
  end

  describe("the answer") do
    test("is the source in the text, without a fence") do
      assert_eq(ScoreReader.source_of({"text": "```lilypond\n{ c'4 d' e' f' }\n```"}), {"source": "{ c'4 d' e' f' }"})
      assert_eq(ScoreReader.unfenced("  { c4 }  "), "{ c4 }")
      assert_eq(ScoreReader.unfenced("```\n{ c4 }"), "{ c4 }")
    end

    test("passes an error on, and names an answer with no music") do
      assert_eq(ScoreReader.source_of({"error": "busy"}), {"error": "busy"})
      assert_eq(ScoreReader.source_of({"text": "  "}), {"error": "No music was found in the picture."})
    end
  end
end

describe("ScoreReading") do
  test("starts reading, counted against the day's readings, in a job") do
    user = reader_user()
    assert_eq(ScoreReading.left_today(user), SCORE_READINGS_PER_DAY)
    reading = ScoreReading.start(user, "abc")
    stored = ScoreReading.find(reading._key)
    assert_eq(stored.state, "reading")
    assert_eq(stored.picture, "abc")
    assert(stored.owned_by?(user))
    assert_not(stored.owned_by?(reader_user()))
    assert_not(stored.owned_by?(nil))
    assert_eq(ScoreReading.left_today(user), SCORE_READINGS_PER_DAY - 1)
  end

  test("leaves none once the day's are used, and counts only the last 24 hours") do
    user = reader_user()
    (0 .. SCORE_READINGS_PER_DAY).each do |_|
      ScoreReading.create({
        "user_id": user._key,
        "state": "done",
        "created_at": DateTime.utc.to_unix
      })
    end
    assert_eq(ScoreReading.left_today(user), 0)
    other = reader_user()
    ScoreReading.create({
      "user_id": other._key,
      "state": "done",
      "created_at": DateTime.utc.to_unix - 90000
    })
    assert_eq(ScoreReading.left_today(other), SCORE_READINGS_PER_DAY)
  end

  test("a reading already finished is not read again") do
    user = reader_user()
    reading = ScoreReading.create({
      "user_id": user._key,
      "state": "done",
      "source": "{ c4 }",
      "created_at": DateTime.utc.to_unix
    })
    ScoreReadingJob.perform({"reading_id": reading._key})
    assert_eq(ScoreReading.find(reading._key).source, "{ c4 }")
  end

  test("reads with a key of one's own, with more readings a day") do
    user = reader_user()
    assert_eq(user.ai_settings, AiClient.server_settings)
    assert_null(user.keep_ai_key("moonshot", "kimi-latest", "sk-moonshot-secret-9876"))
    stored = User.find(user._key)
    assert(stored.own_ai?)
    assert_ne(stored.ai_key, "sk-moonshot-secret-9876", "encrypted, not kept as typed")
    assert_eq(stored.ai_key_hint, "9876")
    assert_eq(stored.ai_provider_name, "Moonshot (Kimi)")
    assert_eq(
      stored.ai_settings,
      {
        "provider": "moonshot",
        "model": "kimi-latest",
        "key": "sk-moonshot-secret-9876",
        "own": true
      }
    )
    assert_eq(ScoreReading.left_today(stored), SCORE_READINGS_OWN_PER_DAY)
    stored.forget_ai_key
    gone = User.find(user._key)
    assert_not(gone.own_ai?)
    assert_null(gone.ai_key)
    assert_eq(gone.ai_settings["provider"], "anthropic")
  end

  test("refuses a key without a known provider, a model or the key itself") do
    user = reader_user()
    assert_eq(user.keep_ai_key("skynet", "m", "sk-123456789"), "Choose a provider.")
    assert_eq(user.keep_ai_key("openai", "  ", "sk-123456789"), "Name the model to use.")
    assert_eq(user.keep_ai_key("openai", "gpt-5", "short"), "Paste the API key.")
    assert_not(User.find(user._key).own_ai?)
  end

  test("ends failed, not stuck, when its work breaks") do
    reading = ScoreReading.create({
      "user_id": "no-such-user",
      "state": "reading",
      "picture": "abc",
      "created_at": DateTime.utc.to_unix
    })
    ScoreReadingJob.perform({"reading_id": reading._key})
    stored = ScoreReading.find(reading._key)
    assert_eq(stored.state, "failed")
    assert_eq(stored.error, "Something went wrong while reading the photo. Try again.")
    assert_null(stored.picture)
  end

  test("refuses a state it does not know") do
    reading = ScoreReading.create({
      "user_id": "someone",
      "state": "lost"
    })
    assert_null(reading._key)
  end
end
