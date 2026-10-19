//! eui-score in the browser.
//!
//! The same engraver EUI's `score()` widget and Soli's `eui_score_*`
//! builtins call, compiled to WebAssembly: a page anywhere engraves
//! LilyPond into SVG, writes its MIDI file and its A4 PDF, with no server.
//!
//! The engraver answers canvas paths — rectangles, and outlines of move,
//! line, quadratic, cubic and close commands — which map one for one onto
//! SVG. A glyph drawn twice (every notehead, every sharp, every letter of a
//! title) is one path in `<defs>`, placed by `<use>`: outlines are written
//! relative to their first point, so the same shape anywhere is the same
//! string. Coordinates keep a tenth of a pixel.

use std::collections::HashMap;
use std::fmt::Write;
use std::sync::atomic::{AtomicU32, Ordering};

use eui_score::{Layout, MidiOptions, Path};
use wasm_bindgen::prelude::*;

pub mod editor;

/// Distinguishes the `<defs>` ids of two scores on one page.
static ENGRAVINGS: AtomicU32 = AtomicU32::new(0);

/// A length to a tenth of a pixel, without a trailing ".0".
fn px(out: &mut String, v: f64) {
    let r = (v * 10.0).round() / 10.0;
    let r = if r == 0.0 { 0.0 } else { r };
    if r.fract() == 0.0 {
        let _ = write!(out, "{}", r as i64);
    } else {
        let _ = write!(out, "{r:.1}");
    }
}

/// An outline as `d`, relative to its first point: (d, x, y, rightmost x).
fn outline(cmds: &[f64]) -> (String, f64, f64, f64) {
    let (ox, oy) = (cmds.get(1).copied().unwrap_or(0.0), cmds.get(2).copied().unwrap_or(0.0));
    let mut d = String::with_capacity(cmds.len() * 5);
    let mut right = 0.0_f64;
    let mut i = 0;
    while i < cmds.len() {
        let pairs = match cmds[i] as i64 {
            0 => {
                d.push('M');
                1
            }
            1 => {
                d.push('L');
                1
            }
            2 => {
                d.push('Q');
                2
            }
            3 => {
                d.push('C');
                3
            }
            _ => {
                d.push('Z');
                0
            }
        };
        for p in 0..pairs {
            let (Some(&x), Some(&y)) = (cmds.get(i + 1 + p * 2), cmds.get(i + 2 + p * 2)) else { break };
            right = right.max(x);
            if p > 0 {
                d.push(' ');
            }
            px(&mut d, x - ox);
            d.push(' ');
            px(&mut d, y - oy);
        }
        i += 1 + pairs * 2;
    }
    (d, ox, oy, right)
}

fn rect(out: &mut String, r: &[f64; 4], top: f64, fill: Option<&str>) {
    out.push_str("<rect ");
    if let Some(f) = fill {
        let _ = write!(out, "fill=\"{f}\" ");
    }
    out.push_str("x=\"");
    px(out, r[0]);
    out.push_str("\" y=\"");
    px(out, r[1] + top);
    out.push_str("\" width=\"");
    px(out, r[2]);
    out.push_str("\" height=\"");
    px(out, r[3]);
    out.push_str("\"/>");
}

/// Only what a CSS colour can be made of: a mark's colour lands in markup.
fn safe_colour(c: &str) -> bool {
    !c.is_empty() && c.len() < 64 && c.chars().all(|ch| ch.is_ascii_alphanumeric() || "#(),.% -".contains(ch))
}

