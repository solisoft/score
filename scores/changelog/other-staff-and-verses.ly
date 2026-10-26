\new PianoStaff <<
  \new Staff = "up" { << \relative c'' { e4 d c \change Staff = "down" g | c1 } \\ \new Voice = "alto" \relative c' { c4 b a g | e1 } >> }
  \new Lyrics \lyricsto "alto" { Sing a- long now, here }
  \new Staff = "down" { \clef bass s1 | s1 \bar "|." }
>>
