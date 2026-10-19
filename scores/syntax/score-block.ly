\version "2.24.4"
\score {
  \new Staff \with { instrumentName = "Flute" midiInstrument = "flute" } \relative c'' {
    \time 2/4 c8 d e f | g4 g | a8 a a a | g2 \bar "|."
  }
  \layout { }
  \midi { }
}
