//! What eui-score writes on the page and still leaves out of its MIDI file,
//! played: a glissando, slid through every key to the next note; and the
//! trill, mordent, turn or rolled chord of a note with `\afterGrace` notes.
//!
//! The engine plays the rest itself: arpeggios rolled (from the top under
//! `\arpeggioArrowDown`, together under `\arpeggioBracket`), trills,
//! mordents, turns, reverse turns and double pralls written out (score #978,
//! #1026), fermatas held then breathed, the short and long ones by their
//! own share (score #977, #1026), and `\transposition` sounded where it is
//! written (score #1023).
//! This module once played those too, and with the engine doing it they
//! were heard twice: it now adds only what the engine leaves out, played
//! the way the engine plays its own.
//!
//! The engraver's MIDI stays as it is; this reads the source again, finds
//! when each of those notes sounds the way `eui_score::midi` times it (bars,
//! grace notes taking their time from the note, fermatas holding and
//! breathing, `\midi { \tempo }` over the options' tempo), at the keys it
//! sounds them (`\transposition`), and rewrites the notes concerned in the
//! file's tracks.

use eui_score::measure::{measures, Bar};
use eui_score::midi::FERMATA_BREATH_SECONDS;
use eui_score::look::{changes, in_force, Val, TRANSPOSITION};
use eui_score::parse::{parse, ArpStyle, Kind, StaffKind};
use eui_score::{MidiOptions, WHOLE};

/// The ornaments the engine plays, as LilyPond's articulate.ly plays them.
const ORNAMENTS: [&str; 6] = ["trill", "prall", "mordent", "turn", "reverseturn", "prallprall"];
/// A sixty-fourth of a whole: how far apart a rolled chord's notes start.
const ROLL: i64 = WHOLE / 64;
/// A thirty-second: one note of a trill or a mordent.
const SHAKE: i64 = WHOLE / 32;

/// A change to one staff's track.
#[derive(Debug, PartialEq)]
enum Play {
    /// From key `from` at `t`, held half of `span`, then every key on the way to `to`.
    Slide { t: i64, span: i64, from: i64, to: i64 },
    /// The chord `keys` (low to high) at `t`, rolled as `rolled` says, its
    /// top note decorated by `ornament` with its neighbours in the key.
    Ornament { t: i64, keys: Vec<i64>, above: i64, below: i64, ornament: Option<&'static str>, rolled: Roll },
}

/// How a chord is rolled, as the engine rolls it: not (no arpeggio, or
/// `\arpeggioBracket`'s, played together), from its lowest note, or from
/// its highest (`\arpeggioArrowDown`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Roll {
    None,
    Up,
    Down,
}

/// A fermata's hold, as `eui_score::midi` times it: where the held note
/// ends, how much longer it sounds, the silence after.
struct Hold {
    ends: i64,
    sustain: i64,
    breath: i64,
}

/// The file `bytes`, written by `eui_score::midi` for `src` with `opts`,
/// with what it leaves out played. Answers the bytes unchanged when there is
/// nothing to add, or when the source or the file cannot be read.
pub fn perform(src: &str, bytes: Vec<u8>, opts: &MidiOptions) -> Vec<u8> {
    let Some(plays) = plays(src, opts) else { return bytes };
    if plays.iter().all(Vec::is_empty) {
        return bytes;
    }
    let Some((head, mut tracks)) = read(&bytes) else { return bytes };
    // The engraver's ticks to the file's: its header says how many a quarter.
    let division = i64::from(u16::from_be_bytes([head[12], head[13]])).max(1);
    let per = (WHOLE / 4 / division).max(1);
    // The engraver writes one track per staff it plays, in order.
    for (k, track) in tracks.iter_mut().enumerate() {
        if let Some(changes) = plays.get(k) {
            for change in changes {
                apply(track, &in_file(change, per), per);
            }
        }
    }
    write(&head, &tracks)
}

