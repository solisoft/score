# Calling an AI model: who may (#396: one's own key only, and on Pro once
# payments are open; the server's key never), the request built for each
# provider, the answer read, and each way it can fail named. No request
# leaves: the HTTP call itself is the one line not run here.

# Settings as a person's own key gives them.
def own_settings(provider, model)
  {
    "provider": provider,
    "model": model,
    "key": "sk-own-key-1234"
  }
end

def provider_said(status, body)
  {"status": status, "body": JSON.stringify(body)}
end

# Someone signed up, with `key` of their own (nil: none), on Pro if `pro`.
def ai_person(key = nil, pro = false)
  user = User.new()
  user.email = "ai-#{uuid_v4}@example.com"
  user.set_password("correct horse battery")
  user.confirmed_at = DateTime.utc.to_unix
  if pro
    user.plan = "pro"
    user.plan_status = "active"
    user.current_period_end = DateTime.utc.to_unix + 86400
  end
  user.save
  user.keep_ai_key("mistral", "mistral-medium-latest", key) unless key.nil?
  User.find(user._key)
end

describe("AiClient") do
  describe("who may ask") do
    test("the server's key is never used, even when ANTHROPIC_API_KEY is set") do
      # .env.test sets one, as a server that once offered its own AI does.
      assert(getenv("ANTHROPIC_API_KEY").present?, "the spec runs with the server's key set")
      keyless = ai_person()
      [false, true].each do |open|
        assert_null(AiClient.settings_for(keyless, open))
      end
      assert_null(keyless.ai_settings)
      assert_eq(AiClient.refusal(keyless, false), "no_key")
      pro_keyless = ai_person(nil, true)
      assert_eq(AiClient.refusal(pro_keyless, true), "no_key")
      assert_null(AiClient.settings_for(pro_keyless, true))
      # With a key of their own, theirs is the only one sent.
      own = ai_person("sk-mistral-own-7777")
      settings = AiClient.settings_for(own, false)
      assert_eq(settings["key"], "sk-mistral-own-7777")
      request = AiClient.request(settings, [{
        "role": "user",
        "text": "Hi"
      }])
      assert_eq(request["headers"]["Authorization"], "Bearer sk-mistral-own-7777")
      assert_not(JSON.stringify(request).contains(getenv("ANTHROPIC_API_KEY")), "the server's key is never sent")
    end

    test("payments closed: anyone with a key of their own, whatever the plan") do
      assert_null(AiClient.refusal(ai_person("sk-mistral-free-1111"), false))
      assert_null(AiClient.refusal(ai_person("sk-mistral-pro-2222", true), false))
      assert_eq(AiClient.settings_for(ai_person("sk-mistral-free-3333"), false)["model"], "mistral-medium-latest")
    end

    test("payments open: Pro with a key, not Free, whose key stays kept but unused") do
      assert_null(AiClient.refusal(ai_person("sk-mistral-pro-4444", true), true))
      free = ai_person("sk-mistral-free-5555")
      assert_eq(AiClient.refusal(free, true), "plan")
      assert_null(AiClient.settings_for(free, true))
      assert(free.own_ai?, "the key is still kept")
      assert_eq(free.ai_refusal(true), "plan")
      assert_null(free.ai_refusal(false))
      # Free without a key: Pro is what lifts it, not a key.
      assert_eq(AiClient.refusal(ai_person(), true), "plan")
      # A lapsed Pro is on Free.
      lapsed = ai_person("sk-mistral-gone-6666", true)
      lapsed.current_period_end = DateTime.utc.to_unix - 60
      lapsed.update()
      assert_eq(AiClient.refusal(User.find(lapsed._key), true), "plan")
    end

    test("a refusal says why, and links the page that lifts it") do
      assert_eq(AI_NO_KEY, "Add your own AI key in Account to read photos and use the assistant.")
      assert_eq(AI_PRO_ONLY, "AI with your own key is part of Pro.")
      key_link = AiClient.refusal_link("no_key", "/app/account#ai", "/pricing")
      assert_eq(
        key_link,
        {"href": "/app/account#ai", "text": "Add your key in Account"}
      )
      plan_link = AiClient.refusal_link("plan", "/app/account#ai", "/pricing")
      assert_eq(
        plan_link,
        {"href": "/pricing", "text": "See the plans"}
      )
      assert_eq(AiClient.refusal_text("no_key"), AI_NO_KEY)
      assert_eq(AiClient.refusal_text("plan"), AI_PRO_ONLY)
      assert_eq(
        AiClient.refusal_answer("no_key", key_link),
        {
          "error": AI_NO_KEY,
          "link": "/app/account#ai",
          "link_text": "Add your key in Account"
        }
      )
      assert_eq(
        AiClient.refusal_answer("plan", plan_link),
        {
          "error": AI_PRO_ONLY,
          "link": "/pricing",
          "link_text": "See the plans",
          "upgrade": "/pricing"
        }
      )
    end
  end

  describe("the request") do
    test("a Claude model of one's own gets the image first, and what every Claude model takes") do
      turns = [{
        "role": "user",
        "image": "abc",
        "text": "Read this"
      }]
      request = AiClient.request(own_settings("anthropic", "claude-opus-5-5"), turns)
      assert_eq(request["url"], "https://api.anthropic.com/v1/messages")
      assert_eq(request["headers"]["x-api-key"], "sk-own-key-1234")
      assert_null(request["headers"]["anthropic-beta"])
      body = request["body"]
      assert_eq(body["model"], "claude-opus-5-5")
      assert_null(body["thinking"])
      assert_null(body["fallbacks"])
      assert_null(body["temperature"])
      content = body["messages"][0]["content"]
      assert_eq(
        content[0]["source"],
        {
          "type": "base64",
          "media_type": "image/jpeg",
          "data": "abc"
        }
      )
      assert_eq(
        content[1],
        {"type": "text", "text": "Read this"}
      )
    end

    test("a turn without an image is plain text") do
      turns = [
        {"role": "user", "text": "Harmonize"},
        {"role": "assistant", "text": "{ c4 }"},
        {"role": "user", "text": "Again"}
      ]
      body = AiClient.request(own_settings("anthropic", "claude-sonnet-5-5"), turns)["body"]
      assert_eq(body["model"], "claude-sonnet-5-5")
      assert_eq(body["messages"], [
        {"role": "user", "content": "Harmonize"},
        {"role": "assistant", "content": "{ c4 }"},
        {"role": "user", "content": "Again"}
      ])
    end

    test("the other providers get the chat-completions request, the key as a bearer") do
      turns = [{
        "role": "user",
        "image": "abc",
        "text": "Read this"
      }, {"role": "assistant", "text": "{ c4 }"}]
      request = AiClient.request(own_settings("moonshot", "kimi-latest"), turns)
      assert_eq(request["url"], "https://api.moonshot.ai/v1/chat/completions")
      assert_eq(request["headers"]["Authorization"], "Bearer sk-own-key-1234")
      assert_null(request["headers"]["x-api-key"])
      body = request["body"]
      assert_eq(body["model"], "kimi-latest")
      assert_eq(body["messages"][0]["content"][0]["image_url"]["url"], "data:image/jpeg;base64,abc")
      assert_eq(
        body["messages"][0]["content"][1],
        {"type": "text", "text": "Read this"}
      )
      assert_eq(
        body["messages"][1],
        {"role": "assistant", "content": "{ c4 }"}
      )
      ["openai", "gemini", "mistral", "deepseek", "openrouter"].each do |provider|
        url = AiClient.request(own_settings(provider, "m"), turns)["url"]
        assert(url.ends_with?("/chat/completions"), provider)
      end
    end
  end

  describe("the answer") do
    test("is the text of Claude's answer, its thinking left out") do
      said = provider_said(
        200,
        {"stop_reason": "end_turn", "content": [
          {"type": "thinking", "thinking": "a C major scale"},
          {"type": "text", "text": "{ c'4 "},
          {"type": "text", "text": "d' }"}
        ]}
      )
      assert_eq(AiClient.answer(said, own_settings("anthropic", "claude-opus-5-5")), {"text": "{ c'4 d' }"})
    end

    test("is the message of a chat-completions answer, as text or as parts") do
      text = provider_said(200, {"choices": [{
        "finish_reason": "stop",
        "message": {"content": "{ c'4 }"}
      }]})
      assert_eq(AiClient.answer(text, own_settings("openai", "gpt-5")), {"text": "{ c'4 }"})
      parts = provider_said(200, {"choices": [{"message": {"content": [{
        "type": "text",
        "text": "{ d'4 }"
      }]}}]})
      assert_eq(AiClient.answer(parts, own_settings("mistral", "m")), {"text": "{ d'4 }"})
      none = provider_said(200, {"choices": []})
      assert_eq(AiClient.answer(none, own_settings("openai", "gpt-5")), {"text": ""})
    end

    test("names each way it can fail, and whose") do
      claude = own_settings("anthropic", "claude-opus-5-5")
      assert_eq(
        AiClient.answer(nil, claude)["error"],
        "Anthropic (Claude) could not be reached. Try again in a moment."
      )
      [529, 429, 500].each do |status|
        assert_contains(AiClient.answer(provider_said(status, {}), claude)["error"], "busy")
      end
      assert_eq(
        AiClient.answer(provider_said(403, {}), claude)["error"],
        "Anthropic (Claude) refused your API key. Check it on your account page."
      )
      assert_contains(AiClient.answer(
        {"status": 200, "body": "not json"},
        claude
      )["error"], "could not be read")
      refused = provider_said(
        200,
        {"stop_reason": "refusal", "content": [{
          "type": "text",
          "text": "{ c4 }"
        }]}
      )
      assert_eq(AiClient.answer(refused, claude)["error"], "Anthropic (Claude) declined the request.")
      filtered = provider_said(200, {"choices": [{
        "finish_reason": "content_filter",
        "message": {"content": ""}
      }]})
      assert_eq(
        AiClient.answer(filtered, own_settings("gemini", "g"))["error"],
        "Google (Gemini) declined the request."
      )
    end

    test("names a refused key or model of one's own, and keeps the provider's words out of the message") do
      deepseek = own_settings("deepseek", "deepseek-chat")
      assert_eq(
        AiClient.answer(provider_said(401, {}), deepseek)["error"],
        "DeepSeek refused your API key. Check it on your account page."
      )
      Logger.set_capture(true)
      no_images = provider_said(400, {"error": {"message": "This model does not support image input"}})
      said = AiClient.answer(no_images, deepseek)["error"]
      assert_eq(said, "DeepSeek could not answer with the model you chose. Try another one on your account page.")
      assert_not(said.contains("support image input"), "the provider's words stay out of the message")
      logged = Logger.entries().join("\n")
      Logger.set_capture(false)
      assert_contains(logged, "This model does not support image input")
      assert_contains(logged, "deepseek")
      plain = provider_said(404, [{"error": "no such model"}])
      assert_eq(
        AiClient.answer(plain, own_settings("openrouter", "x"))["error"],
        "OpenRouter (many models) could not answer with the model you chose. Try another one on your account page."
      )
      teapot = provider_said(418, {"error": "teapot"})
      assert_eq(
        AiClient.answer(teapot, own_settings("openrouter", "x"))["error"],
        "OpenRouter (many models) could not answer this time. Try again in a moment."
      )
      assert_eq(AiClient.provider_words({"error": {"message": "x" * 400}}).length, 300)
      assert_eq(AiClient.provider_words({}), "")
      assert_eq(AiClient.provider_words(nil), "")
    end
  end

  test("checks a source with the engraver") do
    assert_null(AiClient.problem("{ c'4 d' e' f' }"))
    assert_contains(AiClient.problem("\\relax { c4 }"), "relax")
  end

  test("names providers") do
    assert_eq(AiClient.provider_name("moonshot"), "Moonshot (Kimi)")
    assert_eq(AiClient.provider_name("unknown"), "unknown")
  end
