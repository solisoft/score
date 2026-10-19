\header { title = "Two-Five-One" subtitle = "jazz trio: trumpet, saxophone, double bass (concert pitch)" composer = "EUI Score example" }
\new StaffGroup <<
  \new Staff \with { instrumentName = "Trumpet" shortInstrumentName = "Tp." midiInstrument = "trumpet" } {
    \key c \major \time 4/4 \tempo "Swing" 4 = 132
    r4 a'8^"Dm7"\mf c'' f'' e'' d'' c'' | b'4^"G7" \tuplet 3/2 { d''8 f'' g'' } b''4-> g''-. |
    e''2.^"Cmaj7" ~ e''8 d'' | c''1\fermata \bar "|."
  }
  \new Staff \with { instrumentName = "Tenor saxophone" shortInstrumentName = "Sax." midiInstrument = "tenor sax" } {
    \key c \major \time 4/4
    f'2\mp a' | f'2 b' | g'2. ~ g'8 b | g'1\fermata \bar "|."
  }
  \new Staff \with { instrumentName = "Double bass" shortInstrumentName = "Db." midiInstrument = "acoustic bass" } {
    \clef bass \key c \major \time 4/4
    d4 f a c' | g,4 b, d f | c4 e g b | c1\fermata \bar "|."
  }
>>