/// For each track of the file, what to play in it.
fn plays(src: &str, opts: &MidiOptions) -> Option<Vec<Vec<Play>>> {
    let parsed = parse(src).ok()?;
    // `\midi { \tempo 4 = 100 }`: the source's own tempo, over the options', as the engine has it.
    let source_tempo = parsed.paper.midi_tempo.map(|(bpm, beat)| MidiOptions { bpm: bpm as f64, beat, ..*opts });
    let opts = source_tempo.as_ref().unwrap_or(opts);
    let mut measured = Vec::new();
    for stf in &parsed.staves {
        measured.push(measures(&stf.events).ok()?);
    }
    let holds = holds(&measured, opts);
    let mut out = Vec::new();
    for (si, stf) in parsed.staves.iter().enumerate() {
        // The staves the engine does not play have no track.
        if (stf.kind == StaffKind::ChordNames && parsed.staves.len() > 1)
            || matches!(stf.kind, StaffKind::Figures | StaffKind::FretBoards | StaffKind::Ossia)
        {
            continue;
        }
        if stf.kind == StaffKind::Drums {
            out.push(Vec::new());
            continue;
        }
        // Where it sounds from where it is written, and from where that changes (score #1023).
        let shifts = Shifts { first: stf.props.transposition, changes: changes(&stf.events, TRANSPOSITION) };
        out.push(staff_plays(&measured[si], &holds, &shifts));
    }
    Some(out)
}

/// A staff's `\transposition`: the semitones it sounds from where it is
/// written at its start, and each change after, at the written tick.
struct Shifts {
    first: i64,
    changes: Vec<(i64, Val)>,
}

impl Shifts {
    /// The semitones in force at the written tick `t`.
    fn at(&self, t: i64) -> i64 {
        match in_force(&self.changes, t) {
            Some(Val::Num(n)) => *n as i64,
            _ => self.first,
        }
    }
}

fn staff_plays(bars: &[Bar], holds: &[Hold], shifts: &Shifts) -> Vec<Play> {
    // Every note, in order: its start, its length, its keys low to high, what it carries.
    struct Note<'a> {
        t: i64,
        span: i64,
        keys: Vec<i64>,
        top: i64,
        fifths: i64,
        top_d: i64,
        shift: i64,
        ev: &'a eui_score::parse::Ev,
    }
    let mut notes: Vec<Note> = Vec::new();
    let mut at = 0;
    for bar in bars {
        for ev in &bar.items {
            if ev.k == Kind::Note && !ev.heads.is_empty() {
                let t0 = at + ev.start;
                let span = ev.ticks * ev.mm.unwrap_or(1);
                // Grace notes take their time from the note: at most half of it.
                let written: i64 = ev.graces.iter().map(|g| g.ticks).sum();
                let stolen = if written > 0 { written.min(span / 2).max(1) } else { 0 };
                let shift = shifts.at(bar.tick0 + ev.start);
                let mut keys: Vec<i64> = ev.heads.iter().map(|h| key_of(h.d, h.alter) + shift).collect();
                keys.sort_unstable();
                keys.dedup();
                let top = *keys.last().unwrap_or(&60);
                let top_d = ev.heads.iter().map(|h| h.d).max().unwrap_or(0);
                notes.push(Note { t: t0 + stolen, span: span - stolen, keys, top, fifths: bar.fifths, top_d, shift, ev });
            }
        }
        at += bar.length * bar.span.unwrap_or(1);
    }
    let mut out = Vec::new();
    for (k, n) in notes.iter().enumerate() {
        // A tremolo is the engine's to play, and so is an ornament or a
        // rolled chord, unless `\afterGrace` notes follow it.
        if n.ev.tremolo > 0 || n.ev.trem_beams > 0 {
            continue;
        }
        let ornament = ORNAMENTS.into_iter().find(|name| n.ev.scripts.iter().any(|sc| sc.name == *name));
        let rolled = match (n.ev.arpeggio, n.ev.arp_style) {
            (false, _) | (true, ArpStyle::Bracket) => Roll::None,
            (true, ArpStyle::ArrowDown) => Roll::Down,
            _ => Roll::Up,
        };
        if ornament.is_some() || rolled != Roll::None {
            if !n.ev.after_graces.is_empty() {
                let above = key_of(n.top_d + 1, in_key(n.top_d + 1, n.fifths)) + n.shift;
                let below = key_of(n.top_d - 1, in_key(n.top_d - 1, n.fifths)) + n.shift;
                let t = held(holds, n.t, false);
                out.push(Play::Ornament { t, keys: n.keys.clone(), above, below, ornament, rolled });
            }
            continue;
        }
        if !n.ev.gliss {
            continue;
        }
        let Some(next) = notes.get(k + 1) else { continue };
        if (next.top - n.top).abs() > 1 {
            let start = held(holds, n.t, false);
            let span = held(holds, n.t + n.span, true) - start;
            out.push(Play::Slide { t: start, span, from: n.top, to: next.top });
        }
    }
    out
}

