\header { title = "Groove rock" subtitle = "position notation: hi-hat on top, snare in the middle, kick at the bottom" composer = "EUI Score example" }
\new Staff \with { instrumentName = "Drums" midiInstrument = "synth drum" }
{
  \time 4/4 \tempo "Rock" 4 = 112
  << { g''8 g'' <c'' g''> g'' g'' g'' <c'' g''> g'' } \\ { f'4 r f'8 f' r4 } >> |
  << { g''8 g'' <c'' g''> g'' g'' g'' <c'' g''> g'' } \\ { f'4 r f'8 f' r4 } >> |
  << { g''8 g'' <c'' g''> g'' g'' g'' <c'' g''> g'' } \\ { f'4 r f'8 f' r4 } >> |
  << { c''16 c'' c'' c'' a' a' a' a' e' e' e' e' <c'' g''>4-> } \\ { f'4 f' f' f' } >> \bar "|."
}
