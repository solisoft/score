<<
  \new Staff \with { instrumentName = "Cue" \magnifyStaff #2/3 } \relative c'' {
    g8 a g f e4 | c d e | f2. | r4 | g4 f \bar "|."
  }
  \new Staff \relative c'' {
    c4 d \time 3/4 e | f g a | << { c4 b a } \\ { e2 f4 } >> | \bar "||" \time 2/4 \partial 4 d,4 | c2
  }
>>
