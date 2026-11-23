use eui_score_web::editor::{apply, score, spans, view};
use serde_json::json;

#[test]
fn each_note_of_voices_says_its_voice() {
    let notes = |src: &str| -> Vec<Option<u64>> {
        let parsed = score(src).unwrap();
        parsed["staves"][0]["events"].as_array().unwrap().iter().filter(|ev| ev["k"] == "Note").map(|ev| ev["voice"].as_u64()).collect()
    };
    let four = notes("{ << { e''2 f'' } \\\\ { c''2 d'' } \\\\ { g'2 a' } \\\\ { c'2 f' } >> | c'1 }");
    assert_eq!(four, vec![Some(1), Some(1), Some(2), Some(2), Some(3), Some(3), Some(4), Some(4), None]);
    // \voiceThree beside voice 1: voice 3, its stems up, though it comes second.
    assert_eq!(notes("{ << { \\voiceOne e''1 } \\\\ { \\voiceThree g'1 } >> }"), vec![Some(1), Some(3)]);
}

#[test]
fn a_slur_says_the_side_it_is_written_to() {
    let parsed = score("{ c'4^( d') e'_( f') g'( a') b'^\\( c''\\) }").unwrap();
    let events = parsed["staves"][0]["events"].as_array().unwrap();
    let sides: Vec<i64> = events.iter().filter(|ev| ev["slur_on"] == true).map(|ev| ev["slur_dir"].as_i64().unwrap()).collect();
    assert_eq!(sides, vec![1, -1, 0]);
    let phrase: Vec<i64> = events.iter().filter(|ev| ev["phrase_on"] == true).map(|ev| ev["phrase_dir"].as_i64().unwrap()).collect();
    assert_eq!(phrase, vec![1]);
}

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
    // A tune that fits on one line keeps its natural width at any page width, as LilyPond sets it (#406);
    // at another staff size it is drawn anew.
    assert_ne!(view_lit(TUNE, 600.0, 6.0, &json!({})).unwrap()["width"], none["width"], "and at another size, its own drawing");
}

#[test]
fn the_parse_hands_over_what_real_files_write() {
    let src = "{ \\stemUp \\autoBeamOff cis''!8 d''?8 \\breathe e''4\\upbow\\laissezVibrer \\stemNeutral f''4\\cresc \\override TextSpanner.bound-details.left.text = \"rit.\" g''4\\startTextSpan a''4\\stopTextSpan\\repeatTie \\override NoteHead.color = #red b''2 }";
    let parsed = score(src).unwrap();
    let notes: Vec<_> = parsed["staves"][0]["events"].as_array().unwrap().iter().filter(|e| e["k"] == "Note").cloned().collect();
    assert_eq!(notes[0]["forced"], json!([14]));
    assert_eq!(notes[1]["cautionary"], json!([15]));
    assert_eq!(notes[0]["stem"], json!(1));
    assert_eq!(notes[0]["no_autobeam"], json!(true));
    assert_eq!(notes[1]["breath"], json!("breathMarkComma"));
    assert_eq!(notes[2]["lv"], json!(true));
    assert_eq!(notes[2]["scripts"], json!([["upbow", 0]]));
    assert_eq!(notes[3]["stem"], json!(0));
    assert_eq!(notes[3]["hairpin_text"], json!("cresc."));
    assert_eq!(notes[4]["span_start"], json!("rit."));
    assert_eq!(notes[5]["span_stop"], json!(true));
    assert_eq!(notes[5]["repeat_tie"], json!(true));
    assert_eq!(parsed["warnings"], json!(["\\override NoteHead.color is not drawn"]));
}

#[test]
fn several_scores_are_movements() {
    let parsed = score("\\score { { c''1 } } \\score { \\header { piece = \"II\" } { d''1 } }").unwrap();
    let kinds: Vec<_> = parsed["staves"][0]["events"].as_array().unwrap().iter().map(|e| e["k"].as_str().unwrap().to_string()).collect();
    assert!(kinds.contains(&"Movement".to_string()), "{kinds:?}");
}

#[test]
fn a_chord_name_says_how_it_is_written() {
    let parsed = score("<< \\new ChordNames \\chordmode { c2:m7 bes:maj7/d | r1 } \\new Staff { c''1 | d''1 } >>").unwrap();
    let written: Vec<_> = parsed["staves"][0]["events"].as_array().unwrap().iter().map(|e| e["chord_text"].clone()).collect();
    assert_eq!(written, vec![json!("c2:m7"), json!("bes:maj7/d"), json!("r1")]);
    assert_eq!(parsed["staves"][1]["events"][0]["chord_text"], json!(null));
}

