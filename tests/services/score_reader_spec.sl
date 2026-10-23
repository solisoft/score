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

# Settings as a person's own key gives them.
def own(provider, model)
  {
    "provider": provider,
    "model": model,
    "key": "sk-own-key-1234",
    "own": true
  }
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
    test("sends the picture and the instructions to the server's Opus, thinking") do
      request = ScoreReader.request("abc", ScoreReader.server_settings, nil, nil)
      assert_eq(request["url"], "https://api.anthropic.com/v1/messages")
      assert_eq(request["headers"]["x-api-key"], "test-key-never-sent")
      assert_eq(request["headers"]["anthropic-beta"], "server-side-fallback-2026-07-01")
      body = request["body"]
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

    test("a Claude model of one's own gets only what every Claude model takes") do
      request = ScoreReader.request("abc", own("anthropic", "claude-sonnet-5-5"), nil, nil)
      assert_eq(request["headers"]["x-api-key"], "sk-own-key-1234")
      assert_null(request["headers"]["anthropic-beta"])
      assert_eq(request["body"]["model"], "claude-sonnet-5-5")
      assert_null(request["body"]["thinking"])
      assert_null(request["body"]["fallbacks"])
    end

    test("the other providers get the chat-completions request, the key as a bearer") do
      request = ScoreReader.request("abc", own("moonshot", "kimi-latest"), nil, nil)
      assert_eq(request["url"], "https://api.moonshot.ai/v1/chat/completions")
      assert_eq(request["headers"]["Authorization"], "Bearer sk-own-key-1234")
      assert_null(request["headers"]["x-api-key"])
      body = request["body"]
      assert_eq(body["model"], "kimi-latest")
      content = body["messages"][0]["content"]
      assert_contains(content[0]["text"], "LilyPond source only")
      assert_eq(content[1]["image_url"]["url"], "data:image/jpeg;base64,abc")
      ["openai", "gemini", "mistral", "deepseek", "openrouter"].each do |provider|
        assert(
          ScoreReader.request("abc", own(provider, "m"), nil, nil)["url"].ends_with?("/chat/completions"),
          provider
        )
      end
    end

    test("on a second try, carries the first answer and the engraver's words") do
      [ScoreReader.server_settings, own("openai", "gpt-5")].each do |settings|
        body = ScoreReader.request("abc", settings, "{ c4 ( }", "unclosed slur")["body"]
        assert_eq(body["messages"].length, 3)
        assert_eq(
          body["messages"][1],
          {"role": "assistant", "content": "{ c4 ( }"}
        )
        assert_contains(body["messages"][2]["content"], "unclosed slur")
      end
    end
  end

  describe("the answer") do
    test("is the text of Claude's answer, without a fence") do
      said = claude_said(
        200,
        {"stop_reason": "end_turn", "content": [
          {"type": "thinking", "thinking": "a C major scale"},
          {"type": "text", "text": "```lilypond\n{ c'4 d' e' f' }\n```"}
        ]}
      )
      assert_eq(ScoreReader.answer(said, ScoreReader.server_settings), {"source": "{ c'4 d' e' f' }"})
      assert_eq(ScoreReader.unfenced("  { c4 }  "), "{ c4 }")
      assert_eq(ScoreReader.unfenced("```\n{ c4 }"), "{ c4 }")
    end

    test("is the message of a chat-completions answer, as text or as parts") do
      text = claude_said(200, {"choices": [{
        "finish_reason": "stop",
        "message": {"content": "{ c'4 }"}
      }]})
      assert_eq(ScoreReader.answer(text, own("openai", "gpt-5")), {"source": "{ c'4 }"})
      parts = claude_said(200, {"choices": [{"message": {"content": [{
        "type": "text",
        "text": "{ d'4 }"
      }]}}]})
      assert_eq(ScoreReader.answer(parts, own("mistral", "pixtral-large-latest")), {"source": "{ d'4 }"})
      filtered = claude_said(200, {"choices": [{
        "finish_reason": "content_filter",
        "message": {"content": ""}
      }]})
      assert_eq(
        ScoreReader.answer(filtered, own("gemini", "g"))["error"],
        "Google (Gemini) declined to read this picture."
      )
      none = claude_said(200, {"choices": []})
      assert_contains(ScoreReader.answer(none, own("openai", "gpt-5"))["error"], "No music")
    end

    test("names each way it can fail, and whose") do
      server = ScoreReader.server_settings
      assert_eq(
        ScoreReader.answer(nil, server)["error"],
        "Anthropic (Claude) could not be reached. Try again in a moment."
      )
      assert_contains(ScoreReader.answer(claude_said(529, {}), server)["error"], "busy")
      assert_contains(ScoreReader.answer(claude_said(429, {}), server)["error"], "busy")
      assert_contains(ScoreReader.answer(claude_said(500, {}), server)["error"], "busy")
      assert_eq(
        ScoreReader.answer(claude_said(401, {}), server)["error"],
        "Anthropic (Claude) refused the request (401)."
      )
      assert_contains(ScoreReader.answer(
        {"status": 200, "body": "not json"},
        server
      )["error"], "could not be read")
      refused = claude_said(
        200,
        {"stop_reason": "refusal", "content": [{
          "type": "text",
          "text": "{ c4 }"
        }]}
      )
      assert_contains(ScoreReader.answer(refused, server)["error"], "declined")
      empty = claude_said(
        200,
        {"stop_reason": "end_turn", "content": [{
          "type": "text",
          "text": "  "
        }]}
      )
      assert_contains(ScoreReader.answer(empty, server)["error"], "No music")
      assert_null(ScoreReader.answer(empty, server)["source"])
    end

    test("names a refused key of one's own, and passes on the provider's words") do
      assert_eq(
        ScoreReader.answer(claude_said(401, {}), own("deepseek", "deepseek-chat"))["error"],
        "DeepSeek refused your API key. Check it on your account page."
      )
      no_images = claude_said(400, {"error": {"message": "This model does not support image input"}})
      assert_eq(
        ScoreReader.answer(no_images, own("deepseek", "deepseek-chat"))["error"],
        "DeepSeek refused the request (400): This model does not support image input"
      )
      plain = claude_said(404, {"error": "no such model"})
      assert_eq(
        ScoreReader.answer(plain, own("openrouter", "x"))["error"],
        "OpenRouter (many models) refused the request (404): no such model"
      )
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

  test("reads with a key of one's own, with more readings a day") do
    user = reader_user()
    assert_eq(user.ai_settings, ScoreReader.server_settings)
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

  test("refuses a state it does not know") do
    reading = ScoreReading.create({
      "user_id": "someone",
      "state": "lost"
    })
    assert_null(reading._key)
  end
end
