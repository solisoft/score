\header { title = "Au clair de la lune" subtitle = "voice and piano" composer = "French folk song" arranger = "harmony: EUI Score example" }
<<
  \new Staff \with { instrumentName = "Voice" midiInstrument = "voice oohs" } \relative c'' {
    \key g \major \time 4/4 \tempo "Moderato" 4 = 92
    g4 g g a | b2 a | g4 b a a | g1 \bar "|."
  }
  \addlyrics { Au clair de la lu -- ne, mon a -- mi Pier -- rot }
  \new PianoStaff \with { instrumentName = "Piano" } <<
    \new Staff {
      \key g \major \time 4/4
      <b d' g'>2\p <a d' fis'> | <b d' g'>2 <a d' fis'> | <b d' g'>4 <d' g'> <c' d' fis'>2 | <b d' g'>1 \bar "|."
    }
    \new Staff {
      \clef bass \key g \major \time 4/4
      g,2 d | g, d | g,4 b, d2 | g,1 \bar "|."
    }
  >>
>>
