// Where a redraw's time goes, on a long score: cargo run --release --example profile <file.ly>
use std::time::Instant;
use eui_score::Layout;

fn main() {
    let src = std::fs::read_to_string(std::env::args().nth(1).expect("a .ly file")).unwrap();
    for _ in 0..2 {
        let t = Instant::now();
        let parsed = eui_score::parse::parse(&src).unwrap();
        let parse = t.elapsed();
        let t = Instant::now();
        let eng = eui_score::engrave(&src, 1000.0 / 8.0, &Layout::default()).unwrap();
        let engrave = t.elapsed();
        let t = Instant::now();
        let _ = eui_score::paths_heads(&eng, 8.0, 0).unwrap();
        let paths = t.elapsed();
        let t = Instant::now();
        let v = eui_score_web::editor::view(&src, 1000.0, 8.0, -1, -1).unwrap();
        let view = t.elapsed();
        let t = Instant::now();
        let lit = serde_json::json!({ "items": { "100": "#b4373a" } });
        let _ = eui_score_web::editor::view_lit_json(&src, 1000.0, 8.0, &lit).unwrap();
        let relit = t.elapsed();
        let t = Instant::now();
        let _ = eui_score_web::editor::score(&src).unwrap();
        let json = t.elapsed();
        println!("events {} | parse {parse:?} engrave {engrave:?} paths {paths:?} | view {view:?} ({} items), lit again {relit:?} | score_json {json:?}", parsed.staves.iter().map(|s| s.events.len()).sum::<usize>(), v["items"].as_array().unwrap().len());
    }
}