end

# A streamed answer as HTTP.stream gives it: `status`, then `next_line` until
# nil; it raises at line `fail_at`, and waits a little before line `pause_at`.
class FakeStream
  status: Int = 200
  lines: Array = []
  at: Int = 0
  fail_at: Int = 999999
  pause_at: Int = 999999

  def next_line
    throw "HTTP.stream: nothing received for 180 s" if @at == @fail_at
    sleep(2.2) if @at == @pause_at
    return nil if @at >= @lines.length

    line = @lines[@at]
    @at = @at + 1
    line
  end
end

def fake_stream(lines, status = 200)
  stream = FakeStream.new()
  stream.lines = lines
  stream.status = status
  stream
end

def sse(event)
  "data: #{JSON.stringify(event)}"
end

describe("AiClient streamed answers (#435)") do
  test("asks for a stream, its timeout the wait between pieces") do
    claude = AiClient.request(own_settings("anthropic", "claude-opus-5-5"), [{
      "role": "user",
      "text": "hi"
    }], true)
    assert_eq(claude["body"]["stream"], true)
    assert_eq(claude["headers"]["timeout"], AI_STREAM_IDLE)
    kimi = AiClient.request(own_settings("moonshot", "kimi-k3.1-pro"), [{
      "role": "user",
      "text": "hi"
    }], true)
    assert_eq(kimi["body"]["stream"], true)
    plain = AiClient.request(own_settings("moonshot", "kimi-k3.1-pro"), [{
      "role": "user",
      "text": "hi"
    }])
    assert_null(plain["body"]["stream"])
    assert_eq(plain["headers"]["timeout"], 300)
  end

  test("reads Anthropic's events: the text deltas, nothing else") do
    stream = fake_stream([
      "event: message_start",
      sse({"type": "message_start", "message": {"id": "m"}}),
      "",
      sse({"type": "content_block_delta", "delta": {
        "type": "thinking_delta",
        "thinking": "hmm"
      }}),
      sse({"type": "content_block_delta", "delta": {
        "type": "text_delta",
        "text": "{ c'4"
      }}),
      ": keep-alive",
      sse({"type": "content_block_delta", "delta": {
        "type": "text_delta",
        "text": " d'4 }"
      }}),
      sse({"type": "message_delta", "delta": {"stop_reason": "end_turn"}}),
      sse({"type": "message_stop"}),
      sse({"type": "content_block_delta", "delta": {
        "type": "text_delta",
        "text": "after the end"
      }})
    ])
    assert_eq(AiClient.streamed(stream, own_settings("anthropic", "claude-opus-5-5")), {"text": "{ c'4 d'4 }"})
  end

  test("reads chat-completions chunks, a thought not taken for the answer") do
    stream = fake_stream([
      sse({"choices": [{"delta": {
        "role": "assistant",
        "reasoning_content": "Let me look"
      }}]}),
      sse({"choices": [{"delta": {"content": "{ e'4"}}]}),
      sse({"choices": [{"delta": {"content": [{
        "type": "text",
        "text": " f'4 }"
      }]}}]}),
      sse({"choices": [{"delta": {}, "finish_reason": "stop"}]}),
      "data: [DONE]",
      sse({"choices": [{"delta": {"content": "after the end"}}]})
    ])
    assert_eq(AiClient.streamed(stream, own_settings("moonshot", "kimi-k3.1-pro")), {"text": "{ e'4 f'4 }"})
  end

  test("a refusal, a provider's error in the stream, and a stream that stops are each named") do
    refusal = fake_stream([sse({
      "type": "message_delta",
      "delta": {"stop_reason": "refusal"}
    })])
    assert_eq(
      AiClient.streamed(refusal, own_settings("anthropic", "claude-opus-5-5"))["error"],
      "Anthropic (Claude) declined the request."
    )
    filtered = fake_stream([sse({"choices": [{
      "delta": {},
      "finish_reason": "content_filter"
    }]})])
    assert_contains(AiClient.streamed(filtered, own_settings("openai", "gpt-5"))["error"], "declined")
    overloaded = fake_stream([sse({
      "type": "error",
      "error": {"type": "overloaded_error", "message": "Overloaded"}
    })])
    assert_eq(
      AiClient.streamed(overloaded, own_settings("anthropic", "claude-opus-5-5"))["error"],
      "Anthropic (Claude) could not answer this time. Try again in a moment."
    )
    stopped = fake_stream([
      sse({"choices": [{"delta": {"content": "{ c'4"}}]}),
      "",
      ""
    ])
    stopped.fail_at = 2
    assert_eq(
      AiClient.streamed(stopped, own_settings("moonshot", "kimi-k3.1-pro"))["error"],
      "Moonshot (Kimi) stopped answering. Try again in a moment."
    )
  end

  test("a status other than 200 is read whole, as an answer refused") do
    refused = fake_stream(["{\"error\": {\"message\": \"bad key\"}}"], 401)
    assert_eq(
      AiClient.streamed(refused, own_settings("moonshot", "kimi-k3.1-pro"))["error"],
      "Moonshot (Kimi) refused your API key. Check it on your account page."
    )
    busy = fake_stream(["{\"error\": \"engine overloaded\"}"], 429)
    assert_contains(AiClient.streamed(busy, own_settings("moonshot", "kimi-k3.1-pro"))["error"], "busy")
  end

  test("tells its progress: thinking before the first words, then the text so far") do
    told = []
    progress = fn(phase, text, thought) { told.push([
      phase,
      text,
      thought
    ]) }
    stream = fake_stream([
      sse({"choices": [{"delta": {"reasoning_content": "Let me look"}}]}),
      sse({"choices": [{"delta": {"content": "{ c'4"}}]}),
      sse({"choices": [{"delta": {"content": " }"}}]})
    ])
    stream.pause_at = 2
    assert_eq(AiClient.streamed(stream, own_settings("moonshot", "kimi-k3.1-pro"), progress), {"text": "{ c'4 }"})
    assert_eq(told, [[
      "thinking",
      "",
      11
    ], ["writing", "{ c'4 }", 11]], "how far its reasoning went, told too (#463)")
  end

  test("counts a Claude model's thinking, never as the answer (#463)") do
    told = []
    progress = fn(phase, text, thought) { told.push([
      phase,
      text,
      thought
    ]) }
    stream = fake_stream([
      sse({
        "type": "content_block_delta",
        "index": 0,
        "delta": {"type": "thinking_delta", "thinking": "Four bars in"}
      }),
      sse({
        "type": "content_block_delta",
        "index": 1,
        "delta": {"type": "text_delta", "text": "{ g'1 }"}
      }),
      sse({"type": "message_stop"})
    ])
    stream.pause_at = 1
    assert_eq(AiClient.streamed(stream, own_settings("anthropic", "claude-opus-5-5"), progress), {"text": "{ g'1 }"})
    assert_eq(told[0], [
      "thinking",
      "",
      12
    ])
  end

  test("an answer that goes on past the longest it may take is stopped, and said so (#463)") do
    stream = fake_stream([
      sse({"choices": [{"delta": {"reasoning_content": "Hmm"}}]}),
      sse({"choices": [{"delta": {"reasoning_content": " still thinking"}}]}),
      sse({"choices": [{"delta": {"content": "{ c'1 }"}}]})
    ])
    stream.pause_at = 1
    late = AiClient.streamed(stream, own_settings("moonshot", "kimi-k3.1-pro"), nil, 1)
    assert_eq(
      late["error"],
      "Moonshot (Kimi) did not finish within 1 second. Try again, or choose a quicker model in Account › AI."
    )
    assert_eq(AiClient.duration(600), "10 minutes")
  end

  test("reads a line that is no data as nothing, and a broken one too") do
    assert_null(AiClient.stream_delta("event: ping", true))
    assert_null(AiClient.stream_delta("data: {not json", false))
    assert_null(AiClient.stream_delta("data: [1, 2]", false))
    assert_eq(AiClient.stream_delta("data:[DONE]", false), {"done": true})
  end
end