/// A note's key, as the engraver counts them: `c` (d 0) is 48.
fn key_of(d: i64, alter: i64) -> i64 {
    let step = d.rem_euclid(7);
    12 * ((d - step) / 7 + 4) + [0, 2, 4, 5, 7, 9, 11][step as usize] + alter
}

/// The alteration the key of `fifths` gives the step of `d`: a sharp for the
/// first `fifths` of F C G D A E B, a flat for the first of B E A D G C F.
fn in_key(d: i64, fifths: i64) -> i64 {
    const SHARPS: [i64; 7] = [3, 0, 4, 1, 5, 2, 6];
    const FLATS: [i64; 7] = [6, 2, 5, 1, 4, 0, 3];
    let step = d.rem_euclid(7);
    let count = fifths.unsigned_abs().min(7) as usize;
    if fifths > 0 && SHARPS[..count].contains(&step) {
        1
    } else if fifths < 0 && FLATS[..count].contains(&step) {
        -1
    } else {
        0
    }
}

/// Where fermatas hold, as `eui_score::midi` times them, in time order: of
/// several notes under a fermata that end together, the longest is held,
/// half its value again, then the music breathes FERMATA_BREATH_SECONDS at
/// the tempo of that moment — both by the fermata's share (`fermata_factor`).
fn holds(measured: &[Vec<Bar>], opts: &MidiOptions) -> Vec<Hold> {
    let mut by_end: Vec<(i64, i64, f64)> = Vec::new();
    let mut tempi: Vec<(i64, f64)> = Vec::new();
    for bars in measured {
        let mut at = 0;
        for bar in bars {
            for ev in &bar.items {
                if let Some(mark) = &ev.tempo {
                    if mark.bpm > 0 {
                        tempi.push((at + ev.start, quarter_seconds(mark.bpm as f64, mark.base)));
                    }
                }
                let factor = ev.scripts.iter().filter_map(|sc| fermata_factor(&sc.name)).fold(0.0, f64::max);
                if ev.k == Kind::Note && factor > 0.0 {
                    let span = ev.ticks * ev.mm.unwrap_or(1);
                    let ends = at + ev.start + span;
                    match by_end.iter_mut().find(|h| h.0 == ends) {
                        Some(h) => {
                            h.1 = h.1.max(span);
                            h.2 = h.2.max(factor);
                        }
                        None => by_end.push((ends, span, factor)),
                    }
                }
            }
            at += bar.length * bar.span.unwrap_or(1);
        }
    }
    by_end.sort_by_key(|h| h.0);
    tempi.sort_by_key(|t| t.0);
    // With no `\tempo`, the options' tempo, or MIDI's own 120 a minute.
    let first = if opts.bpm > 0.0 { quarter_seconds(opts.bpm, opts.beat) } else { 0.5 };
    by_end
        .into_iter()
        .map(|(ends, span, factor)| {
            let quarter = tempi.iter().take_while(|t| t.0 < ends).last().map_or(first, |t| t.1);
            let breath = if quarter > 0.0 { (FERMATA_BREATH_SECONDS / quarter * (WHOLE / 4) as f64).round() as i64 } else { 0 };
            let scaled = |t: i64| (t as f64 * factor).round() as i64;
            Hold { ends, sustain: scaled(span / 2), breath: scaled(breath) }
        })
        .collect()
}