#[test]
fn figures_and_fingered_grace_notes_are_handed_over() {
    let parsed = score("<< \\new Staff { \\clef bass \\grace { c'8-2 } d2 e2 } \\new FiguredBass \\figuremode { <6 4>2 <7+> } >>").unwrap();
    let note = &parsed["staves"][0]["events"].as_array().unwrap().iter().find(|e| e["k"] == "Note").unwrap().clone();
    assert_eq!(note["graces"][0][3], json!([["2", 0, null, false]]));
    assert_eq!(note["unsupported"], json!([]));
    let figures: Vec<_> = parsed["staves"][1]["events"].as_array().unwrap().iter().filter(|e| e["k"] == "Rest").map(|e| e["figure_text"].clone()).collect();
    assert_eq!(figures, vec![json!("<6 4>"), json!("<7+>")]);
    let diagram = score("{ c'1^\\markup \\fret-diagram-terse \"x;3;2;o;1;o;\" }").unwrap();
    assert_eq!(diagram["staves"][0]["events"][0]["unsupported"], json!([]));
}

#[test]
fn staves_and_voices_say_their_names() {
    let src = "\\new PianoStaff << \\new Staff = \"up\" << \\new Voice = \"sop\" { \\voiceOne c''1 } \\new Voice = \"alto\" { \\voiceTwo a'1 } >> \\new Lyrics \\lyricsto \"alto\" { la } \\new Staff = \"down\" { \\clef bass c4 \\change Staff = \"up\" e'4 d'2 } >>";
    let parsed = score(src).unwrap();
    assert_eq!(parsed["staves"][0]["id"], json!("up"));
    assert_eq!(parsed["staves"][0]["voices"], json!([["sop", 1], ["alto", 2]]));
    assert_eq!(parsed["staves"][0]["lyrics_voice"], json!(2));
    assert_eq!(parsed["staves"][1]["id"], json!("down"));
    let crossed: Vec<_> = parsed["staves"][1]["events"].as_array().unwrap().iter().filter(|e| e["k"] == "Note").map(|e| e["cross"].clone()).collect();
    assert_eq!(crossed, vec![json!(null), json!("up"), json!("up")]);
}

/// The signs a pointer takes (#1020): one of each kind, with what the editor
/// calls it and the note it is written on.
#[test]
fn view_lists_the_signs_a_pointer_moves() {
    let src = "{ c''4\\mf\\<( d''-> e''-2^\"dolce\" f'')\\! | g'2~ g' | a'4\\( b'\\) r2 }";
    let v = view(src, 600.0, 8.0, -1, -1).unwrap();
    let signs = v["signs"].as_array().unwrap();
    let of = |on: &str| signs.iter().find(|s| s["on"] == on).unwrap_or_else(|| panic!("no {on} among {signs:?}"));
    for (on, kind, grob, item) in [
        ("dynamic", "dynamic", "DynamicText", 0),
        ("hairpin", "hairpin", "Hairpin", 0),
        ("slur", "slur", "Slur", 0),
        ("art:accent", "script", "Script", 1),
        ("finger:2", "finger", "Fingering", 2),
        ("text:dolce", "text", "TextScript", 2),
        ("tie", "tie", "Tie", 4),
        ("phrase", "phrase", "PhrasingSlur", 6),
    ] {
        let sign = of(on);
        assert_eq!((sign["kind"].as_str(), sign["grob"].as_str(), sign["item"].as_u64()), (Some(kind), Some(grob), Some(item)), "{on}");
        let b: Vec<f64> = sign["box"].as_array().unwrap().iter().map(|n| n.as_f64().unwrap()).collect();
        assert!(b[2] > b[0] && b[3] > b[1] && b[0] > 0.0, "{on}: a box, {b:?}");
    }
    // A curve's four control points, a wedge's two ends; a dynamic has none.
    assert_eq!(of("slur")["handles"].as_array().unwrap().len(), 4);
    assert_eq!(of("tie")["handles"].as_array().unwrap().len(), 4);
    let ends = of("hairpin")["handles"].as_array().unwrap();
    assert!(ends.len() == 2 && ends[0][0].as_f64().unwrap() < ends[1][0].as_f64().unwrap());
    assert!(of("dynamic")["handles"].is_null());
    // The words' box is the one a double click opens.
    let word = v["words"].as_array().unwrap().iter().find(|w| w["kind"] == "text").unwrap();
    for k in 0..4 {
        let (sign, drawn) = (of("text:dolce")["box"][k].as_f64().unwrap(), word["box"][k].as_f64().unwrap());
        assert!((sign - drawn).abs() < 4.0, "the words' box, side {k}: {sign} against {drawn} drawn");
    }
    // The accent stands over its own note, inside the staff's width.
    let (accent, note) = (of("art:accent"), &v["items"][1]);
    assert!((accent["box"][0].as_f64().unwrap() - note["box"][0].as_f64().unwrap()).abs() < 12.0);
}

