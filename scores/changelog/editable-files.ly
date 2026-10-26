\new StaffGroup <<
  \new Staff \with { instrumentName = "Horn" } \relative c'' {
    \time 6/8 g8 a b c4. | \tuplet 3/2 { d8 \tuplet 3/2 { e16 f g } c8 } b8 c4. \bar "|."
  }
  \new TabStaff \relative c' { e8 g c e4. | c2. }
>>
