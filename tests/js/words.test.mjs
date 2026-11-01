// The editor's words in French (#508): every sentence a module shows
// through `tr("…")` has its French in config/editor_words/fr/, with the same
// {placeholders}; the dictionary holds nothing no module asks for; and
// `tr` answers the English when the page has no dictionary.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { tr } from "../../public/eui-score/words.js";

const root = new URL("../../", import.meta.url);
const DIR = new URL("public/eui-score/", root);
const SKIP = new Set(["eui_score_web.js", "words.js", "mic-worklet.js"]);

/** Every module's source: public/eui-score/*.js and the shared score-photo.js. */
function modules() {
  const files = readdirSync(DIR).filter((name) => name.endsWith(".js") && !SKIP.has(name));
  const found = files.map((name) => [`public/eui-score/${name}`, readFileSync(new URL(name, DIR), "utf8")]);
  found.push(["public/js/score-photo.js", readFileSync(new URL("public/js/score-photo.js", root), "utf8")]);
  return found;
}

/** The literal first arguments of the `tr(…)` calls in `code`, as JavaScript reads them. */
function asked(code) {
  const pattern = /\btr\(\s*((["'`])(?:\\.|(?!\2)[^\\])*\2)/g;
  return [...code.matchAll(pattern)].map((match) => (match[1].includes("${") ? match[1] : Function(`return ${match[1]}`)()));
}

const french = Object.assign(
  {},
  ...readdirSync(new URL("config/editor_words/fr/", root))
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(new URL(`config/editor_words/fr/${name}`, root), "utf8")))
);
const places = (text) => [...text.matchAll(/\{([a-zA-Z_]+)\}/g)].map((m) => m[1]).sort();

test("tr: the English as it is without a dictionary, the page's words with one, {names} filled", () => {
  delete globalThis.EUI_WORDS;
  assert.equal(tr("Bar {n}", { n: 4 }), "Bar 4");
  globalThis.EUI_WORDS = { "Bar {n}": "Mesure {n}" };
  assert.equal(tr("Bar {n}", { n: 4 }), "Mesure 4");
  assert.equal(tr("Not in it"), "Not in it");
  assert.equal(tr("constructor"), "constructor");
  delete globalThis.EUI_WORDS;
});

test("no template literal with ${} is handed to tr: its words could not be looked up", () => {
  for (const [path, code] of modules()) {
    for (const text of asked(code)) assert.ok(!text.includes("${"), `${path}: tr(\`${text}\`)`);
  }
});

test("every sentence a module shows has its French, with the same {placeholders}", () => {
  const missing = [];
  const mismatched = [];
  for (const [path, code] of modules()) {
    for (const text of asked(code)) {
      if (!Object.prototype.hasOwnProperty.call(french, text)) missing.push(`${path}: ${text}`);
      else if (places(text).join() !== places(french[text]).join()) mismatched.push(`${path}: ${text} → ${french[text]}`);
    }
  }
  assert.deepEqual(missing, [], "sentences with no French");
  assert.deepEqual(mismatched, [], "placeholders that differ");
});

test("the French dictionary holds only sentences a module asks for, none empty", () => {
  const used = new Set(modules().flatMap(([, code]) => asked(code)));
  const stale = Object.keys(french).filter((text) => !used.has(text));
  assert.deepEqual(stale, [], "French for sentences no module shows");
  assert.deepEqual(Object.keys(french).filter((text) => !String(french[text]).trim()), []);
});

test("a sentence in two groups' files has the same French in both", () => {
  const seen = {};
  const clashes = [];
  for (const name of readdirSync(new URL("config/editor_words/fr/", root)).filter((file) => file.endsWith(".json"))) {
    const part = JSON.parse(readFileSync(new URL(`config/editor_words/fr/${name}`, root), "utf8"));
    for (const [english, said] of Object.entries(part)) {
      if (seen[english] && seen[english].said !== said) clashes.push(`${english}: ${seen[english].file} « ${seen[english].said} », ${name} « ${said} »`);
      else seen[english] ??= { file: name, said };
    }
  }
  assert.deepEqual(clashes, [], "the same English, translated twice differently");
});
