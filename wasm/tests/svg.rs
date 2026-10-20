//! The engraving as SVG, as pages and embeds show it.

#![allow(clippy::unwrap_used)]

fn view_box(svg: &str) -> Vec<f64> {
    svg.split("viewBox=\"").nth(1).unwrap().split('"').next().unwrap().split(' ').map(|n| n.parse().unwrap()).collect()
}

/// The first staff's top line: the highest rule as wide as a bar or more.
fn staff_top(svg: &str) -> f64 {
    let attr = |tag: &str, name: &str| -> f64 { tag.split(&format!(" {name}=\"")).nth(1).unwrap().split('"').next().unwrap().parse().unwrap() };
    svg.split("<rect").skip(1).filter(|t| attr(t, "width") > 100.0).map(|t| attr(t, "y")).fold(f64::MAX, f64::min)
}

/// With nothing over the first staff, a treble clef's top stands above it:
/// the picture starts higher rather than cut the clef.
#[test]
fn a_treble_clef_with_nothing_over_it_is_drawn_whole() {
    for src in ["{ \\key g \\major g'1 | \\key f \\major bes'1 }", "{ r1 | R1 | c''4 r4 c''4 r4 }"] {
        let svg = eui_score_web::svg(src, 600.0, 8.0, "").unwrap();
        let vb = view_box(&svg);
        assert!(vb[1] < 0.0, "{src}: the picture starts at {} — the clef's top is cut", vb[1]);
        // A treble clef reaches some 1.5 spaces over its staff.
        let top = staff_top(&svg);
        assert!(vb[1] <= top - 8.0 * 1.5, "{src}: the picture starts at {}, the clef reaches {}", vb[1], top - 8.0 * 1.5);
        let height: f64 = svg.split("height=\"").nth(1).unwrap().split('"').next().unwrap().parse().unwrap();
        assert_eq!(height, vb[3], "{src}: the picture is as tall as its view");
    }
}

/// A title over the music leaves room enough: nothing moves.
#[test]
fn a_titled_score_starts_at_its_top() {
    let svg = eui_score_web::svg("\\header { title = \"Rests\" } { r1 }", 600.0, 8.0, "").unwrap();
    assert_eq!(view_box(&svg)[1], 0.0);
}
