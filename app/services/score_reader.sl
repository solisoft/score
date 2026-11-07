# Reads a photo of printed or handwritten music into LilyPond, with the AI
# model of the person's account or the server's (AiClient). The browser
# sends the picture here, and gets LilyPond back.
#
# What the model writes is engraved before it is handed on; when the engraver
# refuses it, the model is asked once more, with the engraver's words.

const SCORE_READER_EDGE = 2576
const SCORE_READER_BYTES = 7000000
# The most pixels a picture sent may have (#684), read from its header
# before it is opened: a few megabytes of PNG can hold a picture of
# gigabytes once decoded. A phone's 48-megapixel photo passes.
const SCORE_READER_PIXELS = 50000000

const SCORE_READER_PROMPT = """
Transcribe the music in this picture into LilyPond, for the eui-score engraver.

Write the notes, rests, durations, ties, slurs, dynamics, articulations, clefs,
key and time signatures, tempo, lyrics and chord symbols you can read. Keep
each staff of the picture as a staff, inside one \score with a \new Staff (or a
\new PianoStaff / \new ChoirStaff) per part, and use \relative only if it makes
the music shorter. Put the title and composer, when the picture shows them, in a
\header block. Leave out what you cannot read rather than guess it.
"""

# The signs of form and ornament the picture may show, each as the engraver
# reads it (#432): the model is shown these forms, and a spec engraves every
# example, so the list cannot name one the engraver refuses.
const SCORE_READER_FORMS = [
  [
    "a repeated passage, with its first and second endings if any",
    "\\repeat volta 2 { c4 d e f } \\alternative { { g2 g } { a1 } }"
  ],
  ["a segno sign and a coda sign over the bar line", "\\segnoMark c1 \\codaMark d1"],
  ["D.S. al Coda, D.C. al Fine, D.S., D.C., after the bar that shows it", "c1 \\jump \"D.S. al Coda\""],
  ["Fine, where the piece may end", "c1 \\fine"],
  ["To Coda, over its note", "c1^\"To Coda\""],
  ["a double bar line and the final one", "c1 \\bar \"||\" d1 \\bar \"|.\""],
  ["a rehearsal mark", "\\mark \\default c1"],
  ["a section's double bar line and its name", "c1 \\section \\sectionLabel \"Trio\" d1"],
  ["a triplet or another tuplet", "\\tuplet 3/2 { c8 d e } f4"],
  ["grace notes", "\\acciaccatura d8 c4 \\appoggiatura e8 d4 \\grace { c16 d } e2"],
  ["a trill, a mordent, a short trill, a turn, a fermata", "c4\\trill d\\mordent e\\prall f\\turn g1\\fermata"],
  ["a tremolo", "c2:16 d:32"],
  ["8va and 8vb lines", "\\ottava 1 c4 d \\ottava 0 e f \\ottava -1 g1 \\ottava 0"],
  ["the sustain pedal", "c4\\sustainOn d e f\\sustainOff"],
  ["fingering, bowing and an arpeggio", "c4-1 d\\downbow e\\upbow <c e g>\\arpeggio"],
  ["a harmonic's diamond head", "c4\\harmonic <c g'\\harmonic>2."],
  ["two voices on one staff", "<< { c4 d e f } \\\\ { a,2 b } >>"]
]

# The note names the engraver reads with no \language: a model often writes
# English ones (bf), and the reading fails on them.
const SCORE_READER_NAMES = """
Write the note names in Dutch, LilyPond's own: c d e f g a b, cis for C sharp,
bes for B flat, ees for E flat. Use English names (cs, bf) only after a
\language "english" line.

Answer with the LilyPond source only: no explanation, no Markdown fence.
"""

