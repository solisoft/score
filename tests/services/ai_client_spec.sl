# Calling an AI model: the request built for each provider, the answer read,
# and each way it can fail named. No request leaves: the HTTP call itself
# is the one line not run here.

# Settings as a person's own key gives them.
def own_settings(provider, model)
  {
    "provider": provider,
    "model": model,
    "key": "sk-own-key-1234",
    "own": true
  }
end

def provider_said(status, body)
  {"status": status, "body": JSON.stringify(body)}
end

describe("AiClient") do
  describe("the request") do
    test("sends the server's Opus the turns, thinking, with its fallback") do
      turns = [{
        "role": "user",
        "image": "abc",
        "text": "Read this"
      }]
      request = AiClient.request(AiClient.server_settings, turns)
      assert_eq(request["url"], "https://api.anthropic.com/v1/messages")
      assert_eq(request["headers"]["x-api-key"], "test-key-never-sent")
      assert_eq(request["headers"]["anthropic-beta"], "server-side-fallback-2026-07-01")
      body = request["body"]
      assert_eq(body["model"], "claude-opus-5-5")
      assert_eq(body["thinking"]["type"], "adaptive")
      assert_eq(body["output_config"]["effort"], "high")
      assert_eq(body["fallbacks"], "default")
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

    test("a turn without an image is plain text; a Claude model of one's own gets what every Claude takes") do
      turns = [
        {"role": "user", "text": "Harmonize"},
        {"role": "assistant", "text": "{ c4 }"},
        {"role": "user", "text": "Again"}
      ]
      request = AiClient.request(own_settings("anthropic", "claude-sonnet-5-5"), turns)
      assert_eq(request["headers"]["x-api-key"], "sk-own-key-1234")
      assert_null(request["headers"]["anthropic-beta"])
      body = request["body"]
      assert_eq(body["model"], "claude-sonnet-5-5")
      assert_null(body["thinking"])
      assert_null(body["fallbacks"])
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
      assert_eq(AiClient.answer(said, AiClient.server_settings), {"text": "{ c'4 d' }"})
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
      server = AiClient.server_settings
      assert_eq(
        AiClient.answer(nil, server)["error"],
        "Anthropic (Claude) could not be reached. Try again in a moment."
      )
      [529, 429, 500].each do |status|
        assert_contains(AiClient.answer(provider_said(status, {}), server)["error"], "busy")
      end
      assert_eq(
        AiClient.answer(provider_said(401, {}), server)["error"],
        "Anthropic (Claude) could not answer this time. Try again in a moment."
      )
      assert_contains(AiClient.answer(
        {"status": 200, "body": "not json"},
        server
      )["error"], "could not be read")
      refused = provider_said(
        200,
        {"stop_reason": "refusal", "content": [{
          "type": "text",
          "text": "{ c4 }"
        }]}
      )
      assert_eq(AiClient.answer(refused, server)["error"], "Anthropic (Claude) declined the request.")
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

  test("is offered when the server has a key, and names providers") do
    assert(AiClient.available?())
    assert_eq(AiClient.server_settings["provider"], "anthropic")
    assert_eq(AiClient.provider_name("moonshot"), "Moonshot (Kimi)")
    assert_eq(AiClient.provider_name("unknown"), "unknown")
  end
end
