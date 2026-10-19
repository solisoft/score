\header { title = "Groove rock" subtitle = "a drum kit: hi-hat and snare above, the kick below" composer = "EUI Score example" }
\new DrumStaff \with { instrumentName = "Drums" }
\drummode {
  \time 4/4 \tempo "Rock" 4 = 112
  << { hh8 hh <hh sn> hh hh hh <hh sn> hh } \\ { bd4 r bd8 bd r4 } >> |
  << { hh8 hh <hh sn> hh hh hh <hh sn> hh } \\ { bd4 r bd8 bd r4 } >> |
  << { hh8 hh <hh sn> hh hh hh <hh sn> hh } \\ { bd4 r bd8 bd r4 } >> |
  << { sn16 sn sn sn tomh tomh tommh tommh tomfh tomfh tomfh tomfh <cymc sn>4-> } \\ { bd4 bd bd bd } >> \bar "|."
}
