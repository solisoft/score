\relative c' {
  \set Score.rehearsalMarkFormatter = #format-mark-box-letters
  \mark \default
  \override Stem.direction = #DOWN e4 f g a \revert Stem.direction |
  \dynamicUp b4\p c\< d e\! | \mark \default
  \override NoteHead.style = #'cross f4 e \revert NoteHead.style d c |
  \once \override TextScript.extra-offset = #'(0 . 1) b2^"rit." c \bar "|."
}