/// The score as SVG, `width` px wide at `staff_space` px between two staff
/// lines; the ink is `currentColor`. `marks` is JSON, an item's number
/// among the notes and rests (from 0, as a string) to a CSS colour: those
/// items are drawn again over the score in it. A source the engraver cannot
/// set throws its refusal, "score: … (at character N)".
#[wasm_bindgen]
pub fn svg(src: &str, width: f64, staff_space: f64, marks: &str) -> Result<String, JsError> {
    let sp = if staff_space > 0.0 { staff_space } else { 7.0 };
    let eng = eui_score::engrave(src, (width / sp).max(10.0), &Layout::default()).map_err(|e| JsError::new(&e.message))?;
    let total = (eng.height * sp).ceil() as i64;
    let bands = eui_score::bands(&eng, sp, 0, total).map_err(|e| JsError::new(&e.message))?;
    let lit: HashMap<String, String> = serde_json::from_str::<HashMap<String, String>>(marks)
        .unwrap_or_default()
        .into_iter()
        .filter(|(_, c)| safe_colour(c))
        .collect();

    let id = ENGRAVINGS.fetch_add(1, Ordering::Relaxed);
    let mut glyph_ids: HashMap<String, usize> = HashMap::new();
    let mut defs = String::new();
    let mut body = String::new();
    let mut over = String::new();
    let mut right = 0.0_f64;
    for band in &bands {
        let top = band.y as f64;
        for path in &band.paths {
            match path {
                Path::Rect(r) => {
                    right = right.max(r[0] + r[2]);
                    rect(&mut body, r, top, None);
                }
                Path::Fill(cmds) => {
                    let (d, x, y, r) = outline(cmds);
                    right = right.max(r);
                    let next = glyph_ids.len();
                    let n = *glyph_ids.entry(d.clone()).or_insert_with(|| {
                        let _ = write!(defs, "<path id=\"es{id}-{next}\" d=\"{d}\"/>");
                        next
                    });
                    let _ = write!(body, "<use href=\"#es{id}-{n}\" x=\"");
                    px(&mut body, x);
                    body.push_str("\" y=\"");
                    px(&mut body, y + top);
                    body.push_str("\"/>");
                }
            }
        }
        for (item, range) in &band.ranges {
            let Some(colour) = lit.get(&item.to_string()) else { continue };
            for path in band.paths.get(range.clone()).unwrap_or(&[]) {
                match path {
                    Path::Rect(r) => rect(&mut over, r, top, Some(colour)),
                    Path::Fill(cmds) => {
                        let (d, x, y, _) = outline(cmds);
                        let _ = write!(over, "<path fill=\"{colour}\" transform=\"translate(");
                        px(&mut over, x);
                        over.push(' ');
                        px(&mut over, y + top);
                        let _ = write!(over, ")\" d=\"{d}\"/>");
                    }
                }
            }
        }
    }
    let w = (right + 2.0).ceil() as i64;
    Ok(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {total}\" width=\"{w}\" height=\"{total}\" role=\"img\" aria-label=\"Partition\"><defs>{defs}</defs><g fill=\"currentColor\">{body}</g>{over}</svg>"
    ))
}

/// The source as a Standard MIDI File. `bpm` and `beat` give a tempo to a
/// source with none (0 for none), `program` a General MIDI instrument to a
/// staff that names none.
#[wasm_bindgen]
pub fn midi(src: &str, bpm: f64, beat: i32, program: i32) -> Result<Vec<u8>, JsError> {
    let opts = MidiOptions { bpm, beat: if beat > 0 { beat.into() } else { 4 }, program: program.into() };
    eui_score::midi(src, &opts).map_err(|e| JsError::new(&e.message))
}

/// The source on A4 as a PDF (ASCII), `title` for one its header names none.
#[wasm_bindgen]
pub fn pdf(src: &str, title: &str) -> Result<String, JsError> {
    eui_score::pdf(src, title).map_err(|e| JsError::new(&e.message))
}

/// The engraver's refusal of `src`, or an empty string when it sets it.
#[wasm_bindgen]
pub fn check(src: &str) -> String {
    match eui_score::engrave(src, 100.0, &Layout::default()) {
        Ok(_) => String::new(),
        Err(e) => e.message,
    }
}

/// What an editor draws and hit-tests, as JSON: `svg`, `width`, `height`,
/// `editable` ("yes", or why not), and `items` — each note or rest with its
/// `item` number, `kind` and `box` [x0, y0, x1, y1] in the SVG's pixels,
/// and each notehead's `index`, `d`, `alter` and `box`. `selected` and
/// `head` (−1 for none) are drawn in the selection's colours.
#[wasm_bindgen]
pub fn editor_view(src: &str, width: f64, staff_space: f64, selected: i32, head: i32) -> Result<String, JsError> {
    let sp = if staff_space > 0.0 { staff_space } else { 7.0 };
    editor::view(src, width, sp, selected.into(), head.into()).map(|v| v.to_string()).map_err(|e| JsError::new(&e))
}

/// One edit, as JSON (`{"op": "move", "item": 3, "how": "step", "by": 1}`…),
/// applied to `src`: the new source, which the engraver accepts, or the
/// reason it would not.
#[wasm_bindgen]
pub fn editor_apply(src: &str, op: &str) -> Result<String, JsError> {
    let op: serde_json::Value = serde_json::from_str(op).map_err(|e| JsError::new(&e.to_string()))?;
    editor::apply(src, &op).map_err(|e| JsError::new(&e))
}
