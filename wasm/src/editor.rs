//! The editor's half of the module: what is under the pointer, and edits
//! made in the LilyPond text itself.
//!
//! Every edit goes through `eui_score::edit` where it can — the functions
//! EUI's own score editor and client use — and rewrites only the characters
//! that spell a pitch or a note. Each result is engraved before it is
//! answered: an edit the engraver would refuse is refused here, with the
//! engraver's reason, and the source the page holds never becomes one it
//! cannot draw.

use std::collections::BTreeMap;
use std::fmt::Write;

use eui_score::edit::{self, Move, NotEditable};
use eui_score::parse::{self, Clef, Kind, Parsed};
use eui_score::{Layout, Path};
use serde_json::{json, Value};

use crate::{outline, px, rect};

/// Character positions (what the parser counts) to byte offsets.
fn byte_offsets(src: &str) -> Vec<usize> {
    src.char_indices().map(|(b, _)| b).chain(std::iter::once(src.len())).collect()
}

/// The bytes a pitch takes at the start of `s`: letters, then octave marks.
fn pitch_len(s: &str) -> usize {
    let letters = s.bytes().take_while(u8::is_ascii_alphabetic).count();
    letters + s[letters..].bytes().take_while(|b| *b == b'\'' || *b == b',').count()
}

/// Why a source cannot be edited, as the page says it, or `None`.
fn not_editable(src: &str) -> Option<&'static str> {
    match edit::item(src, usize::MAX) {
        Ok(_) => None,
        Err(NotEditable::Refused) => Some("refused"),
        Err(NotEditable::Relative) => Some("relative"),
        Err(NotEditable::Transposed) => Some("transposed"),
        Err(NotEditable::Language) => Some("language"),
    }
}

/// A note or rest numbered `item`, with the clef and key in force there and
/// the pitch of the last note before it.
struct Found<'a> {
    ev: &'a parse::Ev,
    clef: Clef,
    fifths: i64,
    previous: Option<i64>,
}

fn find(parsed: &Parsed, item: usize) -> Option<Found<'_>> {
    for staff in &parsed.staves {
        let (mut clef, mut fifths, mut previous) = (Clef::default(), 0, None);
        for ev in &staff.events {
            match ev.k {
                Kind::Clef => clef = ev.clef,
                Kind::Key => fifths = ev.fifths,
                Kind::Note | Kind::Rest if ev.i == item => return Some(Found { ev, clef, fifths, previous }),
                Kind::Note => previous = ev.pitches.first().map(|p| p.d).or(previous),
                _ => {}
            }
        }
    }
    None
}

/// The staff's middle line as a diatonic number, for a clef.
fn middle(clef: Clef) -> i64 {
    // At the clef's own position: treble's middle line is b' (13).
    edit::at_position(clef, 0, 4).0
}

/// The pitch with step `step` nearest `near`.
fn nearest_step(step: i64, near: i64) -> i64 {
    let base = near - near.rem_euclid(7) + step;
    [base - 7, base, base + 7].into_iter().min_by_key(|d| (d - near).abs()).unwrap_or(base)
}

/// The byte range a note or rest is written in: its pitch, or `<…>` for a
/// chord, or its `r`.
fn token_span(src: &str, at_byte: usize) -> Option<std::ops::Range<usize>> {
    let rest = src.get(at_byte..)?;
    if rest.starts_with('<') {
        let close = rest.find('>')?;
        return Some(at_byte..at_byte + close + 1);
    }
    let len = pitch_len(rest);
    (len > 0).then_some(at_byte..at_byte + len)
}

/// Engraves `src` and answers it, or the engraver's reason for refusing it.
fn checked(src: String) -> Result<String, String> {
    match eui_score::engrave(&src, 120.0, &Layout::default()) {
        Ok(_) => Ok(src),
        Err(e) => Err(e.message),
    }
}

fn splice(src: &str, span: std::ops::Range<usize>, with: &str) -> String {
    let mut out = String::with_capacity(src.len() + with.len());
    out.push_str(&src[..span.start]);
    out.push_str(with);
    out.push_str(&src[span.end..]);
    out
}

/// What the page needs to draw and to hit-test: the SVG, every item's box
/// and every head's, and what each item is. `selected` and `head` light
/// the selection (−1 for none).
pub fn view(src: &str, width: f64, sp: f64, selected: i64, head: i64) -> Result<Value, String> {
    let mut lit = json!({ "items": {}, "heads": [] });
    if selected >= 0 {
        lit["items"][selected.to_string()] = json!("#b4373a");
        if head >= 0 {
            lit["heads"] = json!([[selected, head, "#e0662a"]]);
        }
    }
    view_lit(src, width, sp, &lit)
}

