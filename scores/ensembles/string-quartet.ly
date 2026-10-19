\header { title = "Canon in D" subtitle = "for string quartet (opening)" composer = "Johann Pachelbel" }
\new StaffGroup <<
  \new Staff \with { instrumentName = "Violin I" shortInstrumentName = "Vl. I" midiInstrument = "violin" } {
    \key d \major \time 4/4 \tempo "Andante" 4 = 60
    fis''2\p e'' | d'' cis'' | b' a' | b' cis'' |
    d''4 cis'' b' a' | g' fis' g' e' | d'8 fis' a' g' fis' d' fis' e' | d' b d' a' g' b' a' g' \bar "||"
  }
  \new Staff \with { instrumentName = "Violin II" shortInstrumentName = "Vl. II" midiInstrument = "violin" } {
    \key d \major \time 4/4
    d''2\p cis'' | b' a' | g' fis' | g' e' |
    fis''2 e'' | d'' cis'' | b' a' | b' cis'' \bar "||"
  }
  \new Staff \with { instrumentName = "Viola" shortInstrumentName = "Va." midiInstrument = "viola" } {
    \clef alto \key d \major \time 4/4
    a'2\p a' | fis' fis' | d' d' | d' e' |
    a'2 a' | fis' fis' | d' d' | d' e' \bar "||"
  }
  \new Staff \with { instrumentName = "Cello" shortInstrumentName = "Vc." midiInstrument = "cello" } {
    \clef bass \key d \major \time 4/4
    d2\p a, | b, fis, | g, d, | g, a, |
    d2 a, | b, fis, | g, d, | g, a, \bar "||"
  }
>>
