//! What eui-score writes on the page and leaves out of its MIDI file, played:
//! an arpeggio rolled from the lowest note up, a glissando slid to the next
//! note, and the ornaments — trill, short trill, mordent, turn — played out.
//!
//! The engraver's MIDI stays as it is; this reads the source again, finds
//! when each of those notes sounds the way `eui_score::midi` times them
//! (bars, grace notes taking their time from the note, fermatas holding),
//! and rewrites the notes concerned in the file's tracks.

use eui_score::measure::{measures, Bar};
use eui_score::parse::{parse, Kind, StaffKind};
use eui_score::WHOLE;

/// A sixty-fourth of a whole: how far apart an arpeggio's notes start.
const ROLL: i64 = WHOLE / 48;
/// A thirty-second: one note of a trill or a mordent.
const SHAKE: i64 = WHOLE / 32;

/// A change to one staff's track.
#[derive(Debug, PartialEq)]
enum Play {
    /// The chord's keys at `t` started one after the other, lowest first.
    Roll { t: i64, keys: Vec<i64>, span: i64 },
    /// From key `from` at `t`, held half of `span`, then every key on the way to `to`.
    Slide { t: i64, span: i64, from: i64, to: i64 },
    /// The note `key` at `t` decorated with its neighbours, over `span`.
    Ornament { t: i64, span: i64, key: i64, upper: i64, lower: i64, name: &'static str },
}

/// The file `bytes`, written by `eui_score::midi` for `src`, with what it
/// leaves out played. Answers the bytes unchanged when there is nothing to
/// add, or when the source or the file cannot be read.
pub fn perform(src: &str, bytes: Vec<u8>) -> Vec<u8> {
    let Some(plays) = plays(src) else { return bytes };
    if plays.iter().all(Vec::is_empty) {
        return bytes;
    }
    let Some((head, mut tracks)) = read(&bytes) else { return bytes };
    // The engraver's ticks to the file's: its header says how many a quarter.
    let division = i64::from(u16::from_be_bytes([head[12], head[13]])).max(1);
    let per = (WHOLE / 4 / division).max(1);
    // The tempo track, when the file has one, is the first; the engraver
    // writes one track per staff, so the staves are its tracks in order.
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
fn plays(src: &str) -> Option<Vec<Vec<Play>>> {
    let parsed = parse(src).ok()?;
    let mut measured = Vec::new();
    for stf in &parsed.staves {
        measured.push(measures(&stf.events).ok()?);
    }
    let holds = holds(&measured);
    let mut out = Vec::new();
    for (si, stf) in parsed.staves.iter().enumerate() {
        if stf.kind == StaffKind::ChordNames && parsed.staves.len() > 1 {
            continue;
        }
        if stf.kind == StaffKind::Drums {
            out.push(Vec::new());
            continue;
        }
        out.push(staff_plays(&measured[si], &holds));
    }
    Some(out)
}

fn staff_plays(bars: &[Bar], holds: &[(i64, i64)]) -> Vec<Play> {
    // Every note, in order: its start, its length, its keys low to high, what it carries.
    struct Note<'a> {
        t: i64,
        span: i64,
        keys: Vec<i64>,
        fifths: i64,
        top_d: i64,
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
                let mut keys: Vec<i64> = ev.heads.iter().map(|h| key_of(h.d, h.alter)).collect();
                keys.sort_unstable();
                let top_d = ev.heads.iter().map(|h| h.d).max().unwrap_or(0);
                notes.push(Note { t: t0 + stolen, span: span - stolen, keys, fifths: bar.fifths, top_d, ev });
            }
        }
        at += bar.length * bar.span.unwrap_or(1);
    }
    let mut out = Vec::new();
    for (k, n) in notes.iter().enumerate() {
        let start = held(holds, n.t);
        let span = held(holds, n.t + n.span) - start;
        let top = *n.keys.last().unwrap_or(&60);
        if n.ev.arpeggio && n.keys.len() > 1 && n.ev.tremolo == 0 {
            out.push(Play::Roll { t: start, keys: n.keys.clone(), span });
        }
        if n.ev.gliss && n.ev.tremolo == 0 {
            if let Some(next) = notes.get(k + 1) {
                let to = *next.keys.last().unwrap_or(&top);
                if (to - top).abs() > 1 {
                    out.push(Play::Slide { t: start, span, from: top, to });
                }
            }
        }
        for sc in &n.ev.scripts {
            let name = match sc.name.as_str() {
                "trill" => "trill",
                "prall" => "prall",
                "mordent" => "mordent",
                "turn" => "turn",
                _ => continue,
            };
            if n.ev.tremolo > 0 {
                continue;
            }
            let upper = key_of(n.top_d + 1, alter_in(n.fifths, n.top_d + 1));
            let lower = key_of(n.top_d - 1, alter_in(n.fifths, n.top_d - 1));
            out.push(Play::Ornament { t: start, span, key: top, upper, lower, name });
            break;
        }
    }
    out
}

