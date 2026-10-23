use eui_score_web::editor::{apply, spans, view};
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

#[test]
fn every_bar_has_a_box_and_its_notes_stand_in_it() {
    let v = view(TUNE, 600.0, 8.0, -1, -1).unwrap();
    let bars = v["bars"].as_array().unwrap();
    assert_eq!(bars.len(), 3);
    let bar_of_item = [0, 0, 0, 1, 1, 2];
    for item in v["items"].as_array().unwrap() {
        let k = item["item"].as_u64().unwrap() as usize;
        let b = item["box"].as_array().unwrap();
        let cx = (b[0].as_f64().unwrap() + b[2].as_f64().unwrap()) / 2.0;
        let bar = bars[bar_of_item[k]]["box"].as_array().unwrap();
        assert!(cx > bar[0].as_f64().unwrap() && cx < bar[2].as_f64().unwrap(), "item {k} at {cx} outside bar {}", bar_of_item[k]);
    }
}

#[test]
fn a_staff_of_rests_keeps_its_clef_whole() {
    let src = "{ \\clef treble \\time 4/4 r1 | r1 }";
    let v = view(src, 600.0, 8.0, -1, -1).unwrap();
    let svg = v["svg"].as_str().unwrap();
    let vb: Vec<f64> = svg.split("viewBox=\"").nth(1).unwrap().split('"').next().unwrap().split(' ').map(|n| n.parse().unwrap()).collect();
    // A treble clef reaches some 1.5 spaces over its staff and 1.5 under it.
    let staff_top = v["bars"][0]["staves"][0].as_f64().unwrap();
    let clef_bottom = staff_top + 8.0 * (4.0 + 1.5);
    assert!(vb[1] <= staff_top - 8.0 * 1.5, "the drawing starts at {} — the clef reaches higher", vb[1]);
    assert!(vb[1] + vb[3] >= clef_bottom, "the drawing stops at {} — the clef reaches {clef_bottom}", vb[1] + vb[3]);
}

#[test]
fn every_item_names_where_it_is_written() {
    let v = view(TUNE, 600.0, 8.0, -1, -1).unwrap();
    for item in v["items"].as_array().unwrap() {
        let span = item["span"].as_array().unwrap();
        let (start, end) = (span[0].as_u64().unwrap() as usize, span[1].as_u64().unwrap() as usize);
        let written: String = TUNE.encode_utf16().skip(start).take(end - start).map(|u| u as u8 as char).collect();
        let first = written.chars().next().unwrap();
        match item["kind"].as_str().unwrap() {
            "rest" | "bar-rest" => assert!(first == 'r' || first == 'R', "{written}"),
            _ => assert!(first == '<' || ('a'..='g').contains(&first), "{written}"),
        }
    }
    let first = &v["items"][0]["span"];
    assert_eq!(&TUNE[first[0].as_u64().unwrap() as usize..first[1].as_u64().unwrap() as usize], "g'4");
    // Counted as a textarea counts: a ♭ in a title before the notes moves them by one.
    let titled = format!("\\header {{ title = \"B♭ air\" }}\n{TUNE}");
    let first = |src: &str| view(src, 600.0, 8.0, -1, -1).unwrap()["items"][0]["span"][0].as_u64().unwrap();
    let shift = "\\header { title = \"B♭ air\" }\n".encode_utf16().count() as u64;
    assert_eq!(first(&titled), first(TUNE) + shift);
}

#[test]
fn the_drawing_has_a_title_and_a_description() {
    let svg = view(TUNE, 600.0, 8.0, -1, -1).unwrap()["svg"].as_str().unwrap().to_string();
    assert!(svg.contains("aria-labelledby=\"ed-t ed-d\""));
    assert!(svg.contains("<title id=\"ed-t\">"));
    assert!(svg.contains("<desc id=\"ed-d\">1 staff"));
}

#[test]
fn spans_list_every_item_as_the_view_does() {
    let listed = spans(TUNE).unwrap();
    let v = view(TUNE, 600.0, 8.0, -1, -1).unwrap();
    for item in v["items"].as_array().unwrap() {
        assert_eq!(listed[item["item"].as_u64().unwrap() as usize], item["span"]);
    }
    assert!(spans("{ c'4 (").is_err());
}

#[test]
fn a_redraw_of_the_same_source_lights_anew_and_an_edit_draws_anew() {
    use eui_score_web::editor::view_lit;
    let lit = |item: &str| json!({ "items": { item: "#0f9d47" } });
    let count = |v: &serde_json::Value| v["svg"].as_str().unwrap().matches("fill=\"#0f9d47\"").count();
    let first = view_lit(TUNE, 600.0, 8.0, &lit("0")).unwrap();
    let again = view_lit(TUNE, 600.0, 8.0, &lit("5")).unwrap();
    let none = view_lit(TUNE, 600.0, 8.0, &json!({})).unwrap();
    assert!(count(&first) > 0);
    assert!(count(&again) > count(&first), "the chord has more paths than one note");
    assert_eq!(count(&none), 0, "nothing lit is left from before");
    assert_eq!(first["items"], none["items"]);
    // A head of the chord, by its index: the second head only.
    let head = view_lit(TUNE, 600.0, 8.0, &json!({ "heads": [[5, 1, "#e0662a"]] })).unwrap();
    let head_paths = head["svg"].as_str().unwrap().matches("fill=\"#e0662a\"").count();
    assert!(head_paths > 0 && head_paths < count(&again), "a head and its dot, not the whole chord");
    // Another source, even at the same size: its own items.
    let edited = TUNE.replace("g'4 a'", "g'4 c''");
    let other = view_lit(&edited, 600.0, 8.0, &json!({})).unwrap();
    assert_ne!(other["items"][1]["box"], none["items"][1]["box"]);
    assert_ne!(view_lit(TUNE, 300.0, 8.0, &json!({})).unwrap()["width"], none["width"], "and at another width, its own drawing");
}
