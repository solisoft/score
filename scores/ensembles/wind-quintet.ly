\header { title = "Little March" subtitle = "for wind quintet (concert pitch)" composer = "EUI Score example" }
\new StaffGroup <<
  \new Staff \with { instrumentName = "Flute" shortInstrumentName = "Fl." midiInstrument = "flute" } {
    \key bes \major \time 2/4 \tempo "Allegro marziale" 4 = 112
    f''8-.\f f''-. g''-. a''-. | bes''4-> f''-> | d''8-. es''-. f''-. d''-. | c''2 |
    f''8-. f''-. g''-. a''-. | bes''4-> d'''-> | c'''8( a'') f''-. a''-. | bes''4-> r \bar "|."
  }
  \new Staff \with { instrumentName = "Oboe" shortInstrumentName = "Ob." midiInstrument = "oboe" } {
    \key bes \major \time 2/4
    d''8-.\f d''-. es''-. f''-. | f''4 d'' | bes'8-. c''-. d''-. bes'-. | a'2 |
    d''8-. d''-. es''-. f''-. | f''4 f'' | f''8( es'') c''-. es''-. | d''4 r \bar "|."
  }
  \new Staff \with { instrumentName = "Clarinet" shortInstrumentName = "Cl." midiInstrument = "clarinet" } {
    \key bes \major \time 2/4
    bes'8-.\f bes'-. bes'-. c''-. | d''4 bes' | f'8-. g'-. bes'-. f'-. | f'2 |
    bes'8-. bes'-. bes'-. c''-. | d''4 bes' | a'8( c'') a'-. c''-. | bes'4 r \bar "|."
  }
  \new Staff \with { instrumentName = "Horn" shortInstrumentName = "Hn." midiInstrument = "french horn" } {
    \key bes \major \time 2/4
    f'4\f f' | f'4 f' | f'4 f' | f'2 |
    f'4 f' | f'4 f' | f'4 f' | f'4 r \bar "|."
  }
  \new Staff \with { instrumentName = "Bassoon" shortInstrumentName = "Bn." midiInstrument = "bassoon" } {
    \clef bass \key bes \major \time 2/4
    bes,4\f d | bes,4 d | bes,4 bes, | f,2 |
    bes,4 d | bes,4 d | f4 f, | bes,4 r \bar "|."
  }
>>
