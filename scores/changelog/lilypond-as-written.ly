melody = \relative c'' { \key f \major \time 3/4 \partial 4 c8 bes | a4 g f | \grace { g16 } a4 bes c | f,2. \bar "|." }
<<
  \new ChordNames \chordmode { \time 3/4 \partial 4 s4 f2. c2.:7 f2. }
  \new Staff \transpose c c { \melody }
  \addlyrics { Now the song be -- gins a -- gain to -- day }
>>