/// How long a fermata holds against `\fermata`'s, as the engine has it
/// (score #1026): the very short one a quarter, the short ones half, the
/// long ones half again, the very long one twice — the extra length and
/// the breath alike. None for a script that is no fermata.
fn fermata_factor(name: &str) -> Option<f64> {
    Some(match name {
        "fermata" => 1.0,
        "veryshortfermata" => 0.25,
        "shortfermata" | "henzeshortfermata" => 0.5,
        "longfermata" | "henzelongfermata" => 1.5,
        "verylongfermata" => 2.0,
        _ => return None,
    })
}

/// A quarter's length in seconds at `bpm` beats of `beat` (4 a quarter) a minute.
fn quarter_seconds(bpm: f64, beat: i64) -> f64 {
    60.0 / bpm * beat as f64 / 4.0
}

/// A time moved past every hold before it. At a hold's own end, a note let
/// go (`off`) moves by the extra length only; a note starting, after the breath.
fn held(holds: &[Hold], t: i64, off: bool) -> i64 {
    t + holds.iter().filter(|h| h.ends <= t).map(|h| if h.ends == t && off { h.sustain } else { h.sustain + h.breath }).sum::<i64>()
}

// ---- The file ------------------------------------------------------------------

/// One event of a track: its time from the start, and its bytes.
type Event = (i64, Vec<u8>);

fn vlq_read(b: &[u8], i: &mut usize) -> Option<i64> {
    let mut v: i64 = 0;
    for _ in 0..4 {
        let byte = *b.get(*i)?;
        *i += 1;
        v = (v << 7) | i64::from(byte & 0x7f);
        if byte & 0x80 == 0 {
            return Some(v);
        }
    }
    None
}

fn vlq(mut v: i64) -> Vec<u8> {
    let mut out = vec![(v & 0x7f) as u8];
    v >>= 7;
    while v > 0 {
        out.insert(0, ((v & 0x7f) | 0x80) as u8);
        v >>= 7;
    }
    out
}

/// The header chunk and every track's events, at their times.
fn read(bytes: &[u8]) -> Option<(Vec<u8>, Vec<Vec<Event>>)> {
    if bytes.len() < 14 || &bytes[0..4] != b"MThd" {
        return None;
    }
    let head = bytes[0..14].to_vec();
    let mut tracks = Vec::new();
    let mut i = 14;
    while i + 8 <= bytes.len() {
        let len = u32::from_be_bytes(bytes[i + 4..i + 8].try_into().ok()?) as usize;
        let body = bytes.get(i + 8..i + 8 + len)?;
        if &bytes[i..i + 4] == b"MTrk" {
            tracks.push(events(body)?);
        }
        i += 8 + len;
    }
    Some((head, tracks))
}

fn events(b: &[u8]) -> Option<Vec<Event>> {
    let mut out = Vec::new();
    let mut i = 0;
    let mut t = 0;
    let mut status = 0u8;
    while i < b.len() {
        t += vlq_read(b, &mut i)?;
        let first = *b.get(i)?;
        let start = i;
        if first == 0xff {
            i += 2;
            let len = vlq_read(b, &mut i)? as usize;
            i += len;
        } else if first == 0xf0 || first == 0xf7 {
            i += 1;
            let len = vlq_read(b, &mut i)? as usize;
            i += len;
        } else {
            let mut bytes = Vec::new();
            if first & 0x80 != 0 {
                status = first;
                i += 1;
            }
            bytes.push(status);
            let data = if matches!(status & 0xf0, 0xc0 | 0xd0) { 1 } else { 2 };
            bytes.extend(b.get(i..i + data)?);
            i += data;
            out.push((t, bytes));
            continue;
        }
        out.push((t, b.get(start..i)?.to_vec()));
    }
    Some(out)
}

fn write(head: &[u8], tracks: &[Vec<Event>]) -> Vec<u8> {
    let mut out = head.to_vec();
    for track in tracks {
        let mut body = Vec::new();
        let mut last = 0;
        for (t, bytes) in track {
            body.extend(vlq(t - last));
            body.extend(bytes);
            last = *t;
        }
        out.extend(b"MTrk");
        out.extend((body.len() as u32).to_be_bytes());
        out.extend(body);
    }
    out
}

