//! What a score is, in words: the SVG's `<title>` and `<desc>`, for a
//! screen reader, which cannot read the drawing.

use eui_score::parse::{Kind, Parsed, StaffKind};

/// The title: `\header`'s, or "Score".
pub fn title(parsed: &Parsed) -> String {
    parsed.header.get("title").map(|t| t.trim()).filter(|t| !t.is_empty()).unwrap_or("Score").to_string()
}

/// One sentence a staff, after the composer: "Piano, treble staff: 2 flats, 3/4, 24 notes."
pub fn description(parsed: &Parsed, bars: usize) -> String {
    let mut parts = Vec::new();
    if let Some(composer) = parsed.header.get("composer").map(|c| c.trim()).filter(|c| !c.is_empty()) {
        parts.push(format!("By {composer}."));
    }
    let staves = parsed.staves.len();
    parts.push(format!("{} {}, {} {}.", staves, plural(staves, "staff", "staves"), bars, plural(bars, "bar", "bars")));
    for (k, staff) in parsed.staves.iter().enumerate() {
        let name = staff.props.instrument_name.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| format!("Staff {}", k + 1));
        let kind = match staff.kind {
            StaffKind::Notes => "",
            StaffKind::ChordNames => " (chord names)",
            StaffKind::Drums => " (drums)",
            StaffKind::Tab => " (tablature)",
        };
        let fifths = staff.events.iter().find(|e| e.k == Kind::Key).map_or(0, |e| e.fifths);
        let time = staff.events.iter().find(|e| e.k == Kind::Time).map(|e| format!(", {}/{}", e.time.0, e.time.1)).unwrap_or_default();
        let notes = staff.events.iter().filter(|e| e.k == Kind::Note).count();
        let rests = staff.events.iter().filter(|e| e.k == Kind::Rest && !e.spacer).count();
        parts.push(format!(
            "{name}{kind}: {}{time}, {notes} {}, {rests} {}.",
            key(fifths),
            plural(notes, "note", "notes"),
            plural(rests, "rest", "rests")
        ));
    }
    parts.join(" ")
}

fn key(fifths: i64) -> String {
    match fifths {
        0 => "no sharps or flats".to_string(),
        n if n > 0 => format!("{n} {}", plural(n as usize, "sharp", "sharps")),
        n => format!("{} {}", -n, plural((-n) as usize, "flat", "flats")),
    }
}

fn plural<'a>(n: usize, one: &'a str, many: &'a str) -> &'a str {
    if n == 1 { one } else { many }
}

/// `<title>` and `<desc>` for an SVG whose ids start with `id`, and the
/// `aria-labelledby` naming them; the text escaped.
pub fn svg_head(parsed: &Parsed, bars: usize, id: &str) -> (String, String) {
    let head = format!(
        "<title id=\"{id}-t\">{}</title><desc id=\"{id}-d\">{}</desc>",
        escape(&title(parsed)),
        escape(&description(parsed, bars))
    );
    (head, format!("aria-labelledby=\"{id}-t {id}-d\""))
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn says_the_title_the_staves_and_what_they_hold() {
        let src = "\\header { title = \"Air & Song\" composer = \"Anon\" }\n\\new Staff \\with { instrumentName = \"Flute\" } { \\key f \\major \\time 3/4 c'4 d' r }";
        let parsed = eui_score::parse::parse(src).unwrap();
        assert_eq!(title(&parsed), "Air & Song");
        assert_eq!(description(&parsed, 1), "By Anon. 1 staff, 1 bar. Flute: 1 flat, 3/4, 2 notes, 1 rest.");
        let (head, label) = svg_head(&parsed, 1, "s1");
        assert!(head.contains("<title id=\"s1-t\">Air &amp; Song</title>"));
        assert_eq!(label, "aria-labelledby=\"s1-t s1-d\"");
    }

    #[test]
    fn a_score_with_no_title_is_a_score() {
        let parsed = eui_score::parse::parse("{ c'1 }").unwrap();
        assert_eq!(title(&parsed), "Score");
        assert!(description(&parsed, 1).contains("Staff 1: no sharps or flats"));
    }

    #[test]
    fn a_spacer_is_not_a_rest() {
        let parsed = eui_score::parse::parse("{ << { c''2 d'' } \\\\ { s2 g'2 } >> }").unwrap();
        assert!(description(&parsed, 1).ends_with("3 notes, 0 rests."), "{}", description(&parsed, 1));
    }
}
