// The browser's engraver keeps the server's limits (#540): the same crate,
// pinned at the same revision (wasm/Cargo.toml and Soli's), refuses the
// bombs of the reviews (tests/fixtures/bombs) as it reads them, in the same
// words, and reads every piece the site ships.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import init, { check, midi, pdf } from "../../public/eui-score/eui_score_web.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const bombs = new URL("../fixtures/bombs/", import.meta.url);
const read = (name) => readFileSync(new URL(`${name}.ly`, bombs), "utf8");

test("refuses every bomb of the reviews as it reads it, in milliseconds", () => {
  const expected = {
    trills: "this music writes out to more than 20,000 notes; the engraver stops there",
    keys: "this music writes out to more than 20,000 notes; the engraver stops there",
    voices: "this music writes out to more than 20,000 notes; the engraver stops there",
    variables: "this music writes out to more than 20,000 notes; the engraver stops there",
    ledgers: "a note beyond the keys of any instrument (C-1 to G9) is not drawn",
    scheme: "more than 64 deep: the engraver stops there",
  };
  for (const [name, said] of Object.entries(expected)) {
    const started = performance.now();
    const refused = check(read(name));
    assert.ok(performance.now() - started < 1000, `${name} refused fast`);
    assert.ok(refused.startsWith("score: "), `${name}: ${refused}`);
    assert.ok(refused.includes(said), `${name}: ${refused}`);
  }
  const nested = "{ \\repeat unfold 64 { \\repeat unfold 64 { \\repeat unfold 16 { c4 d e f } } } }";
  assert.match(check(nested), /more than 20,000 notes/);
  assert.match(check("{ R1*1000000 }"), /more than 20,000 notes/, "rest bars counted");
});

test("writes no MIDI file nor PDF of a bomb", () => {
  assert.throws(() => midi(read("keys"), 100, 4, 0), /20,000 notes/);
  assert.throws(() => pdf(read("variables"), "Bomb"), /20,000 notes/);
});

test("reads every piece the site ships", () => {
  const root = new URL("../../scores/", import.meta.url);
  let pieces = 0;
  for (const category of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const file of readdirSync(new URL(`${category.name}/`, root)).filter((f) => f.endsWith(".ly"))) {
      const src = readFileSync(new URL(`${category.name}/${file}`, root), "utf8");
      const refused = check(src);
      assert.ok(!/stops there|than this engraves|beyond the keys/.test(refused), `${category.name}/${file}: ${refused}`);
      pieces += 1;
    }
  }
  assert.ok(pieces >= 90, `${pieces} pieces`);
});