class ScoreReader
  # A picture as the models take it: a JPEG no longer than SCORE_READER_EDGE
  # on its long side, as base64; or nil when the bytes are not a picture,
  # or one past SCORE_READER_PIXELS — told by its header, before it is
  # decoded (#684).
  static def picture(data)
    size = ScoreReader.dimensions(data)
    return nil if size.nil? || size[0] * size[1] > SCORE_READER_PIXELS

    image = Image.from_buffer(data) rescue nil
    return nil if image.nil?

    image = image.thumbnail(SCORE_READER_EDGE) if [image.width, image.height].max() > SCORE_READER_EDGE
    image.format("jpeg").quality(90).to_buffer
  end

  # [width, height] of the picture in `data` (base64), read from its header
  # alone, never decoded: a PNG's, a WebP's, a JPEG's — the pictures the
  # site says it reads; nil for anything else, or a header that does not say.
  static def dimensions(data)
    head = ScoreReader.bytes_at(data, 0, 30)
    return nil if head.nil? || head.length < 30
    if head.slice(0, 8) == [
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10
    ]
      return ScoreReader.png_size(head)
    end

    # "RIFF", then "WEBP".
    if head.slice(0, 4) == [
      82,
      73,
      70,
      70
    ] && head.slice(8, 12) == [
      87,
      69,
      66,
      80
    ]
      return ScoreReader.webp_size(head)
    end

    return ScoreReader.jpeg_size(data) if head[0] == 255 && head[1] == 216

    nil
  end

  # `count` bytes of the base64 `data` from byte `offset`, decoding only the
  # few characters that hold them; nil when they are not base64.
  static def bytes_at(data, offset, count)
    first = offset / 3 * 4
    skip = offset % 3
    chunk = data.to_s.substring(first, first + (skip + count + 2) / 3 * 4)
    decoded = Base64.decode(chunk) rescue nil
    return nil if decoded.nil?

    # Bytes that happen to be UTF-8 come back as a string.
    bytes = type(decoded) == "string" ? decoded.bytes() : decoded
    bytes.slice(skip, skip + count)
  end

  # A PNG's size: its IHDR, the first chunk, gives it.
  static def png_size(head)
    [ScoreReader.big_endian(head.slice(16, 20)), ScoreReader.big_endian(head.slice(20, 24))]
  end

  # A WebP's size, from its first chunk: "VP8 " (lossy), "VP8L" (lossless)
  # or "VP8X" (extended).
  static def webp_size(head)
    chunk = head.slice(12, 16)
    if chunk == [86, 80, 56, 32]
      return [head[26] + head[27] % 64 * 256, head[28] + head[29] % 64 * 256]
    end

    if chunk == [86, 80, 56, 76]
      width = 1 + head[21] + head[22] % 64 * 256
      height = 1 + head[22] / 64 + head[23] * 4 + head[24] % 16 * 1024
      return [width, height]
    end
    if chunk == [86, 80, 56, 88]
      return [1 + head[24] + head[25] * 256 + head[26] * 65536, 1 + head[27] + head[28] * 256
      + head[29] * 65536]
    end

    nil
  end

  # A JPEG's size, from its frame header (SOF): its segments are walked by
  # their lengths, each read on its own, up to the frame's or the scan's.
  static def jpeg_size(data)
    total = data.to_s.length / 4 * 3
    at = 2
    steps = 0
    while at + 9 <= total && steps < 1000
      steps += 1
      part = ScoreReader.bytes_at(data, at, 9)
      return nil if part.nil? || part.length < 9 || part[0] != 255

      marker = part[1]
      # A fill byte before a marker.
      if marker == 255
        at += 1
        next
      end
      # A frame header, but for DHT (196), JPG (200) and DAC (204).
      if marker >= 192 && marker <= 207 && ![
        196,
        200,
        204
      ].includes?(marker)
        return [part[7] * 256 + part[8], part[5] * 256 + part[6]]
      end

      # The scan starts, or the picture ends, with no frame said.
      return nil if marker == 218 || marker == 217

      standalone = marker == 1 || (marker >= 208 && marker <= 216)
      at += standalone ? 2 : 2 + part[2] * 256 + part[3]
    end
    nil
  end

  # The number `bytes` write, most significant first.
  static def big_endian(bytes)
    bytes.reduce(fn(total, byte) { total * 256 + byte }, 0)
  end

  # The LilyPond an AI is still writing, made whole enough to engrave (#462):
  # cut after its last bar line (else its last line), then each `{` and `<<`
  # still open there closed, innermost first. "" when nothing whole is
  # written yet.
  static def closed_draft(draft)
    chars = ScoreReader.unfenced(draft.to_s).chars()
    marks = ScoreReader.marks(chars)
    cut = ScoreReader.whole_up_to(marks)
    return "" if cut <= 0

    text = chars.slice(0, cut).join("")
    return "" if text.trim.blank?

    open = []
    marks.filter do |mark|
      mark["at"] < cut
    end.each do |mark|
      token = mark["token"]
      open.push(token == "{" ? "}" : ">>") if ["{", "<<"].includes?(token)
      open.pop() if ["}", ">>"].includes?(token) && open.length > 0
    end
    text + "\n" + open.reverse().join(" ") + "\n"
  end

  # The marks of `chars` that tell where it stands, outside strings and
  # comments: [{"at", "token"}], token one of | (a bar line), a line's end,
  # { } << >>.
  static def marks(chars)
    out = []
    mode = "code"
    at = 0
    while at < chars.length
      c = chars[at]
      pair = at + 1 < chars.length ? c + chars[at + 1] : c
      if mode == "string"
        at += 1 if c == "\\"
        mode = "code" if c == "\""
      elsif mode == "comment"
        if c == "\n"
          out.push({"at": at, "token": c})
        end
        mode = "code" if c == "\n"
      else
        mode = {"\"": "string", "%": "comment"}[c] ?? "code"
        token = ["<<", ">>"].includes?(pair) ? pair : c
        if ["|", "\n", "{", "}", "<<", ">>"].includes?(token)
          out.push({"at": at, "token": token})
        end
        at += token.length - 1
      end
      at += 1
    end
    out
  end

  # Where a draft is whole up to, from its marks: after its last bar line,
  # else at its last line's end; 0 when neither.
  static def whole_up_to(marks)
    bars = marks.filter do |mark|
      mark["token"] == "|"
    end
    lines = marks.filter do |mark|
      mark["token"] == "\n"
    end
    bar = bars.length > 0 ? bars.last["at"] + 1 : 0
    line = lines.length > 0 ? lines.last["at"] : 0
    [bar, line].max()
  end

  # What the AI has written so far, engraved (#462): the SVG, or nil when
  # the draft cannot be made whole yet.
  static def draft_svg(draft)
    closed = ScoreReader.closed_draft(draft)
    return nil if closed.blank?

    engraved = ScoreSvg.engrave(closed, 1000, 7, 0, {})
    engraved["error"].nil? ? engraved["svg"] : nil
  end

  # The picture, read with `settings`: {"source": LilyPond} or {"error": …}.
  # `progress(phase, text)` is told as the answer comes (AiClient.ask, #435).
  static def read(picture, settings, progress = nil)
    first = ScoreReader.ask(picture, settings, nil, nil, progress)
    return first unless first["error"].nil?

    problem = AiClient.problem(first["source"])
    return first if problem.nil?

    second = ScoreReader.ask(picture, settings, first["source"], problem, progress)
    return second unless second["error"].nil?

    unreadable = {"error": "The picture could not be read as a score. Try a sharper photo."}
    return unreadable unless AiClient.problem(second["source"]).nil?

    second
  end

  # One call to the model, then the source in its answer.
  static def ask(picture, settings, previous, problem, progress = nil)
    ScoreReader.source_of(AiClient.ask(settings, ScoreReader.turns(picture, previous, problem), progress))
  end

  # What the model is asked: what to read, the signs of form and ornament in
  # the forms the engraver reads, and the note names it reads.
  static def instructions
    forms = SCORE_READER_FORMS.map do |form|
      "- #{form[0]}: #{form[1]}"
    end.join("\n")
    intro = "Write the signs of form and ornament you see too, in these forms:"
    [SCORE_READER_PROMPT.trim, "#{intro}\n#{forms}", SCORE_READER_NAMES.trim].join("\n\n")
  end

  # The conversation: the picture and the instructions; on the second try,
  # the first answer and what the engraver said of it.
  static def turns(picture, previous, problem)
    turns = [{
      "role": "user",
      "image": picture,
      "text": ScoreReader.instructions
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
