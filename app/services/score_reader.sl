# Reads a photo of printed or handwritten music into LilyPond, with an AI
# model that sees images: the server's Claude Opus (ANTHROPIC_API_KEY), or the
# provider, model and key a person set on their account (User#ai_settings).
# Keys stay on the server: the browser sends the picture here, and gets
# LilyPond back.
#
# What the model writes is engraved before it is handed on; when the engraver
# refuses it, the model is asked once more, with the engraver's words.

const SCORE_READER_MODEL = "claude-opus-5-5"
const SCORE_READER_EDGE = 2576
const SCORE_READER_BYTES = 7000000

# The providers a person may bring a key for. "anthropic" speaks Anthropic's
# Messages API; "openai" the chat-completions API the others share. `models`
# are suggestions: any model of the provider that reads images will do.
const SCORE_READER_PROVIDERS = {
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

const SCORE_READER_PROMPT = """
Transcribe the music in this picture into LilyPond, for the EUI Score engraver.

Write the notes, rests, durations, ties, slurs, dynamics, articulations, clefs,
key and time signatures, tempo, lyrics and chord symbols you can read. Keep
each staff of the picture as a staff, inside one \score with a \new Staff (or a
\new PianoStaff / \new ChoirStaff) per part, and use \relative only if it makes
the music shorter. Put the title and composer, when the picture shows them, in a
\header block. Leave out what you cannot read rather than guess it.

Answer with the LilyPond source only: no explanation, no Markdown fence.
"""

class ScoreReader
  # The server's own key: Claude Opus for whoever has no key of their own.
  static def available?
    getenv("ANTHROPIC_API_KEY").present?
  end

  # What the server reads with, as User#ai_settings answers for a person.
  static def server_settings
    {
      "provider": "anthropic",
      "model": SCORE_READER_MODEL,
      "key": getenv("ANTHROPIC_API_KEY").to_s,
      "own": false
    }
  end

  # The provider's name as a page says it.
  static def provider_name(provider)
    SCORE_READER_PROVIDERS[provider]&.name ?? provider
  end

  # A picture as the models take it: a JPEG no longer than SCORE_READER_EDGE
  # on its long side, as base64; or nil when the bytes are not a picture.
  static def picture(data)
    image = Image.from_buffer(data) rescue nil
    return nil if image.nil?

    image = image.thumbnail(SCORE_READER_EDGE) if [image.width, image.height].max() > SCORE_READER_EDGE
    image.format("jpeg").quality(90).to_buffer
  end

  # The picture, read with `settings`: {"source": LilyPond} or {"error": …}.
  static def read(picture, settings)
    first = ScoreReader.ask(picture, settings, nil, nil)
    return first unless first["error"].nil?

    problem = ScoreReader.problem(first["source"])
    return first if problem.nil?

    second = ScoreReader.ask(picture, settings, first["source"], problem)
    return second unless second["error"].nil?

    unreadable = {"error": "The picture could not be read as music the engraver takes."}
    return unreadable unless ScoreReader.problem(second["source"]).nil?

    second
  end

  # One call to the model, then its answer.
  static def ask(picture, settings, previous, problem)
    request = ScoreReader.request(picture, settings, previous, problem)
    response = HTTP.request("POST", request["url"], request["headers"], JSON.stringify(request["body"])) rescue nil
    ScoreReader.answer(response, settings)
  end

  # The request for `settings`' provider: its URL, headers and body.
  static def request(picture, settings, previous, problem)
    provider = SCORE_READER_PROVIDERS[settings["provider"]]
    if provider["api"] == "anthropic"
      headers = {
        "x-api-key": settings["key"],
        "anthropic-version": "2026-10-21",
        "content-type": "application/json",
        "timeout": 300
      }
      body = ScoreReader.anthropic_body(picture, settings, previous, problem)
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
      "body": ScoreReader.chat_body(picture, settings, previous, problem)
    }
  end

  # Anthropic's Messages API: the picture and the instructions; on the second
  # try, the first answer and what the engraver said of it. The server's Opus
  # thinks hard and may fall back; a person's own Claude model gets the
  # parameters every Claude model takes.
  static def anthropic_body(picture, settings, previous, problem)
    messages = [{"role": "user", "content": [
      {"type": "image", "source": {
        "type": "base64",
        "media_type": "image/jpeg",
        "data": picture
      }},
      {"type": "text", "text": SCORE_READER_PROMPT.trim}
    ]}]
    ScoreReader.retry_messages(previous, problem).each do |message|
      messages.push(message)
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
  static def chat_body(picture, settings, previous, problem)
    messages = [{"role": "user", "content": [
      {"type": "text", "text": SCORE_READER_PROMPT.trim},
      {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,#{picture}"}}
    ]}]
    ScoreReader.retry_messages(previous, problem).each do |message|
      messages.push(message)
    end
    {"model": settings["model"], "messages": messages}
  end

  # The second try's turns: the first answer, then the engraver's words.
  static def retry_messages(previous, problem)
    return [] if previous.nil?

    again = "The engraver refused that: #{problem}. Write the whole source again, corrected, LilyPond only."
    [{"role": "assistant", "content": previous}, {
      "role": "user",
      "content": again
    }]
  end

  # The model's response, read: {"source": …} or {"error": …}. Nil is a
  # request that never got an answer.
  static def answer(response, settings)
    who = ScoreReader.provider_name(settings["provider"])
    return {"error": "#{who} could not be reached. Try again in a moment."} if response.nil?

    status = response["status"]
    body = JSON.parse(response["body"].to_s) rescue nil
    return {"error": "#{who} is busy. Try again in a moment."} if [429, 529].includes?(status) || status >= 500
    if status != 200
      return {"error": ScoreReader.refused(who, status, body, settings)}
    end

    return {"error": "#{who}'s answer could not be read."} if body.nil?

    anthropic = SCORE_READER_PROVIDERS[settings["provider"]]["api"] == "anthropic"
    text = anthropic ? ScoreReader.anthropic_text(body) : ScoreReader.chat_text(body)
    return {"error": "#{who} declined to read this picture."} if text.nil?

    source = ScoreReader.unfenced(text)
    return {"error": "No music was found in the picture."} if source.blank?

    {"source": source}
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

  # The source without a Markdown fence around it, should one come anyway.
  static def unfenced(text)
    lines = text.trim.split("\n")
    return text.trim if lines.length == 0 || !lines[0].starts_with?("```")

    lines = lines.slice(1, lines.length)
    if lines.length > 0 && lines[lines.length - 1].trim.starts_with?("```")
      lines = lines.slice(0, lines.length - 1)
    end
    lines.join("\n").trim
  end

  # What the engraver says against `source`, or nil when it engraves.
  static def problem(source)
    laid = eui_score_layout(source, 160, {}) rescue {"error": "it could not be engraved"}
    laid["error"]
  end
end
