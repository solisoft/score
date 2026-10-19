\header { title = "Sixteenth-Note Funk Groove" composer = "EUI Score example" }
\new Staff \with { instrumentName = "Drums" midiInstrument = "synth drum" }
{
  \time 4/4 \tempo "Funk" 4 = 96
  << { g''16 g'' g'' g'' <c'' g''>16-> g'' g'' c'' g''16 c'' g'' g'' <c'' g''>16-> g'' g'' g'' } \\ { f'8. f'16 r4 r8 f'8 r4 } >> |
  << { g''16 g'' g'' g'' <c'' g''>16-> g'' g'' c'' g''16 c'' g'' g'' <c'' g''>16-> g'' c'' c'' } \\ { f'8. f'16 r4 r16 f'8 f'16 r4 } >> \bar "|."
}
