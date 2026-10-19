\header { title = "Arpeggios in A minor" subtitle = "guitar — written an octave above how it sounds" composer = "EUI Score example" }
\new Staff \with { instrumentName = "Guitar" midiInstrument = "acoustic guitar (nylon)" }
{
  \key a \minor \time 3/4 \tempo "Andante" 4 = 80
  a8^"Am" e' a' c'' e'' c'' | d'8^"Dm" a' d'' f'' a'' f'' | e8^"E7" b d'' gis'' e'' d'' | a8^"Am" e' a' c'' e''4 |
  f8^"F" c' f' a' c'' a' | d'8^"Dm" a' d'' f'' a'' f'' | e8^"E" b e'' gis'' b'' gis'' | <a e' a' c'' e''>2.^"Am"\fermata \bar "|."
}
