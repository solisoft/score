\header { title = "Blues in E" subtitle = "a twelve-bar boogie riff (written an octave up)" composer = "EUI Score example" }
\new Staff \with { instrumentName = "Guitar" midiInstrument = "electric guitar (clean)" }
{
  \key e \major \time 4/4 \tempo "Shuffle" 4 = 96
  \repeat volta 2 {
    e8^"E7" gis b cis' d' cis' b gis | e8 gis b cis' d' cis' b gis |
    e8 gis b cis' d' cis' b gis | e8 gis b cis' d' cis' b gis |
    a8^"A7" cis' e' fis' g' fis' e' cis' | a8 cis' e' fis' g' fis' e' cis' |
    e8^"E7" gis b cis' d' cis' b gis | e8 gis b cis' d' cis' b gis |
    b8^"B7" dis' fis' gis' a' gis' fis' dis' | a8^"A7" cis' e' fis' g' fis' e' cis' |
  }
  \alternative {
    { e8^"E7" gis b cis' d' cis' b gis | b8^"B7" dis' fis' gis' a' gis' fis' dis' | }
    { e8^"E7" gis b cis' d' cis' b gis | <e b e' gis' d'' e''>1\fermata | }
  }
  \bar "|."
}