fn is_on(e: &Event, key: i64) -> bool {
    e.1.len() == 3 && e.1[0] & 0xf0 == 0x90 && e.1[2] > 0 && i64::from(e.1[1]) == key
}

fn is_off(e: &Event, key: i64) -> bool {
    e.1.len() == 3 && (e.1[0] & 0xf0 == 0x80 || (e.1[0] & 0xf0 == 0x90 && e.1[2] == 0)) && i64::from(e.1[1]) == key
}

/// The note-on of `key` at `t`, and the note-off that ends it.
fn note(track: &[Event], t: i64, key: i64) -> Option<(usize, usize)> {
    let on = track.iter().position(|e| e.0 == t && is_on(e, key))?;
    let off = track.iter().enumerate().position(|(k, e)| k > on && is_off(e, key))?;
    Some((on, off))
}

/// A change timed in the engraver's ticks, timed in the file's (`per` of them each).
fn in_file(change: &Play, per: i64) -> Play {
    let at = |t: i64| (t + per / 2) / per;
    match change {
        Play::Slide { t, span, from, to } => Play::Slide { t: at(*t), span: at(t + span) - at(*t), from: *from, to: *to },
        Play::Ornament { t, keys, above, below, ornament, rolled } => {
            Play::Ornament { t: at(*t), keys: keys.clone(), above: *above, below: *below, ornament: *ornament, rolled: *rolled }
        }
    }
}

fn apply(track: &mut Vec<Event>, change: &Play, per: i64) {
    match change {
        Play::Slide { t, span, from, to } => slide(track, *t, *span, *from, *to),
        Play::Ornament { t, keys, above, below, ornament, rolled } => ornamented(track, *t, keys, *above, *below, *ornament, *rolled, per),
    }
    // Offs before ons at one time, the end of the track last.
    let end = track.iter().position(|e| e.1 == [0xff, 0x2f, 0x00]).map(|k| track.remove(k));
    track.sort_by_key(|e| (e.0, i64::from(e.1[0] & 0xf0 == 0x90 && e.1.get(2).is_some_and(|v| *v > 0))));
    if let Some(mut end) = end {
        end.0 = end.0.max(track.last().map_or(0, |e| e.0));
        track.push(end);
    }
}

/// The note `from` at `t` held half of `span`, then every key on the way to `to`.
fn slide(track: &mut Vec<Event>, t: i64, span: i64, from: i64, to: i64) {
    let Some((on, off)) = note(track, t, from) else { return };
    let (channel, velocity) = (track[on].1[0] & 0x0f, track[on].1[2]);
    let half = span / 2;
    track[off].0 = track[off].0.min(t + half);
    let way: Vec<i64> = if to > from { (from + 1..to).collect() } else { (to + 1..from).rev().collect() };
    let each = ((span - half) / way.len() as i64).max(1);
    for (k, key) in way.iter().enumerate() {
        let at = t + half + each * k as i64;
        track.push((at, vec![0x90 | channel, *key as u8, velocity]));
        track.push((at + each, vec![0x80 | channel, *key as u8, 64]));
    }
}

