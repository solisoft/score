use eui_score_web::editor::{apply, view};
use serde_json::json;

const TUNE: &str = "{ \\key g \\major \\time 3/4 g'4 a' b' | d''2 r4 | <g' b'>2. \\bar \"|.\" }";

fn op(src: &str, v: serde_json::Value) -> Result<String, String> {
    apply(src, &v)
}

#[test]
fn view_lists_notes_rests_and_heads_with_boxes() {
    let v = view(TUNE, 600.0, 8.0, 1, -1).unwrap();
    let items = v["items"].as_array().unwrap();
    assert_eq!(items.len(), 6);
    assert_eq!(items[0]["kind"], "note");
    assert_eq!(items[4]["kind"], "rest");
    assert_eq!(items[5]["heads"].as_array().unwrap().len(), 2);
    let b = items[0]["box"].as_array().unwrap();
    assert!(b[2].as_f64().unwrap() > b[0].as_f64().unwrap());
    assert!(v["svg"].as_str().unwrap().contains("#b4373a"), "the selection is drawn in its colour");
    assert_eq!(v["editable"], "yes");
}

#[test]
fn arrows_move_a_note_in_the_key() {
    let up = op(TUNE, json!({"op": "move", "item": 0, "how": "step", "by": 1})).unwrap();
    assert!(up.contains("{ \\key g \\major \\time 3/4 a'4 a' b'"), "{up}");
    // F is sharp in G major: a step down from g' lands on fis'.
    let down = op(TUNE, json!({"op": "move", "item": 0, "how": "step", "by": -1})).unwrap();
    assert!(down.contains("fis'4 a'"), "{down}");
    let octave = op(TUNE, json!({"op": "move", "item": 0, "how": "octave", "by": 1})).unwrap();
    assert!(octave.contains("g''4 a'"), "{octave}");
    let semi = op(TUNE, json!({"op": "move", "item": 0, "how": "semitone", "by": 1})).unwrap();
    assert!(semi.contains("gis'4"), "{semi}");
}

#[test]
fn a_drag_moves_one_head_of_a_chord() {
    let moved = op(TUNE, json!({"op": "drag", "item": 5, "head": 1, "from": [13, 0], "by": 1})).unwrap();
    assert!(moved.contains("<g' c''>2."), "{moved}");
}

#[test]
fn letters_change_a_note_and_fill_a_rest() {
    let e = op(TUNE, json!({"op": "letter", "item": 1, "step": 2})).unwrap();
    assert!(e.contains("g'4 e'' b'") || e.contains("g'4 e' b'"), "{e}");
    let filled = op(TUNE, json!({"op": "letter", "item": 4, "step": 4})).unwrap();
    assert!(filled.contains("d''2 g''4") || filled.contains("d''2 g'4"), "{filled}");
    let chord = op(TUNE, json!({"op": "letter", "item": 0, "step": 6, "add": true})).unwrap();
    assert!(chord.contains("<g' b'>4 a'"), "{chord}");
}

#[test]
fn a_note_becomes_a_rest_and_a_head_leaves_its_chord() {
    let rest = op(TUNE, json!({"op": "rest", "item": 2})).unwrap();
    assert!(rest.contains("a' r | d''2"), "{rest}");
    let one = op(TUNE, json!({"op": "rest", "item": 5, "head": 1})).unwrap();
    assert!(one.contains("<g'>2."), "{one}");
}

#[test]
fn accidentals() {
    let flat = op(TUNE, json!({"op": "alter", "item": 2, "alter": -1})).unwrap();
    assert!(flat.contains("bes'"), "{flat}");
}

#[test]
fn an_appended_bar_is_rests_in_the_metre() {
    let more = op(TUNE, json!({"op": "append-bar"})).unwrap();
    assert!(more.contains("<g' b'>2. r4 r r"), "{more}");
}

#[test]
fn relative_sources_are_written_out_first() {
    let rel = "\\relative c'' { \\time 4/4 c4 d e f | g1 }";
    assert_eq!(op(rel, json!({"op": "move", "item": 0, "how": "step", "by": 1})).unwrap_err(), "relative");
    let abs = op(rel, json!({"op": "absolute"})).unwrap();
    assert_eq!(abs, "{ \\time 4/4 c''4 d'' e'' f'' | g''1 }");
    let moved = op(&abs, json!({"op": "move", "item": 0, "how": "step", "by": 1})).unwrap();
    assert!(moved.contains("d''4 d''"), "{moved}");
}

#[test]
fn an_edit_the_engraver_would_refuse_is_refused() {
    // A rest turned into a note of the bar's length stays a bar's length.
    assert!(op(TUNE, json!({"op": "move", "item": 99, "how": "step", "by": 1})).is_err());
    assert!(op(TUNE, json!({"op": "move", "item": 4, "how": "step", "by": 1})).is_err(), "a rest has no pitch");
}

#[test]
fn every_gallery_piece_can_be_written_out_and_viewed() {
    for entry in std::fs::read_dir("../scores").unwrap() {
        for file in std::fs::read_dir(entry.unwrap().path()).unwrap() {
            let path = file.unwrap().path();
            let src = std::fs::read_to_string(&path).unwrap();
            let abs = op(&src, json!({"op": "absolute"})).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            view(&abs, 900.0, 7.0, -1, -1).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        }
    }
}
