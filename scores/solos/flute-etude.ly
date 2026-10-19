\header { title = "Triplet Etude" subtitle = "for flute" composer = "EUI Score example" }
\new Staff \with { instrumentName = "Flute" midiInstrument = "flute" }
\relative c'' {
  \key g \major \time 2/4 \tempo "Vivace" 4 = 120
  \tuplet 3/2 { g8\mp( b d } \tuplet 3/2 { g d b) } | \tuplet 3/2 { a8( c e } \tuplet 3/2 { a e c) } |
  \tuplet 3/2 { b8( d g } \tuplet 3/2 { b g d) } | c4-. a-. |
  \tuplet 3/2 4 { d8\<( c b a g fis } | g8-. a-. b-. c-.\! | d4-> d,-> | g2\f\fermata \bar "|."
}
