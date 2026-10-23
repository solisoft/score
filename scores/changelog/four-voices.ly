\new PianoStaff <<
  \new Staff = "up" { \key g \major << { \voiceOne d''4 d'' e''2 } \\ { \voiceTwo b'4 b' c''2 } \\ { \voiceThree g'4 g' g'2 } \\ { \voiceFour d'4 d' c'2 } >> | b'8 \change Staff = "down" g8 d8 \change Staff = "up" b'8 d''2 \bar "|." }
  \new Staff = "down" { \clef bass \key g \major g1 | s2 g,2 }
>>
