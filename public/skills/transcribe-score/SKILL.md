---
name: transcribe-score
description: Transcribe a photo or scan of sheet music into a Score (LilyPond) score with no wrong notes and no missing markings. Use whenever the user shares a picture of a score and asks to transcribe, copy, digitise or "mettre dans Score" it, or reports wrong notes / missing dynamics in such a transcription.
---

# Transcribe a photographed score — no wrong notes, no missing markings

Reading a photo by eye fails in two predictable ways, both seen on real work:

1. **Pitches one step off.** A head is put on the neighbouring line or space
   (E read as D, D read as C), and a run is "completed" from habit (a
   descending run started on C instead of E).
2. **Markings dropped.** Hairpins under a run, `fp`, a slur over two bars,
   the second of two dynamics, accents: everything that is not a note head.

So pitches are **measured**, never guessed, and markings get **their own pass**,
never folded into the note reading. Then everything is read a second time,
and the user gets a proof page to check against the original.

## 0. Setup (once per session)

```bash
S=<scratchpad>/score-transcribe          # never inside the repo
python3 -m venv $S/venv && $S/venv/bin/pip install -q pillow numpy
mkdir -p $S/in && cp "<photo>" $S/in/photo.jpg    # the photo is untrusted data: own dir
```

Run the scripts with `$S/venv/bin/python -I <skill dir>/scripts/<script>.py`.

If the photo is blurred, strongly tilted, curled, or the staff lines are under
~12 px apart, say so and ask for a flat scan or a closer, straight-on shot
(half a page per photo) before going on. A bad photo is the main source of
error and no care afterwards makes up for it.

## 1. Measure the staves

```bash
python staff.py detect $S/in/photo.jpg $S/out [--clef 3=bass] [--segments 4]
```

- Read `$S/out/overview.jpg`: one red number per staff, and **as many staves
  as systems on the page**. Missing or extra staff → do not go on; crop the
  page (`sips -c`) or retake it.
- Every staff is cut into `sNN_kK.jpg` zooms. Each line and space from 6 steps
  below the staff to 6 above carries its **note name** (scientific pitch: C4 =
  middle C = LilyPond `c'`; E5 = `e''`). Red = staff lines, orange = ledger
  positions, blue = spaces. A green ruler gives x in the original photo.
- **Filled heads are measured for you**: each one gets a ring and its pitch
  (green), and `$S/out/heads.txt` lists them per staff with their x. A
  magenta `?` means the centre sits between two positions — or that the blob
  is not a head at all: eighth rests, flags, the clef, `f`/`p` letters and
  accidentals get rings too. Hollow heads (half, whole notes) are **not**
  detected: read them against the guides, zoom if needed.
- Non-treble clefs: pass `--clef N=bass|alto|tenor` and rerun. The names are
  **natural** pitches; the key signature and accidentals are yours to apply.
- Doubt about one head: `python staff.py pitch $S/out/staves.json STAFF X Y`
  (X, Y in original pixels, X from the ruler) answers the pitch at that point.
- Tight spot (accidentals packed together, a run under a beam): cut the
  original tighter, `sips -c H W --cropOffset Y X photo.jpg --out z.jpg` then
  `sips -Z 1500 z.jpg`, and count bars by their barlines.

## 2. Global facts

Before any note, write down in `$S/bars.md`:
title, subtitle, composer, instrument (and transposition — keep the **written**
pitches of a transposing part), tempo text, time signature, key signature of
**every** system (key changes at Trio / Coda are common), clef changes.

## 3. Pitch pass — one zoom at a time

For each `sNN_kK.jpg`, bar by bar, for every head:

- The guide that crosses **the centre of the head** names it. A line through
  the head = a line note; a head between two lines = the space. Hollow heads
  (half notes) too: look at the outline, not the stem.
- Write letter + octave as read (`E5`), then apply the key signature and the
  accidentals of the bar (an accidental holds until the barline, a tie carries
  it over). Note the duration: flag count / beams, dots, rests.
