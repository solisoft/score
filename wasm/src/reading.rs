//! Everything the engraver read in a source, sign by sign (#1039).
//!
//! The editor's model keeps what it knows of a piece and writes the text
//! back from it. What the engraver reads and the model does not know was
//! lost on that first rewrite, in silence: the engraver had learned signs
//! (arpeggio brackets, two-note tremolos, the other pedals, shape notes)
//! and the editor had not followed.
//!
//! [`reading`] answers each staff's signs as words, so a text and what the
//! model wrote back from it can be compared (`tests/js/round_trip.test.mjs`):
//! a sign in the first and not in the second was lost. Every field of the
//! engraver's event is named in [`signs`], with no `..` — so the day the
//! engraver learns a new one, this crate stops building until someone
//! says here whether it is a sign of the music (the editor must then keep
//! it, or say it does not) or only where something is drawn.

use eui_score::parse::{self, Ev, Kind, Syllable};
use serde_json::{json, Value};

/// A note's pitches, as written: `d/alter` each.
fn pitches(ev: &Ev) -> String {
    ev.pitches.iter().map(|p| format!("{}/{}", p.d, p.alter)).collect::<Vec<_>>().join(",")
}

/// The signs of one event onto `out`, each a word that says what it is and
/// not where: what a rewrite must still hold.
#[allow(clippy::too_many_lines)]
fn signs(ev: &Ev, prefix: &str, named: bool, out: &mut Vec<String>) {
    let Ev {
        k,
        // Where it is written, and its numbers: a rewrite moves them.
        at: _,
        pitch_at: _,
        i: _,
        n: _,
        // The clef, key and metre in force: said once, by their own events.
        clef,
        fifths,
        tonic: _,
        time,
        time_parts,
        v,
        page,
        part,
        closed,
        tempo,
        pitches: written,
        // How long it lasts is heard: the MIDI file says it.
        base: _,
        dots: _,
        ticks,
        full,
        count,
        tie,
        slur_on,
        slur_dir,
        slur_off,
        beam_on,
        beam_off,
        scripts,
        texts,
        dynamic,
        hairpin,
        hairpin_end,
        tuplet,
        tuplet_outer,
        percent,
        fingers,
        phrase_on,
        phrase_dir,
        phrase_off,
        arpeggio,
        arp_style,
        gliss,
        pedal_on,
        pedal_off,
        pedals,
        tremolo,
        trem_beams,
        trem_first,
        ottava,
        graces,
        after_graces,
        after_at,
        grace,
        chord_name,
        figures,
        size,
        cue,
        clef_change,
        key_change,
        time_change,
        stem_dir,
        no_autobeam,
        breath,
        lv,
        repeat_tie,
        hairpin_text,
        span_start,
        span_stop,
        forced,
        cautionary,
        drums,
        strings,
        harmonics,
        tab,
        tab_marks,
        voice,
        cross,
        spacer,
        follow,
        span_stem,
        look,
        unseen,
        scale,
        part_text,
        // Where things are drawn, worked out when the piece is laid out:
        // nothing a text says.
        change_x: _,
        pre: _,
        breath_x: _,
        start: _,
        bar: _,
        mm: _,
        heads: _,
        up: _,
        beam: _,
        ideal: _,
        left: _,
        right: _,
        head_w: _,
        x: _,
        whole_bar: _,
        span0: _,
        span1: _,
        stem_end: _,
        reach_up: _,
        reach_down: _,
        sys: _,
        members: _,
        rest_y: _,
        shift: _,
        arp_x: _,
        lyric: _,
        verses: _,
        lyric_held: _,
        rest_behind: _,
        moved: _,
        free: _,
        xbeam: _,
    } = ev;
    let mut say = |word: String| out.push(format!("{prefix}{word}"));
    match k {
        Kind::Note => {
            if !written.is_empty() {
                say(format!("pitches {}", pitches(ev)));
            }
        }
        Kind::Rest => {}
        Kind::Clef => say(format!("clef {clef:?}")),
        // Its sharps or flats: E flat major and C minor are one key signature.
        Kind::Key => say(format!("key {fifths}")),
        Kind::Time => say(format!("time {time:?} {time_parts:?}")),
        Kind::Ottava => say(format!("ottava {ottava}")),
        other => say(format!("{other:?} {v} {page} {part} {closed}")),
    }
    if let Some(t) = tempo {
        say(format!("tempo {t:?}"));
    }
    if matches!(k, Kind::Note | Kind::Rest) {
        // `R1` in four-four is drawn as `r1` is; `R2.` is not drawn as
        // `r2.`. Bars of rest gathered are as many bars, however cut.
        if *full && *ticks != eui_score::WHOLE && *ticks != eui_score::WHOLE * (*count).max(1) {
            for _ in 0..(*count).clamp(1, 512) {
                say("a whole bar's rest".into());
            }
        }
        if *ottava != 0 {
            say(format!("under ottava {ottava}"));
        }
    }
    let flags = [
        ("tie", *tie),
        ("slur on", *slur_on),
        ("slur off", *slur_off),
        ("beam on", *beam_on),
        ("beam off", *beam_off),
        ("hairpin end", *hairpin_end),
        ("phrase on", *phrase_on),
        ("phrase off", *phrase_off),
        ("glissando", *gliss),
        ("pedal on", *pedal_on),
        ("pedal off", *pedal_off),
        ("cue", *cue),
        ("no autobeam", *no_autobeam),
        ("laissez vibrer", *lv),
        ("repeat tie", *repeat_tie),
        ("span stop", *span_stop),
        ("spacer", *spacer),
        ("follow", *follow),
        ("span stem", *span_stem),
    ];
    for (name, on) in flags {
        if on {
            say(name.to_owned());
        }
    }
    if *slur_on && *slur_dir != 0 {
        say(format!("slur side {slur_dir}"));
    }
    if *phrase_on && *phrase_dir != 0 {
        say(format!("phrase side {phrase_dir}"));
    }
    for s in scripts {
        say(format!("script {} {}", s.name, s.dir));
    }
    for w in texts {
        say(format!("words {w:?}"));
    }
    if let Some(d) = dynamic {
        say(format!("dynamic {d}"));
    }
    if let Some(h) = hairpin {
        say(format!("hairpin {h} {hairpin_text:?}"));
    }
    if let Some(t) = tuplet {
        say(format!("tuplet {}/{}", t.n, t.d));
    }
    if let Some(t) = tuplet_outer {
        say(format!("tuplet around {}/{}", t.n, t.d));
    }
    if percent.is_some() {
        say("percent".into());
    }
    for f in fingers {
        say(format!("finger {f:?}"));
    }
    if *arpeggio {
        say(format!("arpeggio {arp_style:?}"));
    }
    for (pedal, on) in pedals {
        say(format!("pedal {pedal} {on}"));
    }
    if *tremolo > 0 {
        say(format!("tremolo {tremolo}"));
    }
    if *trem_beams > 0 {
        say(format!("tremolo of two {trem_beams} {trem_first}"));
    }
    for g in graces {
        signs(g, &format!("{prefix}grace {:?}: ", g.grace), named, out);
    }
    for g in after_graces {
        signs(g, &format!("{prefix}grace after {after_at}: "), named, out);
    }
    let mut say = |word: String| out.push(format!("{prefix}{word}"));
    // On a grace note itself, its kind is said by the note it is before.
    let _ = grace;
    // A chord's name is printed by a line of chord names; in a staff of
    // notes (`\new Staff \chordmode { … }`) its notes are all there is.
    if named && !chord_name.is_empty() {
        say(format!("chord {}", chord_name.iter().map(|r| r.text.as_str()).collect::<String>()));
    }
    if !figures.is_empty() {
        say(format!("figures {figures:?}"));
    }
    if *size != 0 {
        say(format!("size {size}"));
    }
    if let Some(c) = clef_change {
        say(format!("clef change {c:?}"));
    }
    if let Some(c) = key_change {
        say(format!("key change {c:?}"));
    }
    if let Some(c) = time_change {
        say(format!("time change {c:?}"));
    }
    if *stem_dir != 0 {
        say(format!("stem {stem_dir}"));
    }
    if let Some(b) = breath {
        say(format!("breath {b}"));
    }
    if let Some(runs) = span_start {
        say(format!("span start {}", runs.iter().map(|r| r.text.as_str()).collect::<String>()));
    }
    for d in forced {
        say(format!("accidental forced {d}"));
    }
    for d in cautionary {
        say(format!("accidental reminded {d}"));
    }
    for d in drums {
        say(format!("drum {d:?}"));
    }
    for s in strings {
        say(format!("string {s:?}"));
    }
    for h in harmonics {
        say(format!("harmonic {h}"));
    }
    for (place, mark) in tab.iter().zip(tab_marks.iter().map(Some).chain(std::iter::repeat(None))) {
        say(format!("tab {place:?} {mark:?}"));
    }
    if let Some(v) = voice {
        say(format!("voice {v}"));
    }
    if let Some(c) = cross {
        say(format!("on staff {c}"));
    }
    if let Some(map) = look.map() {
        for (key, val) in map {
            say(format!("set {key} = {val:?}"));
        }
    }
    if !unseen.is_empty() {
        say(format!("played unseen {}", unseen.len()));
    }
    if let Some(s) = scale {
        say(format!("scaled {s:?}"));
    }
    if let Some(t) = part_text {
        say(format!("part text {t:?}"));
    }
}

