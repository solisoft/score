# Calls an AI model with the provider, model and key a person set on their
# account (User#ai_settings), and decides whether they may (#396). Keys stay
# on the server. Used by ScoreReader (photos) and ScoreAssistant (chords,
# harmony, improvements).
#
# The site has no AI of its own any more: reading one photo with Claude Opus
# cost it $0.20–0.40. Whatever the server's environment holds
# (ANTHROPIC_API_KEY included), a request is sent only with the person's own
# key, and their provider bills them. Once payments are open, that is part
# of Pro (Plan, "own_key_ai").
#
# A conversation is a list of turns, {"role": "user" | "assistant", "text",
# "image"?}: the image a base64 JPEG, sent before the text.

const AI_NO_KEY = "Add your own AI key in Account to read photos and use the assistant."
const AI_PRO_ONLY = "AI with your own key is part of Pro."

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
  # Why `user` may not use the AI now, or nil: "plan" (payments are open and
  # AI with one's own key is part of Pro: a key kept on Free stays kept,
  # unused), "no_key" (no key of their own: the site's is never used).
  # `open`: whether payments are open, Plan.open? when nil.
  static def refusal(user, open = nil)
    return "plan" unless Plan.limits(user, open)["own_key_ai"]
    return "no_key" unless user.own_ai?

    nil
  end

  # What `user`'s request is sent with: their own provider, model and key;
  # nil when they may not ask (AiClient.refusal).
  static def settings_for(user, open = nil)
    return nil unless AiClient.refusal(user, open).nil?

    user.ai_settings
  end

  # What a refusal says, and the page that lifts it: the account's AI
  # section for a key (`account`), Pricing for Pro (`pricing`). The paths
  # come from the controllers (AppBaseController#_ai_link), where the
  # route helpers are.
  static def refusal_text(refusal)
    refusal == "plan" ? AI_PRO_ONLY : AI_NO_KEY
  end

  static def refusal_link(refusal, account, pricing)
    if refusal == "plan"
      return {"href": pricing, "text": "See the plans"}
    end

    {"href": account, "text": "Add your key in Account"}
  end

  # The JSON body refusing an AI request: the sentence, its `link`
  # (refusal_link), and on "plan" the `upgrade` the plan's other limits
  # answer with (#393).
  static def refusal_answer(refusal, link)
    answer = {
      "error": AiClient.refusal_text(refusal),
      "link": link["href"],
      "link_text": link["text"]
    }
    answer["upgrade"] = link["href"] if refusal == "plan"
    answer
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
      return {
        "url": provider["url"],
        "headers": headers,
        "body": AiClient.anthropic_body(settings, turns)
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

  # Anthropic's Messages API, with the parameters every Claude model takes
  # (the person's model may be any of them).
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
    {
      "model": settings["model"],
      "max_tokens": 32000,
      "messages": messages
    }
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

  # Why a request was refused, in a plain sentence: what the person can do
  # about it (their key, their model), or to try again. The provider's own
  # words go to the logs only.
  static def refused(who, status, body, settings)
    Logger.warn(
      "AI provider refused a request",
      {
        "provider": settings["provider"],
        "model": settings["model"],
        "status": status,
        "said": AiClient.provider_words(body)
      }
    )
    return "#{who} refused your API key. Check it on your account page." if [401, 403].includes?(status)
    if [400, 404, 413, 422].includes?(status)
      return "#{who} could not answer with the model you chose. Try another one on your account page."
    end

    "#{who} could not answer this time. Try again in a moment."
  end

  # The provider's own words in a refusal, for the logs: at most 300
  # characters, "" when it gave none.
  static def provider_words(body)

    # Gemini's compatible endpoint wraps its error in a list.
    body = body[0] if body.is_a?("array") && body.length > 0
    return "" unless body.is_a?("hash") && !body["error"].nil?

    said = body["error"].is_a?("string") ? body["error"] : body["error"]["message"].to_s
    said.substring(0, 300)
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
