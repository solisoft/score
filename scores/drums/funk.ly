\header { title = "Sixteenth-Note Funk Groove" composer = "EUI Score example" }
\new DrumStaff \with { instrumentName = "Drums" }
\drummode {
  \time 4/4 \tempo "Funk" 4 = 96
  << { hh16 hh hh hh <hh sn>16-> hh hh sn hh16 sn hh hh <hh sn>16-> hh hh hh } \\ { bd8. bd16 r4 r8 bd8 r4 } >> |
  << { hh16 hh hh hh <hh sn>16-> hh hh sn hh16 sn hh hh <hh sn>16-> hho sn sn } \\ { bd8. bd16 r4 r16 bd8 bd16 r4 } >> \bar "|."
}
