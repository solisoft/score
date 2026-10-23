# The editor's AI assistant: chord symbols for a melody, a harmonization,
# improvements, or what the person asks, done to a score by the AI model of
# their account or the server's (AiClient). It answers an explanation for a
# musician and the whole new score; the score is engraved before it is
# handed on, and the model asked once more with the engraver's words when it
# is refused. Nothing changes in the score until the person applies it.

const SCORE_ASSISTANT_SOURCE_LIMIT = 60000

const SCORE_ASSISTANT_TASKS = {
  "chords": "Add chord symbols to the melody, the harmony moving at a pace that suits the tune, "
  + "in a style that suits it. Do not change any note.",
  "harmonize": "Harmonize the melody: keep it exactly as it is, and write an accompaniment under it, "
  + "a piano part (\\new PianoStaff) unless the request names other voices or instruments. "
  + "Follow good voice leading, and add chord symbols when they help.",
  "improve": "Suggest improvements to this score (melody, harmony, voice leading, rhythm, dynamics, "
  + "articulations, phrasing) and apply the ones you are surest of. "
  + "In the explanation, name each change with its bar number.",
  "ask": "Do what the request asks with this score."
}

const SCORE_ASSISTANT_PROMPT = """
You are a music arranger. Here is a score, in LilyPond, for the EUI Score engraver:

```lilypond
{SOURCE}
```

{TASK}
{REQUEST}
Answer with a short explanation for a musician, in the language of the request
(English when there is none): what you did and why, in a few sentences or a
short list. Then write the whole new score as one ```lilypond block. Keep the
\header, the parts and every bar you were not asked to change. Write only
LilyPond the engraver reads: \score, \new Staff, \new PianoStaff,
\new ChoirStaff, \relative, \key, \time, \clef, \tempo, dynamics, slurs,
ties, \addlyrics, voices with << { … } \\ { … } >>. Write a chord symbol as
a mark above the melody note it starts on, c'4^"Am7" (the editor reads them
so), never as a \new ChordNames staff.
"""

class ScoreAssistant
  static def actions
    SCORE_ASSISTANT_TASKS.keys
  end

  # `action` done to `source` with `settings`: {"source", "explanation"} or
  # {"error"}.
  static def suggest(source, action, request, settings)
    turns = ScoreAssistant.turns(source, action, request)
    first = ScoreAssistant.parsed(AiClient.ask(settings, turns))
    return first unless first["error"].nil?

    problem = AiClient.problem(first["source"])
    return first if problem.nil?

    again = turns + [
      {"role": "assistant", "text": first["raw"]},
      {"role": "user", "text": "The engraver refused that score: #{problem}. Answer again, the whole score corrected."}
    ]
    second = ScoreAssistant.parsed(AiClient.ask(settings, again))
    return second unless second["error"].nil?

    unengraved = {"error": "The AI's score could not be engraved. Try again, or ask differently."}
    return unengraved unless AiClient.problem(second["source"]).nil?

    second
  end

  # The first message: the score, the task, the person's request.
  static def turns(source, action, request)
    asked = request.to_s.trim.blank? ? "" : "The request: #{request.to_s.trim}\n"
    text = SCORE_ASSISTANT_PROMPT.trim.replace("{SOURCE}", source.trim).replace(
      "{TASK}",
      SCORE_ASSISTANT_TASKS[action]
    ).replace("{REQUEST}", asked)
    [{"role": "user", "text": text}]
  end

  # The model's answer split: the explanation before its first ``` fence,
  # the score in its last ```lilypond block. {"source", "explanation",
  # "raw"} or {"error"}.
  static def parsed(answer)
    return answer unless answer["error"].nil?

    text = answer["text"].to_s
    pieces = text.split("```")
    fenced = (0 .. pieces.length).filter do |i|
      i % 2 == 1 && (pieces[i].starts_with?("lilypond") || pieces[i].starts_with?("ly\n"))
    end
    return {"error": "The AI answered without a score. Try again, or ask differently."} if fenced.length == 0

    block = pieces[fenced[fenced.length - 1]]
    body = block.substring(block.index_of("\n") + 1, block.length).trim
    return {"error": "The AI answered without a score. Try again, or ask differently."} if body.blank?

    {
      "source": body,
      "explanation": pieces[0].trim,
      "raw": text
    }
  end
end
