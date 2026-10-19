\header { title = "Prelude in C major" subtitle = "The Well-Tempered Clavier, BWV 846 (opening)" composer = "Johann Sebastian Bach" }
\new PianoStaff \with { instrumentName = "Piano" } <<
  \new Staff {
    \time 4/4 \tempo "Moderato" 4 = 66
    r8 g'16\p c'' e'' g' c'' e'' r8 g'16 c'' e'' g' c'' e'' |
    r8 a'16 d'' f'' a' d'' f'' r8 a'16 d'' f'' a' d'' f'' |
    r8 g'16 d'' f'' g' d'' f'' r8 g'16 d'' f'' g' d'' f'' |
    r8 g'16 c'' e'' g' c'' e'' r8 g'16 c'' e'' g' c'' e'' \bar "||"
  }
  \new Staff {
    \clef bass \time 4/4
    << { r16 e'8. ~ e'4 r16 e'8. ~ e'4 } \\ { c'2 c'2 } >> |
    << { r16 d'8. ~ d'4 r16 d'8. ~ d'4 } \\ { c'2 c'2 } >> |
    << { r16 d'8. ~ d'4 r16 d'8. ~ d'4 } \\ { b2 b2 } >> |
    << { r16 e'8. ~ e'4 r16 e'8. ~ e'4 } \\ { c'2 c'2 } >> \bar "||"
  }
>>
