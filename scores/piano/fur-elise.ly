\header { title = "Für Elise" subtitle = "Bagatelle in A minor, WoO 59 (opening)" composer = "Ludwig van Beethoven" }
\new PianoStaff \with { instrumentName = "Piano" } <<
  \new Staff {
    \key a \minor \time 3/8 \tempo "Poco moto" 8 = 132
    r4 e''16\pp dis'' | e''16 dis'' e'' b' d'' c'' | a'8 r16 c' e' a' | b'8 r16 e' gis' b' |
    c''8 r16 e' e'' dis'' | e''16 dis'' e'' b' d'' c'' | a'8 r16 c' e' a' | b'8 r16 d' c'' b' | a'4. \bar "|."
  }
  \new Staff {
    \clef bass \key a \minor \time 3/8
    r4. | r4. | a,16 e a r r8 | e,16 e gis r r8 |
    a,16 e a r r8 | r4. | a,16 e a r r8 | e,16 e gis r r8 | a,4. \bar "|."
  }
>>