/// [`view`] with any number of items and heads lit: `lit` is
/// `{"items": {"3": "#colour", …}, "heads": [[item, head index, "#colour"], …]}`.
pub fn view_lit(src: &str, width: f64, sp: f64, lit: &Value) -> Result<Value, String> {
    let eng = eui_score::engrave(src, (width / sp).max(10.0), &Layout::default()).map_err(|e| e.message)?;
    let (paths, ranges, heads) = eui_score::paths_heads(&eng, sp, 0).map_err(|e| e.message)?;
    let parsed = parse::parse(src).map_err(|e| e.message)?;

    // Which paths light, and in which colour: whole items, then single heads.
    let safe = |c: &str| !c.is_empty() && c.len() < 40 && c.chars().all(|ch| ch.is_ascii_alphanumeric() || "#(),.% -".contains(ch));
    let mut colour: BTreeMap<usize, String> = BTreeMap::new();
    if let Some(items) = lit["items"].as_object() {
        for (item, range) in &ranges {
            if let Some(c) = items.get(&item.to_string()).and_then(Value::as_str).filter(|c| safe(c)) {
                for k in range.clone() {
                    colour.insert(k, c.to_string());
                }
            }
        }
    }
    for entry in lit["heads"].as_array().map_or(&[][..], Vec::as_slice) {
        let (Some(item), Some(index), Some(c)) = (entry[0].as_u64(), entry[1].as_u64(), entry[2].as_str()) else { continue };
        if !safe(c) {
            continue;
        }
        let Some(Found { ev, .. }) = find(&parsed, item as usize) else { continue };
        let Some(want) = ev.pitches.get(index as usize).map(|p| p.d) else { continue };
        for (i, d, range) in &heads {
            if *i as u64 == item && *d == want {
                for k in range.clone() {
                    colour.insert(k, c.to_string());
                }
            }
        }
    }

    let mut glyph_ids: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let (mut defs, mut body, mut over) = (String::new(), String::new(), String::new());
    let mut right = 0.0_f64;
    let mut boxes: Vec<[f64; 4]> = Vec::with_capacity(paths.len());
    for (k, path) in paths.iter().enumerate() {
        let lit = colour.get(&k).map(String::as_str);
        match path {
            Path::Rect(r) => {
                right = right.max(r[0] + r[2]);
                boxes.push([r[0], r[1], r[0] + r[2], r[1] + r[3]]);
                rect(if lit.is_some() { &mut over } else { &mut body }, r, 0.0, lit);
            }
            Path::Fill(cmds) => {
                let (d, x, y, r) = outline(cmds);
                right = right.max(r);
                boxes.push(fill_box(cmds));
                if let Some(c) = lit {
                    let _ = write!(over, "<path fill=\"{c}\" transform=\"translate(");
                    px(&mut over, x);
                    over.push(' ');
                    px(&mut over, y);
                    let _ = write!(over, ")\" d=\"{d}\"/>");
                    continue;
                }
                let next = glyph_ids.len();
                let n = *glyph_ids.entry(d.clone()).or_insert_with(|| {
                    let _ = write!(defs, "<path id=\"ed-{next}\" d=\"{d}\"/>");
                    next
                });
                let _ = write!(body, "<use href=\"#ed-{n}\" x=\"");
                px(&mut body, x);
                body.push_str("\" y=\"");
                px(&mut body, y);
                body.push_str("\"/>");
            }
        }
    }
    // The drawing's height is its ink's, not only the system's: a clef
    // reaches below a staff of rests, and was cut.
    let ink_top = boxes.iter().map(|b| b[1]).fold(0.0_f64, f64::min).floor() - 2.0;
    let ink_bottom = boxes.iter().map(|b| b[3]).fold(eng.height * sp, f64::max).ceil() + 2.0;
    let y0 = ink_top.min(0.0);
    let total = ink_bottom - y0;
    let w = (right + 2.0).ceil();
    let svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 {y0} {w} {total}\" width=\"{w}\" height=\"{total}\" role=\"img\" aria-label=\"Score\"><defs>{defs}</defs><g fill=\"currentColor\">{body}</g>{over}</svg>"
    );

    let union = |range: &std::ops::Range<usize>, acc: Option<[f64; 4]>| {
        boxes.get(range.clone()).unwrap_or(&[]).iter().fold(acc, |acc, b| {
            Some(match acc {
                None => *b,
                Some(a) => [a[0].min(b[0]), a[1].min(b[1]), a[2].max(b[2]), a[3].max(b[3])],
            })
        })
    };
    let mut item_boxes: BTreeMap<usize, [f64; 4]> = BTreeMap::new();
    for (item, range) in &ranges {
        if let Some(b) = union(range, item_boxes.get(item).copied()) {
            item_boxes.insert(*item, b);
        }
    }
    let mut items = Vec::new();
    for (item, b) in &item_boxes {
        let Some(found) = find(&parsed, *item) else { continue };
        let ev = found.ev;
        let kind = if ev.k == Kind::Rest { if ev.full { "bar-rest" } else { "rest" } } else { "note" };
        let head_list: Vec<Value> = heads
            .iter()
            .filter(|(i, _, _)| i == item)
            .filter_map(|(_, d, range)| {
                let hb = union(range, None)?;
                let index = ev.pitches.iter().position(|p| p.d == *d)?;
                Some(json!({ "index": index, "d": d, "alter": ev.pitches[index].alter, "box": hb }))
            })
            .collect();
        items.push(json!({ "item": item, "kind": kind, "box": b, "heads": head_list }));
    }
    // Every bar's box, in the SVG's pixels: from its start to its bar line,
    // as tall as its system — what a drag across the score selects, and
    // where a repeat's edges can be taken and moved.
    let mut bar_boxes = Vec::new();
    for (k, sys) in eng.systems.iter().enumerate() {
        let Some(line) = sys.lines.first() else { continue };
        let Some(staff_bars) = eng.staves.first() else { continue };
        let last = sys.offsets.last().copied().unwrap_or(0.0);
        let (y0, y1) = ((sys.top - 1.0) * sp, (sys.top + last + 5.0) * sp);
        let staves: Vec<f64> = if sys.offsets.is_empty() { vec![sys.top * sp] } else { sys.offsets.iter().map(|o| (sys.top + o) * sp).collect() };
        for b in line.bars.clone() {
            let Some(bar) = staff_bars.get(b) else { continue };
            bar_boxes.push(json!({ "bar": b, "system": k, "box": [bar.x0 * sp, y0, bar.x1 * sp, y1], "staves": staves }));
        }
    }
    Ok(json!({ "svg": svg, "width": w, "height": total, "y0": y0, "items": items, "bars": bar_boxes, "editable": not_editable(src).unwrap_or("yes") }))
}

