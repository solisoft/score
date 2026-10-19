\header { title = "Chorale for Chamber Orchestra" subtitle = "woodwinds and strings, nested groups" composer = "EUI Score example" }
<<
  \new StaffGroup <<
    \new Staff \with { instrumentName = "Flute" shortInstrumentName = "Fl." midiInstrument = "flute" } {
      \key g \major \time 3/4 \tempo "Andante" 4 = 76
      d''2.\p | e''4( d'' c'') | b'2( a'4) | g'2.\fermata \bar "|."
    }
    \new Staff \with { instrumentName = "Oboe" shortInstrumentName = "Ob." midiInstrument = "oboe" } {
      \key g \major \time 3/4
      b'2.\p | c''4( b' a') | g'2( fis'4) | g'2.\fermata \bar "|."
    }
  >>
  \new StaffGroup <<
    \new Staff \with { instrumentName = "Violins" shortInstrumentName = "Vl." midiInstrument = "string ensemble 1" } {
      \key g \major \time 3/4
      g'4\pp( a' b') | c''2 e'4 | d'2 c'4 | b2.\fermata \bar "|."
    }
    \new Staff \with { instrumentName = "Violas" shortInstrumentName = "A." midiInstrument = "viola" } {
      \clef alto \key g \major \time 3/4
      d'2.\pp | e'4 g' a' | b2 d'4 | d'2.\fermata \bar "|."
    }
    \new Staff \with { instrumentName = "Cellos" shortInstrumentName = "Vc." midiInstrument = "cello" } {
      \clef bass \key g \major \time 3/4
      g,2.\pp | c4 e a, | d2 d,4 | g,2.\fermata \bar "|."
    }
  >>
>>
