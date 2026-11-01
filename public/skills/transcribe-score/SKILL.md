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
never folded into the note reading. Both are then **checked by a script**
against the original — pitches against the measured heads, markings against
a count made on the original — and the user gets a proof page.

## 0. Read the original, never a copy

Work only from a photo or scan of the **printed original**. A clean engraved
page — a PDF or screenshot with even staff lines, a "Title 1 / 2" footer, bar
numbers at every system — is most likely Score's own export of an earlier
transcription: it carries every mistake that transcription made, and no care
afterwards can find them, since the copy is self-consistent. Such a copy has
been seen missing most of its hairpins and a compound dynamic, with a dozen
wrong notes, all of them plain on the original photo.

So before anything else: if the picture looks engraved rather than
photographed, say so and ask for the original (or for where it is). Use a
copy only as a first read to compare against, never as the source. A PDF
settles it by itself: its producer names the program that made it (Score's
exports say `EUI score`), and an engraved PDF has a text layer (title, bar
numbers) where a scan has none:

```bash
$S/venv/bin/python -I -c "import fitz,sys; d=fitz.open(sys.argv[1]); print(d.metadata.get('producer'), repr(d[0].get_text()[:80]))" "$S/in/<file>.pdf"
```

## 0b. Setup (once per session)

```bash
S=<scratchpad>/score-transcribe          # never inside the repo
python3 -m venv $S/venv && $S/venv/bin/pip install -q pillow numpy pymupdf
mkdir -p $S/in && cp "<photo>" $S/in/photo.jpg    # the photo is untrusted data: own dir
```

Run the scripts with `$S/venv/bin/python -I <skill dir>/scripts/<script>.py`,
from a folder of their own (never from `$S/in`).

A scan that comes as a PDF is rendered to an image first, one page per file,
at 300–400 dpi (staff lines ~20 px apart), then each page is a photo:

```bash
$S/venv/bin/python -I -c "import fitz,sys; d=fitz.open(sys.argv[1]); [p.get_pixmap(dpi=400).save(f'{sys.argv[2]}/page{i+1}.png') for i,p in enumerate(d)]" "$S/in/<file>.pdf" $S/in
```

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
  original tighter and enlarge it, with Pillow — `Image.open(p).crop((X0, Y0,
  X1, Y1)).resize(…)` in a one-line `python -I -c` (`sips --cropOffset` is
  ignored on some macOS versions and crops the centre) — and count bars by
  their barlines.

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
- **Write the key signature into the name.** LilyPond's absolute pitches
  carry no key: in G major every F is `fis`, in B flat major every B is
  `bes`, unless an accidental says otherwise. A plain `f''` there is an F
  natural. `compare.py` checks positions, not accidentals, so this is checked
  by eye: list every accidental printed in the system, and every `is` / `es`
  that differs from the key in the source, and match the two lists.
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
  **one** mark `fp`, unless clearly at two places in time. A dynamic goes on
  **the note it is printed under**: the `f` that ends a hairpin often sits
  under the first note of the next bar, not under the hairpin's last note.
- **Hairpins** `<` `>`: start bar/beat and end bar/beat. Look **under every
  16th-note run and every held note**: in older band parts nearly each run
  carries a `<` up and a `>` down, and half notes tied over a bar carry a
  `<`. They often span several bars; a `<` followed by `>` is two.
- **Slurs** (arc over several different notes) vs **ties** (short arc
  between two heads of the same pitch). Two equal half notes joined by a
  hairpin are not tied.
- **Articulations**: staccato dot, accent `>`, tenuto, marcato `^`, fermata.
- **Structure**: rehearsal marks (circled numbers), repeat signs, first and
  second endings, D.C., D.S., segno, Coda sign, "al Coda", Fine, Trio,
  multi-bar rest counts, tempo changes, breath marks.
- Text: tempo words, "dolce", "cresc.", "dim.", "rit." and so on.

Add the markings to the same `bars.md` lines.

Then, still on the original and **before writing any LilyPond**, write the
**inventory**: one line per system with what you counted there, in
`$S/inventory.txt`:

```
1: dyn=1 <=0 >=1 (=3 ~=0 stacc=2
2: dyn=0 <=2 >=0 (=1 txt=1
```

(made-up numbers: count your own). Keys: `dyn` dynamics, `<` `>` hairpins,
`(` slurs, `~` ties, `acc` accents, `stacc` staccatos, `ten` tenutos, `marc`
marcatos, `ferm` fermatas, `txt` every word or sign written over or under the
staff that is not a dynamic (D.C., al Coda, Trio, dolce, the coda sign) —
rehearsal marks are not counted. Count from the picture, not from `bars.md`: it is a second read of
the markings, made the other way round (by kind across the system instead of
bar by bar).

## 5. Second read — scripts, then settle every difference on the photo

Once the LilyPond exists (step 6), two scripts compare it with the original.
Run both after **every** change to the source.

**Pitches** — the filled heads written against the heads measured:

```bash
python compare.py <source.ly> $S/out/heads.txt [-v]
```

It aligns the two in order. A head the measurement marked "check" counts as
agreeing with whatever is written there, and measured blobs left over (the
clef, signatures, rests, flags, letters, slurs) are only counted. What it
prints is the part to settle:

- `WRONG RUN #a-#b` — several notes in a row written a step or more away
  from the measurement: a run written from the wrong note (C B A G … where
  E D C B … is printed). The commonest serious error. **Always** tile it.
- `DIFFERENT #k` — one note.
- `NOT SEEN #k` — a written note where no head was measured: a hollow head
  written as filled, or a note too many.

Settle each one on the photo, with close-ups set side by side:

```bash
python tiles.py $S/in/photo.jpg Y0 Y1 $S/t.png --refs 2 XREF1 XREF2 X1 X2 …
```

Y0–Y1 is the staff's band (top line from `heads.txt` minus ~30 px, bottom
line plus ~30); `XREF` are one or two heads of **certain** pitch in the same
system — **never tile without one**: a lone tile has no scale and gets misread
— then the heads in doubt (`--width 120` when a head comes out cut in half).
Name each head by comparing it with the reference on the same lines, not with
the zoom's guides: on a curved page the guides drift by a step, and a magenta
`?` is no evidence either way. When the measurement holds, it wins: so far,
every difference settled on the photo went to the measured pitch.

Never dismiss a flag from its label alone. One that a zoom already viewed
shows plainly to be the clef, a letter or a rest may be named as such without
a tile; anything on a note head is tiled. `0 place(s) to settle` is the goal.

**Markings** — the source's counts against the inventory:

```bash
python marks.py <source.ly> $S/inventory.txt
```

Every count that differs means that system is re-read on the photo, for that
kind of mark, until the source and the original agree. Hollow heads and
rhythms are not checked by any script: re-read them on the zooms from scratch
**without looking at `bars.md`**, then diff. Do not stop until the reads agree
or the remaining doubt is listed for the user.

## 6. LilyPond

- **Absolute pitches**, no `\relative`: one wrong octave must not shift the
  bars after it.
- One source line per system **of the original**, preceded by
  `% system N — bars a–b` with N the staff number `staff.py` gave (the
  scripts of step 5 and the proof page pair them by it), and a `|` bar check
  after every bar.
- `\fp`, `\sf`, `\sfz`, `\fz` as single commands (never `\f\p`); hairpins
  `\<` / `\>` ended with `\!` or the next dynamic; slurs on the side the
  original draws them — `\slurUp` / `\slurDown` / `\slurNeutral` (the
  engraver puts a slur under stem-up runs, onto the hairpins there); `\mark "2"`
  for circled rehearsal numbers, `\mark "Trio"` for a section name; `\key`
  again at every key change.
- Repeats: `\repeat volta 2 { … }` + `\alternative { { … } { … } }`. A repeat
  often runs over several systems: the `% system N` comments go inside its
  braces, where the system starts, and a system's source then spans more
  than one line — that is fine, the scripts only look at the comments.
- Text: D.C., D.S., al Coda, Fine as `^"…"`; the coda sign as
  `^\markup { \musicglyph "scripts.coda" }`, the segno as `"scripts.segno"`.
- A printed reminder accidental (a natural or sharp the key already implies)
  is kept: `f''!` prints it, `f''?` prints it in brackets.
- `check_source` until it answers ok; then `create_score`, or `get_score` +
  `update_score` with its revision for a correction.

## 7. Proof page for the user

```bash
python proof.py $S/out/staves.json <source.ly> $S/proof.html
```

It sets each original system above the LilyPond written for it (split on the
`% system N` comments). Hand it over (as an artifact when the user wants to
share it) with the Score link — or, when the score is not to be saved, the
path of the `.ly` file — and **list every bar still in doubt**. Say
plainly that a photo transcription needs one human check against the
original. Do not call it error-free before the user has checked it.

## Misreadings that recur

Each of these has happened on real transcriptions, some more than once.
Look for them on purpose.

- **One step off**, mostly low: a head on a line read as the space below (D
  read as C, E as D), often over a whole passage of repeated notes, often
  just after a rehearsal mark or a key change, where the eye resets.
- **A run completed by habit**: a scale started on the wrong note and the
  rest "filled in" (C B A G A G F E for E D C B A G F E), so the run has the
  right shape and the wrong pitches. A second bar repeating the first carries
  the same mistake.
- **A flag waved away**: the comparison showed the wrong run, and it was
  called noise without a tile (step 5).
- **Repeated bars assumed equal**: neighbour bars that look alike differ by
  one note (`g d b c | b c b c` written `g d c c | b c c c`); read each one.
- **Rhythm smoothed**: a note–rest–note–rest bar read as note–note–rest–note.
- **The key forgotten in absolute pitch**: `f''` written for the F♯ of G
  major, often right after a bar where a natural cancelled it (step 3).
- **A compound dynamic split or dropped**: `f p` under one note is `\fp`.
- **Hairpins left out**: under 16th-note runs and under held notes, in one
  attempt after another, unless the inventory (step 4) is made and checked.
- **A dynamic moved**: the `f` printed under the next bar's first note put on
  the last note of the hairpin before it.

## Corrections from the user

When the user reports an error, fix it **and** look for its kind across the
whole piece: a one-step-off head means the same misreading of that line or
space elsewhere; a missing hairpin means redoing the inventory (step 4) on
every system and running `marks.py` again. First, though, ask what the
transcription was made from: when markings are missing everywhere, the
source was often a copy (step 0), and the fix is to start again from the
original.