/// The bounding box of an outline's points.
pub(crate) fn fill_box(cmds: &[f64]) -> [f64; 4] {
    let mut b = [f64::MAX, f64::MAX, f64::MIN, f64::MIN];
    let mut i = 0;
    while i < cmds.len() {
        let pairs = match cmds[i] as i64 {
            0 | 1 => 1,
            2 => 2,
            3 => 3,
            _ => 0,
        };
        for p in 0..pairs {
            if let (Some(&x), Some(&y)) = (cmds.get(i + 1 + p * 2), cmds.get(i + 2 + p * 2)) {
                b = [b[0].min(x), b[1].min(y), b[2].max(x), b[3].max(y)];
            }
        }
        i += 1 + pairs * 2;
    }
    b
}

/// One edit, described by the page as JSON; the new source, or why not.
pub fn apply(src: &str, op: &Value) -> Result<String, String> {
    let name = op["op"].as_str().unwrap_or("");
    if name == "absolute" {
        return absolute(src);
    }
    if name == "append-bar" {
        return append_bar(src);
    }
    if let Some(why) = not_editable(src) {
        return Err(match why {
            "relative" => "relative".into(),
            "transposed" => "a source under \\transpose cannot be edited note by note".into(),
            "language" => "a source in another note language cannot be edited note by note".into(),
            _ => "the engraver refuses this source".into(),
        });
    }
    let item = op["item"].as_u64().ok_or("no item")? as usize;
    let head = op["head"].as_i64().unwrap_or(-1);
    let parsed = parse::parse(src).map_err(|e| e.message)?;
    let found = find(&parsed, item).ok_or("no such note")?;
    let bytes = byte_offsets(src);
    let at = *bytes.get(found.ev.at).ok_or("no such note")?;

    match name {
        "move" | "drag" | "letter" | "alter" | "rest" if found.ev.k == Kind::Note => {}
        "letter" if found.ev.k == Kind::Rest && !found.ev.full => {
            // A rest becomes a note of its own length, near the last note.
            let step = op["step"].as_i64().ok_or("no step")?.rem_euclid(7);
            let near = found.previous.unwrap_or_else(|| middle(found.clef));
            let (d, alter) = edit::in_key(found.fifths, nearest_step(step, near));
            if !src[at..].starts_with('r') {
                return Err("only a written rest can become a note".into());
            }
            return checked(splice(src, at..at + 1, &edit::spell(d, alter)));
        }
        _ if found.ev.k == Kind::Rest => return Err("select a note".into()),
        _ => return Err(format!("unknown edit {name}")),
    }

    let it = edit::item(src, item).map_err(|_| "not editable".to_string())?.ok_or("this note has no pitch to edit")?;
    let head = if head >= 0 && (head as usize) < it.heads.len() { Some(head as usize) } else { None };
    let new_heads = match name {
        "move" => {
            let by = op["by"].as_i64().unwrap_or(1);
            let how = match op["how"].as_str().unwrap_or("step") {
                "semitone" => Move::Semitone(by),
                "octave" => Move::Octave(by),
                _ => Move::Step(by),
            };
            match head {
                Some(h) if it.heads.len() > 1 => edit::moved_head(&it, h, how),
                _ => edit::moved(&it, how),
            }
            .ok_or("that is as far as the staff reaches")?
        }
        "drag" => {
            let h = head.unwrap_or(0);
            let from = op["from"].as_array().ok_or("no starting pitch")?;
            let from = (from.first().and_then(Value::as_i64).unwrap_or(0), from.get(1).and_then(Value::as_i64).unwrap_or(0));
            let by = op["by"].as_i64().unwrap_or(0);
            let base = edit::Item { heads: it.heads.clone(), ..it.clone() };
            if op["chromatic"].as_bool().unwrap_or(false) {
                edit::dragged_chromatic(&base, h, from, by)
            } else {
                edit::dragged(&base, h, from.0, by)
            }
            .ok_or("that is as far as the staff reaches")?
        }
        "letter" => {
            let step = op["step"].as_i64().ok_or("no step")?.rem_euclid(7);
            if op["add"].as_bool().unwrap_or(false) {
                // Shift + a letter: that note added above the chord's top.
                let top = it.heads.iter().map(|h| h.0).max().unwrap_or(0);
                let mut d = top - top.rem_euclid(7) + step;
                if d <= top {
                    d += 7;
                }
                let (d, alter) = edit::in_key(it.fifths, d);
                if !edit::fits(it.clef, d, alter) {
                    return Err("that is as far as the staff reaches".into());
                }
                return add_to_chord(src, &it, at, d, alter);
            }
            let h = head.unwrap_or(0);
            let (d, alter) = edit::in_key(it.fifths, nearest_step(step, it.heads[h].0));
            let mut heads = it.heads.clone();
            heads[h] = (d, alter);
            heads.sort_by_key(|x| x.0);
            heads
        }
        "alter" => {
            let alter = op["alter"].as_i64().unwrap_or(0).clamp(-2, 2);
            let mut heads = it.heads.clone();
            for (k, h) in heads.iter_mut().enumerate() {
                if head.is_none_or(|sel| sel == k) {
                    h.1 = alter;
                }
            }
            heads
        }
        "rest" => {
            // A note, or a whole chord, becomes a rest of the same length.
            let span = token_span(src, at).ok_or("no such note")?;
            if head.is_some() && it.heads.len() > 1 {
                return remove_head(src, &it, head.unwrap_or(0));
            }
            return checked(splice(src, span, "r"));
        }
        _ => unreachable!(),
    };
    checked(edit::rewrite(src, &it, &new_heads))
}