fn syllables(line: &[Syllable], what: &str, out: &mut Vec<String>) {
    for s in line {
        let runs = if s.runs.is_empty() { String::new() } else { format!(" {:?}", s.runs) };
        out.push(format!("{what} {:?} {} {}{runs}", s.text, s.hyphen, s.extend));
    }
}

/// What the engraver read in `src`: `{ piece: [sign…], staves: [{ kind,
/// signs: [sign…] }] }`, each sign a word — the same word for the same
/// sign wherever it is written.
pub fn reading(src: &str) -> Result<Value, String> {
    let parsed = parse::parse(src).map_err(|e| e.message)?;
    let mut piece: Vec<String> = Vec::new();
    let mut header: Vec<_> = parsed.header.iter().collect();
    header.sort();
    for (key, value) in header {
        piece.push(format!("header {key} = {value}"));
    }
    piece.push(format!("paper {:?}", parsed.paper));
    piece.push(format!("spacing {:?}", parsed.spacing));
    for g in &parsed.groups {
        piece.push(format!("group {g:?}"));
    }
    for b in &parsed.blocks {
        piece.push(format!("words {:?} before {} {} {} {}", b.markup, b.before, b.page, b.part, b.then_page));
    }
    for p in &parsed.part_papers {
        piece.push(format!("part paper {p:?}"));
    }
    let staves: Vec<Value> = parsed
        .staves
        .iter()
        .map(|staff| {
            let mut out: Vec<String> = Vec::new();
            let p = &staff.props;
            out.push(format!("staff {:?}", staff.kind));
            out.push(format!("names {:?} {:?}", p.instrument_name, p.short_instrument_name));
            out.push(format!("sound {:?} {:?} {:?}", p.midi_instrument, p.midi_maximum_volume, p.midi_pan_position));
            if !p.string_tunings.is_empty() {
                out.push(format!("tuning {:?}", p.string_tunings));
            }
            if p.transposition != 0 {
                out.push(format!("transposition {}", p.transposition));
            }
            for (key, val) in &p.look {
                out.push(format!("staff set {key} = {val:?}"));
            }
            if p.below || p.above {
                out.push(format!("placed {} {}", p.below, p.above));
            }
            if let Some(line) = &staff.lyrics {
                syllables(line, "lyric", &mut out);
            }
            for (n, line) in staff.verses.iter().enumerate() {
                syllables(line, &format!("verse {}", n + 2), &mut out);
            }
            for ev in &staff.events {
                signs(ev, "", staff.kind == parse::StaffKind::ChordNames, &mut out);
            }
            json!({ "kind": format!("{:?}", staff.kind), "signs": out })
        })
        .collect();
    Ok(json!({ "piece": piece, "staves": staves }))
}
