# Reads a photo of printed or handwritten music into LilyPond, with the AI
# model of the person's account or the server's (AiClient). The browser
# sends the picture here, and gets LilyPond back.
#
# What the model writes is engraved before it is handed on; when the engraver
# refuses it, the model is asked once more, with the engraver's words.

const SCORE_READER_EDGE = 2576
const SCORE_READER_BYTES = 7000000

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

    problem = AiClient.problem(first["source"])
    return first if problem.nil?

    second = ScoreReader.ask(picture, settings, first["source"], problem)
    return second unless second["error"].nil?

    unreadable = {"error": "The picture could not be read as music the engraver takes."}
    return unreadable unless AiClient.problem(second["source"]).nil?

    second
  end

  # One call to the model, then the source in its answer.
  static def ask(picture, settings, previous, problem)
    ScoreReader.source_of(AiClient.ask(settings, ScoreReader.turns(picture, previous, problem)))
  end

  # The conversation: the picture and the instructions; on the second try,
  # the first answer and what the engraver said of it.
  static def turns(picture, previous, problem)
    turns = [{
      "role": "user",
      "image": picture,
      "text": SCORE_READER_PROMPT.trim
    }]
    return turns if previous.nil?

    again = "The engraver refused that: #{problem}. Write the whole source again, corrected, LilyPond only."
    turns + [{"role": "assistant", "text": previous}, {
      "role": "user",
      "text": again
    }]
  end

  # The model's answer as a source: {"source": …} or {"error": …}.
  static def source_of(answer)
    return answer unless answer["error"].nil?

    source = ScoreReader.unfenced(answer["text"])
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
end
