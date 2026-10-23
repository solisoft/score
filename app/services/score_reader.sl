# Reads a photo of printed or handwritten music into LilyPond, with Claude
# Opus. The key (ANTHROPIC_API_KEY) stays on the server: the browser sends the
# picture here, and gets LilyPond back.
#
# What Claude writes is engraved before it is handed on; when the engraver
# refuses it, Claude is asked once more, with the engraver's words.

const SCORE_READER_MODEL = "claude-opus-5-5"
const SCORE_READER_URL = "https://api.anthropic.com/v1/messages"
const SCORE_READER_EDGE = 2576
const SCORE_READER_BYTES = 7000000
const SCORE_READER_PER_DAY = 20

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
  # A key to call Claude with: without one, the feature says it is not there.
  static def available?
    getenv("ANTHROPIC_API_KEY").present?
  end

  # A picture as Claude takes it: a JPEG no longer than SCORE_READER_EDGE on
  # its long side, as base64; or nil when the bytes are not a picture.
  static def picture(data)
    image = Image.from_buffer(data) rescue nil
    return nil if image.nil?

    image = image.thumbnail(SCORE_READER_EDGE) if [image.width, image.height].max() > SCORE_READER_EDGE
    image.format("jpeg").quality(90).to_buffer
  end

  # The picture, read: {"source": LilyPond} or {"error": what went wrong}.
  static def read(picture)
    first = ScoreReader.ask(picture, nil, nil)
    return first unless first["error"].nil?

    problem = ScoreReader.problem(first["source"])
    return first if problem.nil?

    second = ScoreReader.ask(picture, first["source"], problem)
    return second unless second["error"].nil?

    unreadable = {"error": "The picture could not be read as music the engraver takes."}
    return unreadable unless ScoreReader.problem(second["source"]).nil?

    second
  end

  # One call to Claude, then its answer.
  static def ask(picture, previous, problem)
    response = HTTP.request(
      "POST",
      SCORE_READER_URL,
      {
        "x-api-key": getenv("ANTHROPIC_API_KEY").to_s,
        "anthropic-version": "2026-10-21",
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "content-type": "application/json",
        "timeout": 300
      },
      JSON.stringify(ScoreReader.request_body(picture, previous, problem))
    ) rescue nil
    ScoreReader.answer(response)
  end

  # The request: the picture and the instructions; on the second try, the
  # first answer and what the engraver said of it.
  static def request_body(picture, previous, problem)
    messages = [{"role": "user", "content": [
      {"type": "image", "source": {
        "type": "base64",
        "media_type": "image/jpeg",
        "data": picture
      }},
      {"type": "text", "text": SCORE_READER_PROMPT.trim}
    ]}]
    unless previous.nil?
      messages.push({"role": "assistant", "content": previous})
      again = "The engraver refused that: #{problem}. Write the whole source again, corrected, LilyPond only."
      messages.push({"role": "user", "content": again})
    end
    {
      "model": SCORE_READER_MODEL,
      "max_tokens": 32000,
      "thinking": {"type": "adaptive"},
      "output_config": {"effort": "high"},
      "fallbacks": "default",
      "messages": messages
    }
  end

  # Claude's response, read: {"source": …} or {"error": …}. Nil is a
  # request that never got an answer.
  static def answer(response)
    return {"error": "Claude could not be reached. Try again in a moment."} if response.nil?

    status = response["status"]
    return {"error": "Claude is busy. Try again in a moment."} if [429, 529].includes?(status) || status >= 500
    return {"error": "Claude refused the request (#{status})."} if status != 200

    body = JSON.parse(response["body"].to_s) rescue nil
    return {"error": "Claude's answer could not be read."} if body.nil?
    return {"error": "Claude declined to read this picture."} if body["stop_reason"] == "refusal"

    text = (body["content"] ?? []).filter do |block|
      block["type"] == "text"
    end.map do |block|
      block["text"]
    end.join("")
    source = ScoreReader.unfenced(text)
    return {"error": "No music was found in the picture."} if source.blank?

    {"source": source}
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