/// `(d, alter)` added to the note or chord `it`, which starts at `at`.
fn add_to_chord(src: &str, it: &edit::Item, at: usize, d: i64, alter: i64) -> Result<String, String> {
    let pitch = edit::spell(d, alter);
    if src[at..].starts_with('<') {
        let close = at + src[at..].find('>').ok_or("an unclosed chord")?;
        return checked(splice(src, close..close, &format!(" {pitch}")));
    }
    let span = it.spans.first().ok_or("no pitch")?.clone();
    let old = &src[span.clone()];
    checked(splice(src, span.clone(), &format!("<{old} {pitch}>")))
}

/// Head `head` taken out of a chord.
fn remove_head(src: &str, it: &edit::Item, head: usize) -> Result<String, String> {
    let span = it.spans.get(head).ok_or("no such head")?.clone();
    // The pitch and the space before it.
    let mut start = span.start;
    while start > 0 && src.as_bytes()[start - 1] == b' ' {
        start -= 1;
    }
    checked(splice(src, start..span.end, ""))
}

/// A bar of rests added after the last note or rest of every staff, in the
/// metre in force there: the room A–G then writes into.
fn append_bar(src: &str) -> Result<String, String> {
    let parsed = parse::parse(src).map_err(|e| e.message)?;
    let bytes = byte_offsets(src);
    let mut inserts: Vec<(usize, String)> = Vec::new();
    for staff in &parsed.staves {
        let mut time = (4, 4);
        let mut last: Option<&parse::Ev> = None;
        for ev in &staff.events {
            match ev.k {
                Kind::Time => time = ev.time,
                Kind::Note | Kind::Rest => last = Some(ev),
                _ => {}
            }
        }
        let Some(ev) = last else { continue };
        let at = *bytes.get(ev.at).ok_or("no such note")?;
        // The end of its word: the note (a chord to its `>`), its duration
        // and what is written on it.
        let word = token_span(src, at).map_or(at, |span| span.end);
        let end = word + src[word..].find(|c: char| c.is_whitespace() || c == '}').unwrap_or(src.len() - word);
        let (num, den) = time;
        let mut bar = format!(" r{den}");
        for _ in 1..num {
            bar.push_str(" r");
        }
        inserts.push((end, bar));
    }
    if inserts.is_empty() {
        return Err("no staff to add a bar to".into());
    }
    inserts.sort_by_key(|(at, _)| std::cmp::Reverse(*at));
    let mut out = src.to_string();
    for (at, text) in inserts {
        out.insert_str(at, &text);
    }
    checked(out)
}