/// A note's key, as the engraver counts them: `c` (d 0) is 48.
fn key_of(d: i64, alter: i64) -> i64 {
    let step = d.rem_euclid(7);
    12 * ((d - step) / 7 + 4) + [0, 2, 4, 5, 7, 9, 11][step as usize] + alter
}

/// What key `fifths` does to the step of `d`: 1 a sharp, -1 a flat.
fn alter_in(fifths: i64, d: i64) -> i64 {
    let step = d.rem_euclid(7);
    // F C G D A E B take sharps in that order, the flats go the other way.
    let sharps = [3, 0, 4, 1, 5, 2, 6];
    if fifths > 0 && sharps[..fifths.min(7) as usize].contains(&step) {
        1
    } else if fifths < 0 && sharps[7 - (-fifths).min(7) as usize..].contains(&step) {
        -1
    } else {
        0
    }
}

/// Where fermatas hold, as `eui_score::midi` times them: (tick the held
/// note ends, ticks it is held for), in time order.
fn holds(measured: &[Vec<Bar>]) -> Vec<(i64, i64)> {
    let mut by_end: Vec<(i64, i64)> = Vec::new();
    for bars in measured {
        let mut at = 0;
        for bar in bars {
            for ev in &bar.items {
                if ev.k == Kind::Note && ev.scripts.iter().any(|sc| sc.name == "fermata") {
                    let span = ev.ticks * ev.mm.unwrap_or(1);
                    let ends = at + ev.start + span;
                    match by_end.iter_mut().find(|h| h.0 == ends) {
                        Some(h) => h.1 = h.1.max(span),
                        None => by_end.push((ends, span)),
                    }
                }
            }
            at += bar.length * bar.span.unwrap_or(1);
        }
    }
    by_end.sort_by_key(|h| h.0);
    by_end
}

