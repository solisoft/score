\header { title = "Percussion Ensemble" subtitle = "one staff per instrument" composer = "EUI Score example" }
\new StaffGroup <<
  \new Staff \with { instrumentName = "Woodblock" shortInstrumentName = "Wb." midiInstrument = "woodblock" } {
    \time 4/4 \tempo "Allegro" 4 = 120
    c''8-. c''-. r c''-. r c''-. c''4-> | c''8-. c''-. r c''-. r c''-. c''4-> | \tuplet 3/2 { c''8 c'' c'' } c''4 \tuplet 3/2 { c''8 c'' c'' } c''4 | c''1\fermata \bar "|."
  }
  \new Staff \with { instrumentName = "Steel drum" shortInstrumentName = "St." midiInstrument = "steel drums" } {
    \key c \major \time 4/4
    e''4 g''8 e'' c''4 d'' | e''4 g''8 a'' g''4 e'' | d''8 e'' f'' d'' c''4 g' | c''1\fermata \bar "|."
  }
  \new Staff \with { instrumentName = "Taiko" shortInstrumentName = "Tk." midiInstrument = "taiko drum" } {
    \clef bass \time 4/4
    c4\f r c c | c4 r c8 c c4 | c4 c c c | c1\fermata \bar "|."
  }
>>
