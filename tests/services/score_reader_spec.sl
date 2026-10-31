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
      assert_eq(turns[0]["text"], ScoreReader.instructions)
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

  describe("the instructions") do
    test("ask for the signs of form and ornament, and keep the source-only answer") do
      text = ScoreReader.instructions
      [
        "\\repeat volta",
        "\\alternative",
        "\\segnoMark",
        "\\codaMark",
        "\\jump",
        "\\fine",
        "To Coda",
        "\\tuplet",
        "\\acciaccatura",
        "\\trill",
        "\\ottava",
        "\\sustainOn"
      ].each do |form|
        assert_contains(text, form)
      end
      assert_contains(text, "Leave out what you cannot read")
      assert_contains(text, "cis for C sharp")
      assert(
        text.ends_with?("LilyPond source only: no explanation, no Markdown fence."),
        "the answer's form comes last"
      )
    end

    test("show only forms the engraver reads (#432)") do
      SCORE_READER_FORMS.each do |form|
        assert_null(AiClient.problem("\\relative c'' { #{form[1]} }"), form[0])
        assert_contains(ScoreReader.instructions, "- #{form[0]}: #{form[1]}")
      end
    end

    test("ask for the note names the engraver reads") do
      assert_contains(ScoreReader.instructions, "Write the note names in Dutch")
      assert_not_null(AiClient.problem("\\relative c'' { bf4 cs d e }"))
      assert_null(AiClient.problem("\\relative c'' { bes4 cis d e }"))
      assert_null(AiClient.problem("\\language \"english\" \\relative c'' { bf4 cs d e }"))
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
    user.keep_ai_key("mistral", "pixtral-large-latest", "sk-mistral-8888")
    user = User.find(user._key)
    assert_eq(ScoreReading.left_today(user), SCORE_READINGS_OWN_PER_DAY)
    reading = ScoreReading.start(user, "abc", false)
    stored = ScoreReading.find(reading._key)
    assert_eq(stored.state, "reading")
    assert_eq(stored.picture, "abc")
    assert_null(stored.own, "no server key to tell apart any more")
    assert(stored.owned_by?(user))
    assert_not(stored.owned_by?(reader_user()))
    assert_not(stored.owned_by?(nil))
    assert_eq(ScoreReading.left_today(user), SCORE_READINGS_OWN_PER_DAY - 1)
  end

  test("payments open: Pro's own key reads, Free's is refused for the plan, nothing kept or queued") do
    pro = reader_user()
    pro.plan = "pro"
    pro.plan_status = "active"
    pro.current_period_end = DateTime.utc.to_unix + 86400
    pro.update()
    pro.keep_ai_key("mistral", "pixtral-large-latest", "sk-mistral-pro-1")
    pro = User.find(pro._key)
    assert_not_null(ScoreReading.start(pro, "abc", true)._key)
    free = reader_user()
    free.keep_ai_key("mistral", "pixtral-large-latest", "sk-mistral-free-1")
    free = User.find(free._key)
    jobs_before = Job.list().length
    assert_eq(ScoreReading.start(free, "abc", true), "plan")
    assert_eq(ScoreReading.where({"user_id": free._key}).count, 0)
    assert_eq(Job.list().length, jobs_before)
    # Payments closed: the same key reads.
    assert_not_null(ScoreReading.start(free, "abc", false)._key)
    # No key at all: refused, open or not.
    keyless = reader_user()
    assert_eq(ScoreReading.start(keyless, "abc", false), "no_key")
    assert_eq(ScoreReading.where({"user_id": keyless._key}).count, 0)
    assert_eq(Job.list().length, jobs_before + 1)
  end

  test("a reading queued for someone whose key is gone fails, with no one asked") do
    user = reader_user()
    reading = ScoreReading.create({
      "user_id": user._key,
      "state": "reading",
      "picture": "abc",
      "created_at": DateTime.utc.to_unix
    })
    ScoreReadingJob.perform({"reading_id": reading._key})
    stored = ScoreReading.find(reading._key)
    assert_eq(stored.state, "failed")
    assert_eq(stored.error, AI_NO_KEY)
    assert_eq(stored.picture, "abc", "kept for Try again, let go after a week (#465)")
  end

  test("leaves none once the day's are used, and counts only the last 24 hours") do
    user = reader_user()
    rows = (0 .. SCORE_READINGS_OWN_PER_DAY).map do |_|
      {
        "user_id": user._key,
        "state": "done",
        "created_at": DateTime.utc.to_unix
      }
    end
    ScoreReading.create_many(rows)
    assert_eq(ScoreReading.left_today(user), 0)
    other = reader_user()
    ScoreReading.create({
      "user_id": other._key,
      "state": "done",
      "created_at": DateTime.utc.to_unix - 90000
    })
    assert_eq(ScoreReading.left_today(other), SCORE_READINGS_OWN_PER_DAY)
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

  test("reads with a key of one's own, and with none once it is removed") do
    user = reader_user()
    assert_null(user.ai_settings, "no key: nothing, not the server's")
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
        "key": "sk-moonshot-secret-9876"
      }
    )
    assert_eq(ScoreReading.left_today(stored), SCORE_READINGS_OWN_PER_DAY)
    stored.forget_ai_key
    gone = User.find(user._key)
    assert_not(gone.own_ai?)
    assert_null(gone.ai_key)
    assert_null(gone.ai_settings)
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
    assert_eq(stored.picture, "abc", "kept for Try again (#465)")
  end

  test("refuses a state it does not know") do
    reading = ScoreReading.create({
      "user_id": "someone",
      "state": "lost"
    })
    assert_null(reading._key)
  end
