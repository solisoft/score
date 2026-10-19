\header { title = "Little Waltz" composer = "EUI Score example" }
\new PianoStaff \with { instrumentName = "Piano" } <<
  \new Staff \relative c'' {
    \key f \major \time 3/4 \tempo "Tempo di valse" 4 = 152
    c2\mp( a4 | f2 a4 | c4 d c | bes2.) |
    bes2( g4 | e2 g4 | bes4 c bes | a2.) |
    c2\<( f4 | e2 d4\! | c4\> bes a | g2.\!) |
    a4( c f, | e g c, | f2.) ~ | f2. \bar "|."
  }
  \new Staff \relative c {
    \clef bass \key f \major \time 3/4
    f4 <a c> <a c> | f4 <a c> <a c> | f4 <a c> <a c> | g4 <bes d> <bes d> |
    c,4 <g' bes> <g bes> | c,4 <g' bes> <g bes> | c,4 <g' bes> <g bes> | f4 <a c> <a c> |
    f4 <a c> <a c> | bes,4 <f' bes> <f bes> | c4 <g' bes> <g bes> | c,4 <e bes'> <e bes'> |
    f4 <a c> <a c> | c,4 <g' bes> <g bes> | f4 <a c> <a c> | <f, c' f>2. \bar "|."
  }
>>