/// A sign's box follows its `\tweak extra-offset`, a curve's handles its
/// `\shape`, a wedge's ends its `shorten-pair` — by so many staff spaces,
/// up for a positive y — and none of these is passed over with a warning.
#[test]
fn a_tweak_moves_its_sign_by_so_many_staff_spaces() {
    let sp = 8.0;
    let n = |v: &serde_json::Value| v.as_f64().unwrap();
    // Measured from its note's head: a sign moved up or down past the staff's
    // ink moves the line itself on the page.
    let sign = |src: &str, on: &str| -> serde_json::Value {
        assert_eq!(score(src).unwrap()["warnings"], json!([]), "{src}");
        let v = view(src, 600.0, sp, -1, -1).unwrap();
        let mut found = v["signs"].as_array().unwrap().iter().find(|s| s["on"] == on).unwrap_or_else(|| panic!("no {on} in {src}")).clone();
        let head = v["items"][0]["heads"][0]["box"].clone();
        for k in 0..4 {
            found["box"][k] = json!(n(&found["box"][k]) - n(&head[k % 2]));
        }
        for point in found["handles"].as_array_mut().into_iter().flatten().filter(|p| !p.is_null()) {
            *point = json!([n(&point[0]) - n(&head[0]), n(&point[1]) - n(&head[1])]);
        }
        found
    };
    for (plain, moved, on) in [
        ("{ c''4\\mf d'' e'' f'' }", "{ c''4-\\tweak extra-offset #'(1.5 . -2) \\mf d'' e'' f'' }", "dynamic"),
        ("{ c''4-> d'' e'' f'' }", "{ c''4-\\tweak extra-offset #'(1.5 . -2) -> d'' e'' f'' }", "art:accent"),
        ("{ c''4-- d'' e'' f'' }", "{ c''4-\\tweak extra-offset #'(1.5 . -2) \\tenuto d'' e'' f'' }", "art:tenuto"),
        ("{ c''4-^ d'' e'' f'' }", "{ c''4-\\tweak extra-offset #'(1.5 . -2) ^\\marcato d'' e'' f'' }", "art:marcato"),
        ("{ c''4\\fermata d'' e'' f'' }", "{ c''4-\\tweak extra-offset #'(1.5 . -2) \\fermata d'' e'' f'' }", "art:fermata"),
        ("{ c''4-2 d'' e'' f'' }", "{ c''4-\\tweak extra-offset #'(1.5 . -2) -2 d'' e'' f'' }", "finger:2"),
        ("{ c''4^\"dolce\" d'' e'' f'' }", "{ c''4-\\tweak extra-offset #'(1.5 . -2) ^\"dolce\" d'' e'' f'' }", "text:dolce"),
        ("{ c''4( d'' e'' f'') }", "{ c''4-\\tweak extra-offset #'(1.5 . -2) ( d'' e'' f'') }", "slur"),
        ("{ c''4\\( d'' e'' f''\\) }", "{ c''4-\\tweak extra-offset #'(1.5 . -2) \\( d'' e'' f''\\) }", "phrase"),
        ("{ c''2~ c'' }", "{ c''2-\\tweak extra-offset #'(1.5 . -2) ~ c'' }", "tie"),
        ("{ c''4\\< d'' e'' f''\\! }", "{ c''4-\\tweak extra-offset #'(1.5 . -2) \\< d'' e'' f''\\! }", "hairpin"),
    ] {
        let (a, b) = (sign(plain, on), sign(moved, on));
        for k in 0..4 {
            let by = if k % 2 == 0 { 1.5 * sp } else { 2.0 * sp };
            assert!((n(&b["box"][k]) - n(&a["box"][k]) - by).abs() < 1e-6, "{on}, side {k}: {} then {}", a["box"][k], b["box"][k]);
        }
    }
    // \shape: each control point by its own offset, the others where they were.
    let (a, b) = (sign("{ c''4( d'' e'' f'') }", "slur"), sign("{ c''4-\\shape #'((0 . 0) (0.5 . 2) (0 . 0) (0 . -1)) ( d'' e'' f'') }", "slur"));
    let moves: Vec<(f64, f64)> = (0..4).map(|k| (n(&b["handles"][k][0]) - n(&a["handles"][k][0]), n(&b["handles"][k][1]) - n(&a["handles"][k][1]))).collect();
    for (got, want) in moves.iter().zip([(0.0, 0.0), (0.5 * sp, -2.0 * sp), (0.0, 0.0), (0.0, sp)]) {
        assert!((got.0 - want.0).abs() < 1e-6 && (got.1 - want.1).abs() < 1e-6, "{moves:?}");
    }
    // shorten-pair: the left end in by 1, the right end out by 0.5.
    let (a, b) = (sign("{ c''4\\< d'' e'' f''\\! }", "hairpin"), sign("{ c''4-\\tweak shorten-pair #'(1 . -0.5) \\< d'' e'' f''\\! }", "hairpin"));
    assert!((n(&b["handles"][0][0]) - n(&a["handles"][0][0]) - sp).abs() < 1e-6, "the left end");
    assert!((n(&b["handles"][1][0]) - n(&a["handles"][1][0]) - 0.5 * sp).abs() < 1e-6, "the right end");
}

/// What a tweak cannot be written before says so: a fingering on a chord's
/// head, a string's number.
#[test]
fn a_sign_no_tweak_reaches_has_no_name() {
    let v = view("{ <c'-1 e'-3>4 d'\\2 e' f' }", 600.0, 8.0, -1, -1).unwrap();
    let fingers: Vec<&serde_json::Value> = v["signs"].as_array().unwrap().iter().filter(|s| s["kind"] == "finger").collect();
    assert_eq!(fingers.len(), 3);
    assert!(fingers.iter().all(|s| s["on"].is_null()), "{fingers:?}");
}
