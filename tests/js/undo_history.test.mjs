// The undo history kept in the browser (public/eui-score/undo-history.js):
// the differences it is kept as, the budget that drops the oldest steps,
// the scores kept least recently used, a storage that refuses, and Undo
// across someone else's changes (merge.js), against the real engraver.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import { mergeScores } from "../../public/eui-score/merge.js";
import * as H from "../../public/eui-score/undo-history.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

/** A history of `texts`, one step between each and the next, as the editor holds it. */
function chain(texts) {
  const past = texts.slice(0, -1).map((text, i) => ({ text, after: texts[i + 1], sel: { staff: 0, t0: i, t1: i }, input: null }));
  return { end: texts.at(-1), past, future: [] };
}

/** A backend for `historyStore` over plain maps; `refuse` makes each call throw. */
function memoryBackend({ refuse = () => false } = {}) {
  const stores = { histories: new Map(), used: new Map() };
  const guard = (what) => {
    if (refuse(what)) throw new Error(`QuotaExceededError: ${what}`);
  };
  return {
    stores,
    get: async (name, key) => (guard(`get ${name}`), stores[name].get(key)),
    put: async (name, key, value) => (guard(`put ${name}`), stores[name].set(key, structuredClone(value))),
    remove: async (name, key) => (guard(`remove ${name}`), stores[name].delete(key)),
    all: async (name) => (guard(`all ${name}`), Object.fromEntries(stores[name])),
  };
}