/// The chord `keys` at `t`, as the engine plays an ornamented note, in the
/// time the file already gives it (an `\afterGrace` note ends where its
/// grace notes start): the keys rolled in from the lowest a sixty-fourth
/// apart when `rolled` (from the highest under `Roll::Down`; half the note
/// at most from the first to the last); the top one decorated in
/// thirty-seconds (a quarter of what is left at most each) — a trill to the
/// end, a prall above (twice for a double prall), a mordent below, a turn
/// round it, a reverse turn round it from below — then held.
#[allow(clippy::too_many_arguments)]
fn ornamented(track: &mut Vec<Event>, t: i64, keys: &[i64], above: i64, below: i64, ornament: Option<&str>, rolled: Roll, per: i64) {
    let Some(&top) = keys.last() else { return };
    let Some((top_on, top_off)) = note(track, t, top) else { return };
    let (channel, velocity) = (track[top_on].1[0] & 0x0f, track[top_on].1[2]);
    let end = track[top_off].0;
    let n = keys.len() as i64;
    let roll = if rolled != Roll::None && n > 1 { (ROLL / per).min((end - t) / 2 / (n - 1)).max(0) } else { 0 };
    let entry = |i: i64| if rolled == Roll::Down { n - 1 - i } else { i };
    for (i, key) in keys.iter().enumerate().take(keys.len() - 1) {
        if let Some((on, _)) = note(track, t, *key) {
            track[on].0 = t + entry(i as i64) * roll;
        }
    }
    // The top note, written out again from where it comes in.
    track.remove(top_off.max(top_on));
    track.remove(top_off.min(top_on));
    let mut sound = |key: i64, from: i64, to: i64| {
        if to > from {
            track.push((from, vec![0x90 | channel, key as u8, velocity]));
            track.push((to, vec![0x80 | channel, key as u8, 64]));
        }
    };
    let mut at = t + entry(n - 1) * roll;
    let unit = (SHAKE / per).min((end - at) / 4).max(1);
    if ornament == Some("trill") {
        let mut upper = false;
        while at < end {
            let next = (at + unit).min(end);
            sound(if upper { above } else { top }, at, next);
            upper = !upper;
            at = next;
        }
        return;
    }
    let figure: &[i64] = match ornament {
        Some("prall") => &[top, above],
        Some("mordent") => &[top, below],
        Some("turn") => &[above, top, below],
        Some("reverseturn") => &[below, top, above],
        Some("prallprall") => &[top, above, top, above],
        _ => &[],
    };
    for &key in figure {
        let next = (at + unit).min(end);
        sound(key, at, next);
        at = next;
    }
    sound(top, at, end);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notes(src: &str) -> Vec<Vec<(i64, i64, bool)>> {
        let opts = MidiOptions::default();
        let bytes = perform(src, eui_score::midi(src, &opts).unwrap(), &opts);
        let (_, tracks) = read(&bytes).unwrap();
        tracks
            .iter()
            .map(|track| {
                track
                    .iter()
                    .filter(|e| e.1.len() == 3 && matches!(e.1[0] & 0xf0, 0x80 | 0x90))
                    .map(|e| (e.0, i64::from(e.1[1]), e.1[0] & 0xf0 == 0x90 && e.1[2] > 0))
                    .collect()
            })
            .collect()
    }

    /// The file's ticks a whole: a quarter of 6720.
    const FILE_WHOLE: i64 = 4 * 6720;
    /// An arpeggio's step, as the engine rolls it: a sixty-fourth.
    const FILE_ROLL: i64 = FILE_WHOLE / 64;
    /// A trill's or a mordent's note, as the engine plays it: a thirty-second.
    const FILE_SHAKE: i64 = FILE_WHOLE / 32;

    fn ons(src: &str) -> Vec<(i64, i64)> {
        notes(src).concat().into_iter().filter(|n| n.2).map(|n| (n.0, n.1)).collect()
    }

    fn keys(src: &str) -> Vec<i64> {
        ons(src).into_iter().map(|n| n.1).collect()
    }

    #[test]
    fn plain_music_is_left_as_it_is() {
        // Ornaments, rolls and fermatas are the engine's: nothing added to them.
        for src in ["{ c'4 d' <e' g'>2 }", "{ c''4\\trill <c' e' g'>2\\arpeggio d'4\\fermata }"] {
            let opts = MidiOptions::default();
            let bytes = eui_score::midi(src, &opts).unwrap();
            assert_eq!(perform(src, bytes.clone(), &opts), bytes, "{src}");
        }
    }

    #[test]
    fn a_file_read_and_written_again_is_the_same() {
        let src = "{ c'4 d' <e' g'>2 }";
        let bytes = eui_score::midi(src, &MidiOptions::default()).unwrap();
        let (head, tracks) = read(&bytes).unwrap();
        assert_eq!(write(&head, &tracks), bytes);
    }

    #[test]
    fn an_arpeggio_rolls_the_chord_from_the_bottom_once() {
        let on = ons("{ <c' e' g'>2\\arpeggio r2 }");
        assert_eq!(on, vec![(0, 60), (FILE_ROLL, 64), (2 * FILE_ROLL, 67)]);
    }

    #[test]
    fn a_glissando_slides_through_every_key_to_the_next_note() {
        let on = ons("{ c'2\\glissando f'2 }");
        let keys: Vec<i64> = on.iter().map(|n| n.1).collect();
        assert_eq!(keys, vec![60, 61, 62, 63, 64, 65]);
        // Held half its length before it slides.
        assert_eq!(on[1].0, FILE_WHOLE / 4);
        assert!(on[4].0 < FILE_WHOLE / 2);
        assert_eq!(on[5].0, FILE_WHOLE / 2);
    }

    #[test]
    fn a_glissando_after_a_fermata_slides_where_the_engine_plays_it() {
        // The fermata's quarter held to a dotted quarter, then two seconds
        // (four quarters at 120) of breath: the glissando starts after both.
        let on = ons("{ c'4\\fermata d'2\\glissando g'4 }");
        let keys: Vec<i64> = on.iter().map(|n| n.1).collect();
        assert_eq!(keys, vec![60, 62, 63, 64, 65, 66, 67]);
        let start = FILE_WHOLE / 4 + FILE_WHOLE / 8 + FILE_WHOLE;
        assert_eq!(on[1].0, start);
        assert_eq!(on[2].0, start + FILE_WHOLE / 4);
    }

    #[test]
    fn a_trill_alternates_with_the_note_above_in_the_key_once() {
        let on = ons("{ \\key g \\major e''4\\trill r2. }");
        // E and F sharp, G major's, a thirty-second each through the quarter.
        let expected: Vec<(i64, i64)> = (0..8).map(|k| (k * FILE_SHAKE, if k % 2 == 0 { 76 } else { 78 })).collect();
        assert_eq!(on, expected);
    }

    #[test]
    fn a_mordent_and_a_turn_go_round_the_note_once() {
        assert_eq!(keys("{ c''4\\mordent r2. }"), vec![72, 71, 72]);
        assert_eq!(keys("{ c''4\\prall r2. }"), vec![72, 74, 72]);
        assert_eq!(keys("{ c''4\\turn r2. }"), vec![74, 72, 71, 72]);
    }

    #[test]
    fn grace_notes_keep_their_time_before_a_rolled_chord() {
        let on = ons("{ \\grace d'8 <c' e'>2\\arpeggio r2 }");
        assert_eq!(on.len(), 3);
        assert_eq!(on[0], (0, 62));
        assert!(on[1].0 > 0 && on[1].1 == 60);
        assert_eq!(on[2], (on[1].0 + FILE_ROLL, 64));
    }

    #[test]
    fn a_trill_before_after_grace_notes_is_played_until_they_come() {
        // The engine leaves this one out: the whole note, its last quarter
        // given to the grace notes, trilled through its first three.
        let on = ons("{ \\key g \\major \\afterGrace e''1\\trill { d''16 e'' } r1 }");
        let trill: Vec<(i64, i64)> = on.iter().copied().filter(|n| n.0 < 3 * FILE_WHOLE / 4).collect();
        let expected: Vec<(i64, i64)> = (0..24).map(|k| (k * FILE_SHAKE, if k % 2 == 0 { 76 } else { 78 })).collect();
        assert_eq!(trill, expected);
        // Then the grace notes, as the engine plays them.
        let after: Vec<i64> = on.iter().filter(|n| n.0 >= 3 * FILE_WHOLE / 4).map(|n| n.1).collect();
        assert_eq!(after, vec![74, 76]);
    }

    #[test]
    fn a_mordent_or_a_rolled_chord_before_after_grace_notes_is_played_once() {
        assert_eq!(keys("{ \\afterGrace c''2\\mordent { b'16 } r2 }"), vec![72, 71, 72, 71]);
        let on = ons("{ \\afterGrace <c' e' g'>2\\arpeggio { a'16 } r2 }");
        assert_eq!(on, vec![(0, 60), (FILE_ROLL, 64), (2 * FILE_ROLL, 67), (3 * FILE_WHOLE / 8, 69)]);
    }

    #[test]
    fn the_engine_plays_the_new_ornaments_and_rolls_itself() {
        // A reverse turn, a double prall, a chord rolled from the top, one
        // played together, a short fermata: nothing added (score #1026).
        for src in [
            "{ c''4\\reverseturn d''4\\prallprall r2 }",
            "{ \\arpeggioArrowDown <c' e' g'>2\\arpeggio \\arpeggioBracket <c' e' g'>2\\arpeggio }",
            "{ c'4\\shortfermata d'4\\longfermata e'2 }",
        ] {
            let opts = MidiOptions::default();
            let bytes = eui_score::midi(src, &opts).unwrap();
            assert_eq!(perform(src, bytes.clone(), &opts), bytes, "{src}");
        }
    }

    #[test]
    fn a_reverse_turn_or_a_double_prall_before_after_grace_notes_is_played_once() {
        assert_eq!(keys("{ \\afterGrace c''2\\reverseturn { d''16 } r2 }"), vec![71, 72, 74, 72, 74]);
        assert_eq!(keys("{ \\afterGrace c''2\\prallprall { b'16 } r2 }"), vec![72, 74, 72, 74, 72, 71]);
    }

    #[test]
    fn a_chord_before_after_grace_notes_rolls_as_its_sign_says() {
        // From the top under \arpeggioArrowDown; together under \arpeggioBracket.
        let down = ons("{ \\arpeggioArrowDown \\afterGrace <c' e' g'>2\\arpeggio { a'16 } r2 }");
        assert_eq!(down, vec![(0, 67), (FILE_ROLL, 64), (2 * FILE_ROLL, 60), (3 * FILE_WHOLE / 8, 69)]);
        let together = ons("{ \\arpeggioBracket \\afterGrace <c' e' g'>2\\arpeggio\\mordent { a'16 } r2 }");
        assert_eq!(&together[..3], &[(0, 60), (0, 64), (0, 67)]);
    }

    #[test]
    fn a_glissando_slides_where_the_instrument_sounds() {
        // A clarinet in B flat: written D to G, sounding C to F (score #1023).
        assert_eq!(keys("{ \\transposition bes d'2\\glissando g'2 }"), vec![60, 61, 62, 63, 64, 65]);
        // The flute taking the piccolo halfway: the slide an octave up.
        let on = keys("{ c'2 d'2 | \\transposition c'' c'2\\glissando e'2 }");
        assert_eq!(on, vec![60, 62, 72, 73, 74, 75, 76]);
    }

    #[test]
    fn a_glissando_after_a_short_fermata_slides_where_the_engine_plays_it() {
        // Half the hold and half the breath of a \fermata.
        let on = ons("{ c'4\\shortfermata d'2\\glissando g'4 }");
        let start = FILE_WHOLE / 4 + FILE_WHOLE / 16 + FILE_WHOLE / 2;
        assert_eq!(on[1], (start, 62));
        assert_eq!(on[2].0, start + FILE_WHOLE / 4);
    }

    #[test]
    fn a_glissando_keeps_to_the_tempo_the_source_gives_its_midi() {
        // \midi's 60 a minute: the fermata's two seconds are two quarters.
        let on = ons("\\score { { c'4\\fermata d'2\\glissando g'4 } \\midi { \\tempo 4 = 60 } }");
        let start = FILE_WHOLE / 4 + FILE_WHOLE / 8 + FILE_WHOLE / 2;
        assert_eq!(on[1], (start, 62));
        assert_eq!(on[2].0, start + FILE_WHOLE / 4);
    }

    #[test]
    fn every_note_on_is_ended() {
        for src in [
            "{ c'2\\glissando c''2 }",
            "{ c''1\\trill }",
            "{ c''4\\turn d'' e'' f'' }",
            "{ <c' e' g' c''>1\\arpeggio }",
            "{ \\afterGrace <c'' e''>1\\turn\\arpeggio { d''16 } }",
            "{ \\afterGrace c''1\\trill { b'16 c'' } }",
        ] {
            for track in notes(src) {
                let on = track.iter().filter(|n| n.2).count();
                let off = track.iter().filter(|n| !n.2).count();
                assert_eq!(on, off, "{src}");
            }
        }
    }
}
