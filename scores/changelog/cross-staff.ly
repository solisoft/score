\new PianoStaff <<
  \new Staff = "up" \relative c'' {
    \clef treble
    c8 \change Staff = "down" g, e \change Staff = "up" c'' e( g) r4 |
    \showStaffSwitch e4 \change Staff = "down" c,, \change Staff = "up" g''2 \bar "|."
  }
  \new Staff = "down" { \clef bass s1 | s1 }
>>