/// `\relative` and `\fixed` written out: every pitch spelled absolute, the
/// command and its reference pitch taken away — what `eui_score::edit`
/// needs. The notes drawn are the same, or nothing is changed.
fn absolute(src: &str) -> Result<String, String> {
    if not_editable(src) != Some("relative") {
        return Ok(src.to_string());
    }
    let parsed = parse::parse(src).map_err(|e| e.message)?;
    let bytes = byte_offsets(src);
    // Every pitch, where it is written and what it is.
    let mut edits: Vec<(std::ops::Range<usize>, String)> = Vec::new();
    let mut before: Vec<(i64, i64)> = Vec::new();
    for staff in &parsed.staves {
        for ev in &staff.events {
            if ev.k != Kind::Note || ev.pitch_at.len() != ev.pitches.len() {
                continue;
            }
            for (at, p) in ev.pitch_at.iter().zip(&ev.pitches) {
                let start = *bytes.get(*at).ok_or("a pitch out of place")?;
                edits.push((start..start + pitch_len(&src[start..]), edit::spell(p.d, p.alter)));
                before.push((p.d, p.alter));
            }
        }
    }
    // `\relative c'` and `\fixed c'`, outside comments and strings.
    let b = src.as_bytes();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' => {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
            }
            b'"' => {
                i += 1;
                while i < b.len() && b[i] != b'"' {
                    i += 1;
                }
                i += 1;
            }
            b'\\' => {
                let word: String = src[i + 1..].chars().take_while(char::is_ascii_alphabetic).collect();
                let mut end = i + 1 + word.len();
                if word == "relative" || word == "fixed" {
                    let mut j = end;
                    while j < b.len() && b[j].is_ascii_whitespace() {
                        j += 1;
                    }
                    let len = pitch_len(&src[j..]);
                    if len > 0 {
                        end = j + len;
                    }
                    while end < b.len() && b[end] == b' ' {
                        end += 1;
                    }
                    edits.push((i..end, String::new()));
                }
                i = end.max(i + 1);
            }
            _ => i += 1,
        }
    }
    edits.sort_by_key(|(r, _)| std::cmp::Reverse(r.start));
    let mut out = src.to_string();
    for (range, with) in edits {
        out.replace_range(range, &with);
    }
    // The same notes, or nothing.
    let reparsed = parse::parse(&out).map_err(|_| "could not write this source in absolute pitches".to_string())?;
    let after: Vec<(i64, i64)> = reparsed
        .staves
        .iter()
        .flat_map(|s| s.events.iter())
        .filter(|ev| ev.k == Kind::Note && ev.pitch_at.len() == ev.pitches.len())
        .flat_map(|ev| ev.pitches.iter().map(|p| (p.d, p.alter)))
        .collect();
    if after != before {
        return Err("could not write this source in absolute pitches".into());
    }
    checked(out)
}