end

describe("A draft engraved while it is written (#462)") do
  test("is cut after its last bar line, what is open closed, and engraves") do
    draft = "\\header { title = \"Waltz\" }\n\\new Staff \\relative c' {\n  \\time 3/4 c4 d e | f2. | g4 a"
    closed = ScoreReader.closed_draft(draft)
    assert(closed.contains("f2. |"), "kept up to the last bar line")
    assert_not(closed.contains("g4 a"), "the bar being written left out")
    assert(closed.trim.ends_with?("}"), "the staff closed")
    assert_null(eui_score_layout(closed, 100, {})["error"], "the engraver reads it")
    assert_not_null(ScoreReader.draft_svg(draft))
  end

  test("closes << and nested braces innermost first, and ignores what strings and comments hold") do
    draft = "<<\n  \\new Staff { c'4^\"a | b {\" d' | % a comment | {\n  e'1 |\n  \\new Staff { g4"
    closed = ScoreReader.closed_draft(draft)
    assert(closed.trim.ends_with?("} >>"), closed)
    assert_null(eui_score_layout(closed, 100, {})["error"], closed)
  end

  test("nothing whole yet: nothing to engrave") do
    assert_eq(ScoreReader.closed_draft(""), "")
    assert_eq(ScoreReader.closed_draft("\\new Sta"), "")
    assert_null(ScoreReader.draft_svg("{ c'4"))
  end
end

describe("Photo imports kept (#465)") do
  test("a week for the photo, a month for the reading; one going on is left alone") do
    owner = User.new()
    owner.email = "imports-#{uuid_v4}@example.com"
    owner.set_password("correct horse battery")
    owner.save
    now = DateTime.utc.to_unix
    fresh = ScoreReading.create({
      "user_id": owner._key,
      "state": "done",
      "source": "{ c'1 }",
      "picture": "abc",
      "created_at": now - 3600
    })
    week = ScoreReading.create({
      "user_id": owner._key,
      "state": "failed",
      "picture": "abc",
      "created_at": now - 8 * 86400
    })
    going = ScoreReading.create({
      "user_id": owner._key,
      "state": "reading",
      "picture": "abc",
      "created_at": now - 8 * 86400 - 60
    })
    month = ScoreReading.create({
      "user_id": owner._key,
      "state": "done",
      "picture": "abc",
      "created_at": now - 31 * 86400
    })
    assert(ScoreReading.let_go >= 1)
    assert_eq(ScoreReading.find(fresh._key).picture, "abc")
    assert_null(ScoreReading.find(week._key).picture, "a week old: the photo goes")
    assert_eq(ScoreReading.find(going._key).picture, "abc", "never under a reading going on")
    assert_null(ScoreReading.where({"_key": month._key}).first, "a month old: the reading goes")
    assert_eq(ScoreReading.of(owner).map(&{ |r|
      r._key
    }), [fresh._key, week._key, going._key])
    assert_eq(ScoreReading.going(owner), 1)
    assert_eq(
      ScoreReading.find(fresh._key).title,
      "Photo of " + DateTime.from_unix(now - 3600).format("%d %b %Y, %H:%M")
    )
  end
end