fn held(holds: &[(i64, i64)], t: i64) -> i64 {
    t + holds.iter().filter(|h| h.0 <= t).map(|h| h.1).sum::<i64>()
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

/// A change timed in the engraver's ticks, timed in the file's (`per` of
/// them each).
fn in_file(change: &Play, per: i64) -> Play {
    let at = |t: i64| (t + per / 2) / per;
    match change {
        Play::Roll { t, keys, span } => Play::Roll { t: at(*t), keys: keys.clone(), span: at(t + span) - at(*t) },
        Play::Slide { t, span, from, to } => Play::Slide { t: at(*t), span: at(t + span) - at(*t), from: *from, to: *to },
        Play::Ornament { t, span, key, upper, lower, name } => Play::Ornament { t: at(*t), span: at(t + span) - at(*t), key: *key, upper: *upper, lower: *lower, name },
    }
}

fn apply(track: &mut Vec<Event>, change: &Play, per: i64) {
    let mut added: Vec<Event> = Vec::new();
    match change {
        Play::Roll { t, keys, span } => {
            let gap = (ROLL / per).min(span / (2 * keys.len() as i64)).max(1);
            for (k, key) in keys.iter().enumerate() {
                if let Some((on, _)) = note(track, *t, *key) {
                    track[on].0 = t + gap * k as i64;
                }
            }
        }
        Play::Slide { t, span, from, to } => {
            let Some((on, off)) = note(track, *t, *from) else { return };
            let (channel, velocity) = (track[on].1[0] & 0x0f, track[on].1[2]);
            let half = span / 2;
            let off_at = track[off].0.min(t + half);
            track[off].0 = off_at;
            let way: Vec<i64> = if to > from { (from + 1..*to).collect() } else { (to + 1..*from).rev().collect() };
            let each = ((span - half) / way.len() as i64).max(1);
            for (k, key) in way.iter().enumerate() {
                let at = t + half + each * k as i64;
                added.push((at, vec![0x90 | channel, *key as u8, velocity]));
                added.push((at + each, vec![0x80 | channel, *key as u8, 64]));
            }
        }
        Play::Ornament { t, span, key, upper, lower, name } => {
            let Some((on, off)) = note(track, *t, *key) else { return };
            let (channel, velocity) = (track[on].1[0] & 0x0f, track[on].1[2]);
            let n = (SHAKE / per).min(span / 4).max(1);
            // The notes played before the note goes on as written.
            let figure: Vec<i64> = match *name {
                "trill" => (0..(span / n - 1).max(1)).map(|k| if k % 2 == 0 { *key } else { *upper }).collect(),
                "prall" => vec![*key, *upper],
                "mordent" => vec![*key, *lower],
                _ => vec![*upper, *key, *lower],
            };
            let ends = track[off].0;
            // The written note sounds first only when the figure starts with it.
            let mut at = *t;
            let mut keys = figure.into_iter();
            if *name != "turn" {
                keys.next();
                track[off].0 = (t + n).min(ends);
                at += n;
            } else {
                // The turn starts above: the written note's own sounding moves past it.
                track[on].1[1] = *upper as u8;
                track[off].1[1] = *upper as u8;
                track[off].0 = (t + n).min(ends);
                keys.next();
                at += n;
            }
            for k in keys {
                added.push((at, vec![0x90 | channel, k as u8, velocity]));
                added.push((at + n, vec![0x80 | channel, k as u8, 64]));
                at += n;
            }
            if at < ends {
                added.push((at, vec![0x90 | channel, *key as u8, velocity]));
                added.push((ends, vec![0x80 | channel, *key as u8, 64]));
            }
        }
    }
    track.extend(added);
    // Offs before ons at one time, the end of the track last.
    let end = track.iter().position(|e| e.1 == [0xff, 0x2f, 0x00]).map(|k| track.remove(k));
    track.sort_by_key(|e| (e.0, i64::from(e.1[0] & 0xf0 == 0x90 && e.1.get(2).is_some_and(|v| *v > 0))));
    if let Some(mut end) = end {
        end.0 = end.0.max(track.last().map_or(0, |e| e.0));
        track.push(end);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notes(src: &str) -> Vec<Vec<(i64, i64, bool)>> {
        let bytes = perform(src, eui_score::midi(src, &eui_score::MidiOptions::default()).unwrap());
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
    /// An arpeggio's step, in the file's ticks.
    const FILE_ROLL: i64 = ROLL * FILE_WHOLE / WHOLE;

    fn ons(src: &str) -> Vec<(i64, i64)> {
        notes(src).concat().into_iter().filter(|n| n.2).map(|n| (n.0, n.1)).collect()
    }

    #[test]
    fn plain_music_is_left_as_it_is() {
        let src = "{ c'4 d' <e' g'>2 }";
        let bytes = eui_score::midi(src, &eui_score::MidiOptions::default()).unwrap();
        assert_eq!(perform(src, bytes.clone()), bytes);
    }

    #[test]
    fn a_file_read_and_written_again_is_the_same() {
        let src = "{ c'4 d' <e' g'>2 }";
        let bytes = eui_score::midi(src, &eui_score::MidiOptions::default()).unwrap();
        let (head, tracks) = read(&bytes).unwrap();
        assert_eq!(write(&head, &tracks), bytes);
    }

    #[test]
    fn an_arpeggio_rolls_the_chord_from_the_bottom() {
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
    fn a_trill_alternates_with_the_note_above_in_the_key() {
        let on = ons("{ \\key g \\major e''4\\trill r2. }");
        let keys: Vec<i64> = on.iter().map(|n| n.1).collect();
        // E and F sharp, G major's.
        assert_eq!(&keys[..4], &[76, 78, 76, 78]);
        assert!(on.iter().all(|n| n.0 < FILE_WHOLE / 4));
    }

    #[test]
    fn a_mordent_and_a_turn_go_round_the_note() {
        let keys = |src| ons(src).into_iter().map(|n| n.1).collect::<Vec<_>>();
        assert_eq!(keys("{ c''4\\mordent r2. }"), vec![72, 71, 72]);
        assert_eq!(keys("{ c''4\\prall r2. }"), vec![72, 74, 72]);
        assert_eq!(keys("{ c''4\\turn r2. }"), vec![74, 72, 71, 72]);
    }

    #[test]
    fn grace_notes_keep_their_time_before_a_rolled_chord() {
        let on = ons("{ \\grace d'8 <c' e'>2\\arpeggio r2 }");
        assert_eq!(on[0].1, 62);
        assert!(on[1].0 > 0 && on[1].1 == 60);
        assert_eq!(on[2], (on[1].0 + FILE_ROLL, 64));
    }

    #[test]
    fn every_note_on_is_ended() {
        for src in ["{ c'2\\glissando c''2 }", "{ c''1\\trill }", "{ c''4\\turn d'' e'' f'' }", "{ <c' e' g' c''>1\\arpeggio }"] {
            for track in notes(src) {
                let on = track.iter().filter(|n| n.2).count();
                let off = track.iter().filter(|n| !n.2).count();
                assert_eq!(on, off, "{src}");
            }
        }
    }
}
