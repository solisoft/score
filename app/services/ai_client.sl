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
# The longest wait for the next piece of a streamed answer, in seconds: a
# model thinking for minutes sends its thoughts, or keep-alives, meanwhile
# (#435). Not the whole answer's: that runs as long as pieces come.
const AI_STREAM_IDLE = 180
# How often a streamed answer is told to whoever follows it, in seconds.
const AI_PROGRESS_EVERY = 2
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
  # The answer is streamed (#435): read as it comes, with no limit on the
  # whole but AI_STREAM_IDLE between pieces, and `progress(phase, text)` told
  # every AI_PROGRESS_EVERY seconds — "thinking" before the first words, then
  # "writing" with the text so far.
  static def ask(settings, turns, progress = nil)
    return AiClient.ask_whole(settings, turns) unless AiClient.streams?

    request = AiClient.request(settings, turns, true)
    # Through `send`: a Soli without HTTP.stream (before 2.28.9's #435
    # rebuild) refuses the name itself when the file loads.
    stream = HTTP.send("stream", "POST", request["url"], request["headers"], JSON.stringify(request["body"])) rescue nil
    return AiClient.answer(nil, settings) if stream.nil?

    AiClient.streamed(stream, settings, progress)
  end

  # Whether this Soli reads an answer as it comes (HTTP.stream).
  static def streams?
    HTTP.respond_to?("stream")
  end

  # The conversation asked the way a Soli without HTTP.stream can: the whole
  # answer awaited, at most 300 seconds.
  static def ask_whole(settings, turns)
    request = AiClient.request(settings, turns)
    response = HTTP.request("POST", request["url"], request["headers"], JSON.stringify(request["body"])) rescue nil
    AiClient.answer(response, settings)
  end

  # A streamed answer read to its end: {"text": …} or {"error": …}. `stream`
  # answers `status`, `next_line` (nil at the end) and may raise.
  static def streamed(stream, settings, progress = nil)
    progress ||= fn(phase, text) { nil }
    unless stream.status == 200
      body = AiClient.rest_of(stream)
      return AiClient.answer(
        {"status": stream.status, "body": body},
        settings
      )
    end

    who = AiClient.provider_name(settings["provider"])
    anthropic = AI_PROVIDERS[settings["provider"]]["api"] == "anthropic"
    read = {
      "text": "",
      "refused": false,
      "failed": nil,
      "told": 0,
      "done": false
    }
    try
      line = stream.next_line
      while !line.nil?
        AiClient.took(read, AiClient.stream_delta(line, anthropic), progress)
        line = read["done"] ? nil : stream.next_line
      end
    catch error
      Logger.warn(
        "AI answer broke off",
        {"provider": settings["provider"], "said": error.to_s.substring(0, 300)}
      )
      return {"error": "#{who} stopped answering. Try again in a moment."}
    end
    unless read["failed"].nil?
      Logger.warn(
        "AI provider failed a streamed answer",
        {"provider": settings["provider"], "said": read["failed"]}
      )
      return {"error": "#{who} could not answer this time. Try again in a moment."}
    end
    return {"error": "#{who} declined the request."} if read["refused"]

    {"text": read["text"]}
  end

  # One line's `delta` (stream_delta) added to what is `read` so far, and
  # `progress` told once AI_PROGRESS_EVERY seconds have passed since it was
  # last told.
  static def took(read, delta, progress)
    unless delta.nil?
      read["text"] = read["text"] + delta["text"] unless delta["text"].nil?
      read["refused"] = true if delta["refused"]
      read["failed"] = delta["error"] unless delta["error"].nil?
      read["done"] = true if delta["done"]
    end
    now = DateTime.utc.to_unix
    return nil if now - read["told"] < AI_PROGRESS_EVERY

    read["told"] = now
    progress(read["text"].blank? ? "thinking" : "writing", read["text"])
  end

  # What is left of a stream, its lines joined: a refusal's body.
  static def rest_of(stream)
    lines = []
    try
      line = stream.next_line
      while !line.nil?
        lines.push(line)
        line = stream.next_line
      end
    catch error
      return lines.join("\n")
    end
    lines.join("\n")
  end

  # One line of a streamed answer, read: {"text"} its words, {"refused"},
  # {"error"} the provider's words, {"done"}, or nil for anything else (an
  # event's name, a blank line, a thought, a keep-alive). Anthropic's
  # Messages events when `anthropic`, else the chat-completions chunks.
  static def stream_delta(line, anthropic)
    return nil unless line.starts_with?("data:")

    data = line.substring(5, line.length).trim
    return {"done": true} if data == "[DONE]"

    event = JSON.parse(data) rescue nil
    return nil unless event.is_a?("hash")

    anthropic ? AiClient.anthropic_delta(event) : AiClient.chat_delta(event)
  end

  # An event of Anthropic's Messages stream.
  static def anthropic_delta(event)
    kind = event["type"]
    if kind == "content_block_delta" && event["delta"]["type"] == "text_delta"
      return {"text": event["delta"]["text"].to_s}
    end

    return {"refused": true} if kind == "message_delta" && event["delta"]["stop_reason"] == "refusal"
    return {"error": AiClient.provider_words(event)} if kind == "error"
    return {"done": true} if kind == "message_stop"

    nil
  end

  # A chunk of a chat-completions stream.
  static def chat_delta(event)
    return {"error": AiClient.provider_words(event)} unless event["error"].nil?

    choices = event["choices"] ?? []
    return nil if choices.length == 0

    choice = choices[0]
    delta = choice["delta"] ?? {}
    return {"refused": true} if choice["finish_reason"] == "content_filter" || !delta["refusal"].blank?

    content = delta["content"]
    return nil if content.nil?
    return {"text": content.to_s} unless content.is_a?("array")

    {"text": content.map do |part|
      part["text"].to_s
    end.join("")}
  end

  # The request for `settings`' provider: its URL, headers and body; asking
  # for a streamed answer when `stream`, its timeout then the wait between
  # pieces (AI_STREAM_IDLE).
  static def request(settings, turns, stream = false)
    provider = AI_PROVIDERS[settings["provider"]]
    timeout = stream ? AI_STREAM_IDLE : 300
    anthropic = provider["api"] == "anthropic"
    headers = anthropic ? {
      "x-api-key": settings["key"],
      "anthropic-version": "2026-10-21",
      "content-type": "application/json",
      "timeout": timeout
    } : {
      "Authorization": "Bearer #{settings["key"]}",
      "content-type": "application/json",
      "timeout": timeout
    }
    body = anthropic ? AiClient.anthropic_body(settings, turns) : AiClient.chat_body(settings, turns)
    body["stream"] = true if stream
    {
      "url": provider["url"],
      "headers": headers,
      "body": body
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
