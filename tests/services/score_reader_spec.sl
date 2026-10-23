# Reading a photo of a score with Claude: the picture sent, the request
# built, Claude's answers read, and a reading kept per person.

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

def claude_said(status, body)
  {"status": status, "body": JSON.stringify(body)}
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

  describe("the request") do
    test("sends the picture and the instructions to Opus, thinking") do
      body = ScoreReader.request_body("abc", nil, nil)
      assert_eq(body["model"], "claude-opus-5-5")
      assert_eq(body["thinking"]["type"], "adaptive")
      assert_eq(body["fallbacks"], "default")
      assert_null(body["temperature"])
      assert_eq(body["messages"].length, 1)
      content = body["messages"][0]["content"]
      assert_eq(
        content[0]["source"],
        {
          "type": "base64",
          "media_type": "image/jpeg",
          "data": "abc"
        }
      )
      assert_contains(content[1]["text"], "LilyPond source only")
    end

    test("on a second try, carries the first answer and the engraver's words") do
      body = ScoreReader.request_body("abc", "{ c4 ( }", "unclosed slur")
      assert_eq(body["messages"].length, 3)
      assert_eq(
        body["messages"][1],
        {"role": "assistant", "content": "{ c4 ( }"}
      )
      assert_contains(body["messages"][2]["content"], "unclosed slur")
    end
  end

  describe("Claude's answer") do
    test("is the text of the answer, without a fence") do
      said = claude_said(
        200,
        {"stop_reason": "end_turn", "content": [
          {"type": "thinking", "thinking": "a C major scale"},
          {"type": "text", "text": "```lilypond\n{ c'4 d' e' f' }\n```"}
        ]}
      )
      assert_eq(ScoreReader.answer(said), {"source": "{ c'4 d' e' f' }"})
      assert_eq(ScoreReader.unfenced("  { c4 }  "), "{ c4 }")
      assert_eq(ScoreReader.unfenced("```\n{ c4 }"), "{ c4 }")
    end

    test("names each way it can fail") do
      assert_contains(ScoreReader.answer(nil)["error"], "could not be reached")
      assert_contains(ScoreReader.answer(claude_said(529, {}))["error"], "busy")
      assert_contains(ScoreReader.answer(claude_said(429, {}))["error"], "busy")
      assert_contains(ScoreReader.answer(claude_said(500, {}))["error"], "busy")
      assert_eq(ScoreReader.answer(claude_said(401, {}))["error"], "Claude refused the request (401).")
      assert_contains(ScoreReader.answer({
        "status": 200,
        "body": "not json"
      })["error"], "could not be read")
      refused = claude_said(
        200,
        {"stop_reason": "refusal", "content": [{
          "type": "text",
          "text": "{ c4 }"
        }]}
      )
      assert_contains(ScoreReader.answer(refused)["error"], "declined")
      empty = claude_said(
        200,
        {"stop_reason": "end_turn", "content": [{
          "type": "text",
          "text": "  "
        }]}
      )
      assert_contains(ScoreReader.answer(empty)["error"], "No music")
      assert_null(ScoreReader.answer(empty)["source"])
    end
  end

  describe("the engraver's check") do
    test("passes music it engraves, and names what it refuses") do
      assert_null(ScoreReader.problem("{ c'4 d' e' f' }"))
      assert_contains(ScoreReader.problem("\\relax { c4 }"), "relax")
    end
  end

  test("is offered when the server has a key") do
    assert(ScoreReader.available?())
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

  test("refuses a state it does not know") do
    reading = ScoreReading.create({
      "user_id": "someone",
      "state": "lost"
    })
    assert_null(reading._key)
  end
end