test("diff and patch: the change between two texts, and back", () => {
  const cases = [
    ["", ""],
    ["", "c'4 d'"],
    ["c'4 d'", ""],
    ["c'4 d' e' f'", "c'4 d' g' f'"],
    ["aaaa", "aa"],
    ["aa", "aaaa"],
    ["\\header { title = \"Ré ♯ 𝄞\" }", "\\header { title = \"Ré ♭ 𝄞𝄞\" }"],
    ["abc", "xyz"],
  ];
  for (const [a, b] of cases) {
    const d = H.diff(a, b);
    assert.equal(H.patch(a, d), b, `${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  }
  assert.equal(H.diff("same", "same"), null, "no change, nothing kept");
  // Only what is between the common start and end is kept.
  assert.deepEqual(H.diff("c'4 d' e' f' | g'1", "c'4 d' a' f' | g'1"), [7, 10, "a"]);
});

test("encode and decode: a history kept as differences comes back step by step", () => {
  const bars = "c'4 d' e' f' | ".repeat(40);
  const texts = Array.from({ length: 30 }, (_, i) => `\\new Staff { ${bars}g'${i % 2 ? 2 : 1} } % step ${i}`);
  const history = chain(texts);
  history.future = [{ text: "the redo", after: history.end, sel: null, input: { on: true, t: 4 } }];
  const record = H.encode(history);
  const back = H.decode(structuredClone(record));
  assert.equal(back.end, history.end);
  assert.deepEqual(back.past.map((s) => [s.text, s.after]), history.past.map((s) => [s.text, s.after]));
  assert.deepEqual(back.past[3].sel, { staff: 0, t0: 3, t1: 3 });
  assert.equal(back.future[0].text, "the redo");
  assert.deepEqual(back.future[0].input, { on: true, t: 4 });
  // Far smaller than the texts themselves.
  const full = texts.reduce((sum, text) => sum + text.length, 0);
  assert.ok(JSON.stringify(record).length < full / 4, `${JSON.stringify(record).length} < ${full / 4}`);
});

test("encode: a step whose `after` is not the next step's text (someone else's change between) is kept so", () => {
  const history = {
    end: "c d e theirs",
    past: [
      { text: "a", after: "b", sel: null, input: null },
      { text: "b", after: "c d e", sel: null, input: null },
    ],
    future: [],
  };
  const back = H.decode(H.encode(history));
  assert.deepEqual(back.past.map((s) => [s.text, s.after]), [["a", "b"], ["b", "c d e"]]);
});

test("decode refuses what is not a history", () => {
  assert.equal(H.decode(null), null);
  assert.equal(H.decode({}), null);
  assert.equal(H.decode({ end: 3 }), null);
  assert.equal(H.decode({ end: "x", past: [{ a: 7 }] }), null, "a broken step: nothing, rather than a wrong text");
  assert.deepEqual(H.decode({ end: "x" }), { end: "x", past: [], future: [] });
});

test("no fixed number of steps: a thousand are kept; past the budget, the oldest go first", () => {
  const texts = Array.from({ length: 1001 }, (_, i) => `{ c'4 d' e' f' } % ${i}`);
  const all = H.decode(H.encode(chain(texts)));
  assert.equal(all.past.length, 1000, "far past the old limit of 300");
  assert.equal(all.past[0].text, texts[0]);
  // A budget for about a hundred steps: the newest hundred stay, whole.
  const record = H.encode(chain(texts), { budget: 100 * 80 });
  const kept = H.decode(record);
  assert.ok(kept.past.length > 50 && kept.past.length < 150, `${kept.past.length} steps`);
  assert.ok(record.size <= 100 * 80);
  assert.equal(kept.past.at(-1).text, texts[999], "the newest step kept");
  assert.equal(kept.past[0].text, texts[1000 - kept.past.length], "the oldest gone, not the newest");
  // A text alone over the budget: no step at all, nothing wrong.
  assert.deepEqual(H.decode(H.encode(chain(["a", "b".repeat(50)]), { budget: 40 })).past, []);
});

test("keepWithin: memory bounds the steps held, and old steps keep their text only", () => {
  const past = Array.from({ length: 100 }, (_, i) => ({ snap: "s".repeat(100), text: "t".repeat(100), after: "x", sel: null }));
  const future = [{ text: "f".repeat(100), after: "x" }, { text: "g".repeat(100), after: "x" }];
  const dropped = H.keepWithin(past, future, { memory: 6000, full: 10 });
  assert.ok(past.slice(0, -10).every((step) => !step.snap), "below the ten nearest, no snapshot");
  assert.ok(past.slice(-10).every((step) => step.snap), "the ten nearest keep theirs");
  const weight = [...past, ...future].reduce((sum, step) => sum + step.text.length + (step.snap?.length ?? 0), 0);
  assert.ok(weight <= 6000, `${weight}`);
  assert.equal(dropped, 100 + 2 - past.length - future.length);
  assert.equal(future.length, 2, "the redo steps go only once the past is spent");
  // Within the memory: nothing goes.
  const small = [{ text: "a", after: "b" }];
  assert.equal(H.keepWithin(small, [], { memory: 10 }), 0);
  assert.equal(small.length, 1);
});

test("stepOf: a snapshot of the editor made a step", () => {
  const snap = JSON.stringify({ score: { staves: [] }, text: "c'4", sel: { staff: 0, t0: 0, t1: 0 }, input: { on: false } });
  assert.deepEqual(H.stepOf(snap, "d'4"), { snap, text: "c'4", after: "d'4", sel: { staff: 0, t0: 0, t1: 0 }, input: { on: false } });
});

test("historyStore: kept, read back, and the scores used least recently go past the limit", async () => {
  const backend = memoryBackend();
  let clock = 0;
  const store = H.historyStore(backend, { scores: 3, now: () => ++clock });
  for (const key of ["a", "b", "c"]) assert.equal(await store.put(key, { end: key }), true);
  assert.deepEqual(await store.get("b"), { end: "b" });
  // "a" saved again: now "b" is the least recently used.
  await store.put("a", { end: "a2" });
  await store.put("d", { end: "d" });
  assert.equal(await store.get("b"), null, "the oldest gone");
  assert.deepEqual([...backend.stores.histories.keys()].sort(), ["a", "c", "d"]);
  assert.deepEqual([...backend.stores.used.keys()].sort(), ["a", "c", "d"]);
  assert.deepEqual(await store.get("a"), { end: "a2" });
  assert.equal(await store.get("nothing"), null);
  assert.equal(await store.remove("a"), true);
  assert.equal(await store.get("a"), null);
  assert.deepEqual(H.evicted({ x: 1, y: 3, z: 2 }, 2), ["x"]);
  assert.deepEqual(H.evicted({ x: 1 }, 2), []);
});

test("historyStore: a storage that refuses (private window, full) throws nothing and keeps nothing half", async () => {
  const full = memoryBackend({ refuse: (what) => what === "put used" });
  const store = H.historyStore(full);
  assert.equal(await store.put("a", { end: "a" }), false, "said not kept");
  assert.equal(full.stores.histories.has("a"), false, "and nothing of it left");
  const blocked = H.historyStore(memoryBackend({ refuse: () => true }));
  assert.equal(await blocked.get("a"), null);
  assert.equal(await blocked.put("a", { end: "a" }), false);
  assert.equal(await blocked.remove("a"), false);
});

test("indexedDbBackend: no IndexedDB, or one that refuses to open: none, without a throw", async () => {
  assert.equal(await H.indexedDbBackend(null), null);
  const refusing = { open() { throw new Error("SecurityError: the storage is off"); } };
  assert.equal(await H.indexedDbBackend(refusing), null);
  const silent = { open: () => ({}) };
  assert.equal(await H.indexedDbBackend(silent, "x", { wait: 20 }), null, "no answer: given up");
});

test("keeper: saves a moment after the last change, the history as differences; flush saves at once", async () => {
  const backend = memoryBackend();
  const kept = H.keeper(H.historyStore(backend), "score:1", { delay: 20 });
  let state = chain(["a", "ab"]);
  kept.save(() => state);
  state = chain(["a", "ab", "abc"]);
  kept.save(() => state);
  assert.equal(backend.stores.histories.size, 0, "not yet");
  await new Promise((done) => setTimeout(done, 60));
  assert.deepEqual(H.decode(backend.stores.histories.get("score:1")).past.map((s) => s.text), ["a", "ab"]);
  assert.equal(await kept.flush(), false, "nothing new to save");
  kept.save(() => chain(["x", "y"]));
  assert.equal(await kept.flush(), true);
  assert.equal(backend.stores.histories.get("score:1").end, "y");
  // A state that cannot be read is not saved, and throws nothing.
  kept.save(() => ({ end: null, past: [], future: [] }));
  assert.equal(await kept.flush(), false);
});

// Undo across someone else's change, as studio.js does it: the step's
// `after` to its `text`, merged onto the score as it now stands.

function canon(text) {
  const { score } = M.fromParsed(JSON.parse(score_json(text)));
  return M.toLilyPond(score).source;
}
const melody = (bars) => canon(`\\new Staff { \\time 4/4 ${bars.join(" | ")} }`);
const undoAcross = (step, now) => mergeScores(step.after, step.text, now, { parse: score_json });

test("undo after someone else's change keeps theirs, and takes back only mine", () => {
  const before = melody(["c'4 d' e' f'", "g'1", "a'1"]);
  const after = melody(["e'2 e'", "g'1", "a'1"]); // my step: bar 1
  const now = melody(["e'2 e'", "g'1", "c''1"]); // then theirs: bar 3
  const out = undoAcross({ text: before, after }, now);
  assert.deepEqual(out.conflicts, []);
  assert.equal(out.text, melody(["c'4 d' e' f'", "g'1", "c''1"]), "mine undone, theirs kept");
  // Putting the step's text back, as Undo did before, would have lost theirs.
  assert.notEqual(before, out.text);
});

test("undo across someone else's change to the same bar: refused, nothing changed", () => {
  const before = melody(["c'4 d' e' f'", "g'1"]);
  const after = melody(["e'2 e'", "g'1"]);
  const now = melody(["f'1", "g'1"]); // they rewrote my bar
  const out = undoAcross({ text: before, after }, now);
  assert.equal(out.text, null);
  assert.equal(out.conflicts.length, 1);
  assert.match(out.conflicts[0].label, /Bar 1/);
});

test("undo with nobody else's change: the step's text, exactly", () => {
  const before = melody(["c'4 d' e' f'"]);
  const after = melody(["e'2 e'"]);
  assert.equal(undoAcross({ text: before, after }, after).text, before);
});