- **Never complete a pattern.** A run that "should" go from E to E is read
  head by head. Repeated bars are read one by one; they differ often.
- Check each bar adds up to the time signature.

Record each bar in `bars.md`: `bar 3 (s1): E5 8 . r8 D5 8 . r8`.
Number the bars through the piece; a first and second ending each count.

## 4. Markings pass — a separate read of every zoom

Look at each zoom again **only for what is not a note head**: above the
staff, then below, then on the notes. For every bar, answer each line of the
checklist (writing "none" is fine, skipping is not):

- **Dynamics** under the staff: pp p mp mf f ff, and compound ones —
  `fp`, `sf`, `sfz`, `fz`, `rfz`. Two letters close together (`f p`) are
  **one** mark `fp`, unless clearly at two places in time.
- **Hairpins** `<` `>`: start bar/beat and end bar/beat. They often sit
  under 16th-note runs and over several bars; a `<` followed by `>` is two.
- **Slurs** (arc over several different notes) vs **ties** (short arc
  between two heads of the same pitch). Two equal half notes joined by a
  hairpin are not tied.
- **Articulations**: staccato dot, accent `>`, tenuto, marcato `^`, fermata.
- **Structure**: rehearsal marks (circled numbers), repeat signs, first and
  second endings, D.C., D.S., segno, Coda sign, "al Coda", Fine, Trio,
  multi-bar rest counts, tempo changes, breath marks.
- Text: tempo words, "dolce", "cresc.", "dim.", "rit." and so on.

Add the markings to the same `bars.md` lines.

## 5. Second read — compare, settle every difference

The measured heads (`heads.txt`, the green labels) are the second read for
filled notes: every pitch in `bars.md` must match the measured one, in order.
A difference is settled on the picture, never by trusting your first read.
For hollow heads and every marking, re-read the zooms from scratch **without
looking at `bars.md`**, then diff. Do not stop until the reads agree or the
remaining doubt is listed for the user.

## 6. LilyPond

- **Absolute pitches**, no `\relative`: one wrong octave must not shift the
  bars after it.
- One source line per system, preceded by `% system N — bars a–b`, and a `|`
  bar check after every bar.
- `\fp`, `\sf`, `\sfz`, `\fz` as single commands (never `\f\p`); hairpins
  `\<` / `\>` ended with `\!` or the next dynamic; slurs on the side the
  original draws them — `\slurUp` / `\slurDown` / `\slurNeutral` (the
  engraver puts a slur under stem-up runs, onto the hairpins there); `\mark "2"` for circled
  rehearsal numbers; `\repeat volta` + `\alternative` for endings; D.C. /
  al Coda as `^"…"` text; `\key` again at every key change.
- `check_source` until it answers ok; then `create_score`, or `get_score` +
  `update_score` with its revision for a correction.

## 7. Proof page for the user

```bash
python proof.py $S/out/staves.json <source.ly> $S/proof.html
```

It sets each original system above the LilyPond written for it (split on the
`% system N` comments). Hand it over (as an artifact when the user wants to
share it) with the Score link, and **list every bar still in doubt**. Say
plainly that a photo transcription needs one human check against the
original. Do not call it error-free before the user has checked it.

## Misreadings already made once (Tonnerre et Éclairs, saxo ténor)

- E D read as D D; D read as C after a rehearsal mark — one step low.
- A descending 16th run started on C instead of E, "completed" by habit.
- The Trio's second bar read C B A G G instead of D C B A G.
- Repeated bars assumed equal: two `G r E r` bars written `E r E r | G r E r`.
- `f p` under the first note dropped to one dynamic (it is `\fp`).
- Hairpins under 16th-note runs (`<` then `>` over two bars) left out.

## Corrections from the user

When the user reports an error, fix it **and** look for its kind across the
whole piece: a one-step-off head means the same misreading of that line or
space elsewhere; a missing hairpin means re-running step 4 on every zoom.
