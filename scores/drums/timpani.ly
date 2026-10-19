\header { title = "Timpani" subtitle = "two drums tuned to G and D" composer = "EUI Score example" }
\new Staff \with { instrumentName = "Timpani" midiInstrument = "timpani" }
{
  \clef bass \key g \major \time 4/4 \tempo "Maestoso" 4 = 88
  g,4\f r d r | g,8 g, g, g, d4 r |
  \tuplet 3/2 { g,8\p g, g, } \tuplet 3/2 { g,8\< g, g, } \tuplet 3/2 { g,8 g, g, } \tuplet 3/2 { g,8 g, g,\! } |
  d4\ff-> g,-> d-> g,-> | g,1\fermata \bar "|."
}
