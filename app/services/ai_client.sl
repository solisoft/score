# Calls an AI model: the server's Claude Opus (ANTHROPIC_API_KEY), or the
# provider, model and key a person set on their account (User#ai_settings).
# Keys stay on the server. Used by ScoreReader (photos) and ScoreAssistant
# (chords, harmony, improvements).
#
# A conversation is a list of turns, {"role": "user" | "assistant", "text",
# "image"?}: the image a base64 JPEG, sent before the text.

const AI_SERVER_MODEL = "claude-opus-5-5"

# The providers a person may bring a key for. "anthropic" speaks Anthropic's
# Messages API; "openai" the chat-completions API the others share. `models`
# are suggestions: any model of the provider will do (one that reads images,
# for photos).
const AI_PROVIDERS = {
  "anthropic": {
    "name": "Anthropic (Claude)",
    "api": "anthropic",
    "url": "https://api.anthropic.com/v1/messages",
    "models": ["claude-opus-5-5", "claude-sonnet-5-5"]
  },
  "openai": {
    "name": "OpenAI (GPT)",
    "api": "openai",
    "url": "https://api.openai.com/v1/chat/completions",
    "models": ["gpt-5", "gpt-4o"]
  },
  "gemini": {
    "name": "Google (Gemini)",
    "api": "openai",
    "url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    "models": ["gemini-2.5-pro", "gemini-2.5-flash"]
  },
  "mistral": {
    "name": "Mistral",
    "api": "openai",
    "url": "https://api.mistral.ai/v1/chat/completions",
    "models": ["pixtral-large-latest", "mistral-medium-latest"]
  },
  "deepseek": {
    "name": "DeepSeek",
    "api": "openai",
    "url": "https://api.deepseek.com/chat/completions",
    "models": ["deepseek-chat"]
  },
  "moonshot": {
    "name": "Moonshot (Kimi)",
    "api": "openai",
    "url": "https://api.moonshot.ai/v1/chat/completions",
    "models": ["kimi-latest", "moonshot-v1-32k-vision-preview"]
  },
  "openrouter": {
    "name": "OpenRouter (many models)",
    "api": "openai",
    "url": "https://openrouter.ai/api/v1/chat/completions",
    "models": ["anthropic/claude-opus-4.1", "openai/gpt-4o", "google/gemini-2.5-pro"]
  }
}

class AiClient
  # The server's own key: Claude Opus for whoever has no key of their own.
  static def available?
    getenv("ANTHROPIC_API_KEY").present?
  end

  # What the server asks with, as User#ai_settings answers for a person.
  static def server_settings
    {
      "provider": "anthropic",
      "model": AI_SERVER_MODEL,
      "key": getenv("ANTHROPIC_API_KEY").to_s,
      "own": false
    }
  end

  # The provider's name as a page says it.
  static def provider_name(provider)
    AI_PROVIDERS[provider]&.name ?? provider
  end

  # The conversation sent with `settings`: {"text": the answer} or {"error": …}.
  static def ask(settings, turns)
    request = AiClient.request(settings, turns)
    response = HTTP.request("POST", request["url"], request["headers"], JSON.stringify(request["body"])) rescue nil
    AiClient.answer(response, settings)
  end

  # The request for `settings`' provider: its URL, headers and body.
  static def request(settings, turns)
    provider = AI_PROVIDERS[settings["provider"]]
    if provider["api"] == "anthropic"
      headers = {
        "x-api-key": settings["key"],
        "anthropic-version": "2026-10-21",
        "content-type": "application/json",
        "timeout": 300
      }
      body = AiClient.anthropic_body(settings, turns)
      headers["anthropic-beta"] = "server-side-fallback-2026-07-01" unless body["fallbacks"].nil?
      return {
        "url": provider["url"],
        "headers": headers,
        "body": body
      }
    end

    {
      "url": provider["url"],
      "headers": {
        "Authorization": "Bearer #{settings["key"]}",
        "content-type": "application/json",
        "timeout": 300
      },
      "body": AiClient.chat_body(settings, turns)
    }
  end

  # Anthropic's Messages API. The server's Opus thinks hard and may fall
  # back; a person's own Claude model gets the parameters every Claude model
  # takes.
  static def anthropic_body(settings, turns)
    messages = turns.map do |turn|
      if turn["image"].nil?
        {"role": turn["role"], "content": turn["text"]}
      else
        {"role": turn["role"], "content": [
          {"type": "image", "source": {
            "type": "base64",
            "media_type": "image/jpeg",
            "data": turn["image"]
          }},
          {"type": "text", "text": turn["text"]}
        ]}
      end
    end
    body = {
      "model": settings["model"],
      "max_tokens": 32000,
      "messages": messages
    }
    return body if settings["own"]

    body.merge({
      "thinking": {"type": "adaptive"},
      "output_config": {"effort": "high"},
      "fallbacks": "default"
    })
  end

  # The chat-completions API (OpenAI and the providers that copy it).
  static def chat_body(settings, turns)
    messages = turns.map do |turn|
      if turn["image"].nil?
        {"role": turn["role"], "content": turn["text"]}
      else
        {"role": turn["role"], "content": [
          {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,#{turn["image"]}"}},
          {"type": "text", "text": turn["text"]}
        ]}
      end
    end
    {"model": settings["model"], "messages": messages}
  end

  # The model's response, read: {"text": …} or {"error": …}. Nil is a
  # request that never got an answer.
  static def answer(response, settings)
    who = AiClient.provider_name(settings["provider"])
    return {"error": "#{who} could not be reached. Try again in a moment."} if response.nil?

    status = response["status"]
    body = JSON.parse(response["body"].to_s) rescue nil
    return {"error": "#{who} is busy. Try again in a moment."} if [429, 529].includes?(status) || status >= 500
    if status != 200
      return {"error": AiClient.refused(who, status, body, settings)}
    end

    return {"error": "#{who}'s answer could not be read."} if body.nil?

    anthropic = AI_PROVIDERS[settings["provider"]]["api"] == "anthropic"
    text = anthropic ? AiClient.anthropic_text(body) : AiClient.chat_text(body)
    return {"error": "#{who} declined the request."} if text.nil?

    {"text": text}
  end

  # Why a request was refused, in a sentence: a key of one's own is named,
  # and the provider's own words are passed on (a model that does not read
  # images says so there).
  static def refused(who, status, body, settings)
    if [401, 403].includes?(status) && settings["own"]
      return "#{who} refused your API key. Check it on your account page."
    end

    return "#{who} refused the request (#{status})." if body.nil? || body["error"].nil?

    said = body["error"].is_a?("string") ? body["error"] : body["error"]["message"].to_s
    "#{who} refused the request (#{status}): #{said.substring(0, 300)}"
  end

  # The text of an Anthropic answer; nil when the model refused.
  static def anthropic_text(body)
    return nil if body["stop_reason"] == "refusal"

    (body["content"] ?? []).filter do |block|
      block["type"] == "text"
    end.map do |block|
      block["text"]
    end.join("")
  end

  # The text of a chat-completions answer; nil when it was filtered.
  static def chat_text(body)
    choices = body["choices"] ?? []
    return "" if choices.length == 0

    choice = choices[0]
    return nil if choice["finish_reason"] == "content_filter" || !choice["message"]["refusal"].blank?

    content = choice["message"]["content"]
    return content.to_s unless content.is_a?("array")

    content.map do |part|
      part["text"].to_s
    end.join("")
  end

  # What the engraver says against `source`, or nil when it engraves.
  static def problem(source)
    laid = eui_score_layout(source, 160, {}) rescue {"error": "it could not be engraved"}
    laid["error"]
  end
end