/// The piece as the editor's model reads it: the header, the staff groups,
/// and every staff's events with what the editor keeps of each — and, per
/// event, what it uses that the model does not keep (`unsupported`), so the
/// page can say so instead of losing it.
pub fn score(src: &str) -> Result<Value, String> {
    let parsed = parse::parse(src).map_err(|e| e.message)?;
    let header: serde_json::Map<String, Value> = parsed.header.iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect();
    let groups: Vec<Value> = parsed
        .groups
        .iter()
        .map(|g| json!({ "kind": format!("{:?}", g.kind), "first": g.first, "last": g.last, "depth": g.depth, "name": g.name, "short": g.short }))
        .collect();
    let mut staves = Vec::new();
    for staff in &parsed.staves {
        let mut events = Vec::new();
        for ev in &staff.events {
            let mut unsupported: Vec<&str> = Vec::new();
            match ev.k {
                Kind::Partial => unsupported.push("a pickup bar"),
                Kind::CadenzaOn | Kind::CadenzaOff => unsupported.push("a cadenza"),
                Kind::Ottava => unsupported.push("\\ottava"),
                Kind::Mark => unsupported.push("rehearsal marks"),
                _ => {}
            }
            if !ev.fingers.is_empty() {
                unsupported.push("fingerings");
            }
            if ev.phrase_on || ev.phrase_off {
                unsupported.push("phrasing slurs");
            }
            if ev.arpeggio {
                unsupported.push("arpeggios");
            }
            if ev.gliss {
                unsupported.push("glissandi");
            }
            if ev.tremolo > 0 {
                unsupported.push("tremolos");
            }
            if !ev.graces.is_empty() || ev.grace.is_some() {
                unsupported.push("grace notes");
            }
            if ev.percent.is_some() {
                unsupported.push("percent repeats");
            }
            let tempo = ev.tempo.as_ref().map(|t| json!({ "text": t.text, "base": t.base, "bpm": t.bpm }));
            let chord_name: String = ev.chord_name.iter().map(|r| r.text.as_str()).collect();
            events.push(json!({
                "k": format!("{:?}", ev.k),
                "i": ev.i,
                "ticks": ev.ticks,
                "base": ev.base,
                "dots": ev.dots,
                "full": ev.full,
                "count": ev.count,
                "pitches": ev.pitches.iter().map(|p| [p.d, p.alter]).collect::<Vec<_>>(),
                // A drum note's strokes, each where it is drawn and the General MIDI key it plays.
                "drums": ev.drums.iter().map(|d| [d.d, d.key]).collect::<Vec<_>>(),
                "tie": ev.tie,
                "slur_on": ev.slur_on,
                "slur_off": ev.slur_off,
                "scripts": ev.scripts.iter().map(|s| json!([s.name, s.dir])).collect::<Vec<_>>(),
                "texts": ev.texts.iter().map(|w| json!([w.text, w.dir])).collect::<Vec<_>>(),
                "dynamic": ev.dynamic,
                "hairpin": ev.hairpin.map(|c| c.to_string()),
                "hairpin_end": ev.hairpin_end,
                "tuplet": ev.tuplet.as_ref().map(|t| json!([t.id, t.n, t.d])),
                "chord_name": chord_name,
                "clef": [format!("{:?}", ev.clef.sign), ev.clef.line, ev.clef.octave],
                "fifths": ev.fifths,
                "time": [ev.time.0, ev.time.1],
                "tempo": tempo,
                "bar": ev.v,
                "unsupported": unsupported,
            }));
        }
        let lyrics = staff.lyrics.as_ref().map(|syl| syl.iter().map(|s| json!({ "text": s.text, "hyphen": s.hyphen, "extend": s.extend })).collect::<Vec<_>>());
        staves.push(json!({
            "kind": format!("{:?}", staff.kind),
            "name": staff.props.instrument_name,
            "short": staff.props.short_instrument_name,
            "instrument": staff.props.midi_instrument,
            "lyrics": lyrics,
            "lyrics_voice": staff.lyrics_voice,
            "events": events,
        }));
    }
    Ok(json!({ "header": header, "groups": groups, "staves": staves }))
}
