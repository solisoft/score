// Long scores (#689): the model reads a text, plays it and lights its notes
// in a time that grows with the score, not with its square — and gives the
// very same answers it gave before it was made faster.
//
//   node --test tests/js/long_scores.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import init, { score_json, source_spans } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as G from "../../public/eui-score/graces.js";
import * as S from "../../public/eui-score/midi-sync.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const withSpans = (text) => {
  const parsed = JSON.parse(score_json(text));
  parsed.spans = JSON.parse(source_spans(text));
  return parsed;
};

// The model's ids (tuplets…) count up for the whole page: numbered afresh, in order, for each score.
const renumbered = (value) => {
  const ids = new Map();
  return JSON.stringify(value, (key, v) => {
    if (key !== "id" || typeof v !== "number") return v;
    if (!ids.has(v)) ids.set(v, ids.size);
    return ids.get(v);
  });
};
const digest = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** What the model answers for a text: its reading, its passes, when each note is heard, its LilyPond. */
function answers(text) {
  const read = M.fromParsed(withSpans(text), text, { parse: withSpans });
  const passes = M.playback(read.score);
  const heard = [];
  read.score.staves.forEach((staff, s) => {
    const at = M.starts(staff);
    staff.events.forEach((ev, i) => {
      if (!ev.rest) heard.push(G.heardAt(read.score, passes, s, i, at[i]));
    });
  });
  return {
    from: digest(renumbered({ score: read.score, unsupported: read.unsupported ?? null, lost: read.lost ?? null })),
    playback: digest(JSON.stringify(passes)),
    heard: digest(JSON.stringify(heard)),
    ly: digest(M.toLilyPond(read.score).source),
  };
}

const FEATURES = `\\score { << \\new Staff { \\tempo 4 = 90 \\time 3/4 \\repeat volta 2 { c'4 d'\\fermata e' | \\tuplet 3/2 { f'8 g' a' } b'2 } \\alternative { { c''2. } { d''2. } } \\tempo 4 = 120 << { e''4 f'' g'' } \\\\ { c''2. } >> | \\grace d''8 e''2.\\fermata | \\time 4/4 c''1 \\bar "|." } \\new Staff { \\clef bass c4 d e | f2. | g,2. | a,2. | b,2. | c1 } >> }\n`;

// Taken from the model as it was before #689 (origin/main 7a268fb): the same text, the same answers.
const GOLDEN = {
  "scores/piano/fur-elise.ly": { from: "f646d4f7d820d237", playback: "072e11313f702cb3", heard: "f0fe54b95606240e", ly: "7028ff2b95a3adb6" },
  "scores/ensembles/symphony-5.ly": { from: "0788fe2454d2f159", playback: "5bf3e6b61a5e2acb", heard: "4d1c1d7986c48090", ly: "775a4bf2fd733f06" },
  "scores/ensembles/string-quartet.ly": { from: "4bc8d5f9fe97cf2b", playback: "6ce5164878ea8622", heard: "5c1d440117319507", ly: "81a59158a6816d62" },
  "scores/ensembles/jazz-trio.ly": { from: "755aaf1e41224f65", playback: "0dce29b814e19356", heard: "74cc70366cf8bff0", ly: "d91cf3426c0319f2" },
  "scores/changelog/endings.ly": { from: "fa8916e8df057b0c", playback: "58acec7cb55e0289", heard: "b59ee02da1f4cb4d", ly: "19c032d3d1da1753" },
  "scores/changelog/pedal-and-jumps.ly": { from: "2fb00a35d9904c5b", playback: "39849b3d2439ca3d", heard: "399c6ecd158cbdb7", ly: "c2e837095c8c8f26" },
  "scores/changelog/part-combine.ly": { from: "a5d697fdea26801e", playback: "6fae1b562de1faa7", heard: "f9add5b22613bc92", ly: "c1687186af2e088c" },
  "scores/changelog/fig-diagrams-graces.ly": { from: "51ccea4c17677d01", playback: "d27d14551a1deea5", heard: "34eb5561200ce87e", ly: "58e8ff86cf182e2a" },
  "scores/changelog/tempo-over-grace.ly": { from: "57e7bd08c3426683", playback: "e32b727db68af34e", heard: "e055c4a6478e8fca", ly: "ef6251038996a367" },
  "scores/voice/satb-chorale.ly": { from: "b6d171a3cbe98d00", playback: "2dc6eb9d87452864", heard: "071b09bccc196d40", ly: "35b82f00ec60994c" },
  "scores/syntax/repeats.ly": { from: "1cb905ed09cf7e60", playback: "a8939192ae72f6a9", heard: "6625324d33d6a5ad", ly: "1599ef7b818c7e58" },
  "features": { from: "0d4eaca306ed749f", playback: "f3b8df1bbf6e650c", heard: "f13c2917057a86f8", ly: "cfd03bde7e4530ac" },
};

test("the model answers what it answered before it was made faster, on real scores (#689)", () => {
  for (const [name, want] of Object.entries(GOLDEN)) {
    const text = name === "features" ? FEATURES : readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
    assert.deepEqual(answers(text), want, name);
  }
});

/** 4 staves of eighth notes, `bars` long; a fermata, a repeat and a tempo change in it. */
function long(bars) {
  const bar = "c'8 d' e' f' g' a' b' c'' | ";
  const staff = `\\new Staff { \\tempo 4 = 100 ${bar.repeat(bars / 2)} \\repeat volta 2 { c'2\\fermata d'2 | } \\tempo 4 = 80 ${bar.repeat(bars / 2 - 1)} }`;
  return `<< ${staff} ${staff} ${staff} ${staff} >>\n`;
}

/** The best of three timings of `fn`, in ms. */
function timed(fn) {
  let best = Infinity;
  for (let k = 0; k < 3; k++) {
    const t = performance.now();
    fn();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

test("reading, playing and timing the notes of a score four times longer takes about four times longer, not sixteen (#689)", () => {
  const sizes = [100, 400].map((bars) => {
    const text = long(bars);
    const parsed = withSpans(text);
    const score = M.fromParsed(parsed, text).score;
    assert.equal(M.barsOf(score), bars);
    const passes = M.playback(score);
    const starts = score.staves.map((staff) => M.starts(staff));
    return {
      read: timed(() => M.fromParsed(parsed, text)),
      play: timed(() => M.playback(score)),
      heard: timed(() => score.staves.forEach((staff, s) => staff.events.forEach((ev, i) => G.heardAt(score, passes, s, i, starts[s][i])))),
    };
  });
  // Linear: ×4. Quadratic, as it was: ×16 and more. Room left for a busy machine.
  for (const what of ["read", "play", "heard"]) {
    const ratio = sizes[1][what] / Math.max(sizes[0][what], 0.5);
    assert.ok(ratio < 9, `${what}: ${sizes[0][what].toFixed(1)} ms for 100 bars, ${sizes[1][what].toFixed(1)} ms for 400 (×${ratio.toFixed(1)})`);
  }
});

test("a fermata is held on every pass through its bar, and only there (#689)", () => {
  const score = M.fromParsed(withSpans(long(4)), long(4)).score;
  const passes = M.playback(score);
  const held = passes.filter((p) => p.holds.length);
  // The repeated bar, played twice; its half note held as long again.
  assert.deepEqual(held.map((p) => p.bar), [2, 2]);
  assert.deepEqual(held[0].holds, [{ at: M.notated(2), ticks: M.notated(2) }]);
  // Each pass its own holds, not one list shared by both.
  assert.notEqual(held[0].holds, held[1].holds);
});

test("passesThrough answers a bar's passes in order, as a filter of them would", () => {
  const score = M.fromParsed(withSpans(FEATURES), FEATURES).score;
  const passes = M.playback(score);
  for (let bar = -1; bar <= M.barsOf(score); bar++) assert.deepEqual(M.passesThrough(passes, bar), passes.filter((p) => p.bar === bar), `bar ${bar}`);
  // Another playback, another index.
  const again = M.playback(score);
  assert.equal(M.passesThrough(again, 0)[0], again[0]);
});

test("litAt finds the notes started last, moving on, jumping ahead and going back as a walk from the start would", () => {
  const times = Array.from({ length: 500 }, (_, k) => ({ sec: k * 0.25 + (k % 3) * 0.01 }));
  const walk = (sec) => {
    let k = -1;
    while (k + 1 < times.length && times[k + 1].sec <= sec + 0.01) k++;
    return k;
  };
  let lit = -1;
  // Frames moving on, a seek ahead, a loop back, the very start, past the end.
  const secs = [0, 0.016, 0.2, 0.26, 0.5, 3.3, 3.31, 90, 90.02, 12, 12.5, 0, -1, 2, 124.9, 200, 1];
  for (const sec of secs) {
    const found = M.litAt(times, sec, lit);
    assert.equal(found, walk(sec), `at ${sec} s from ${lit}`);
    lit = found;
  }
  assert.equal(M.litAt([], 3, -1), -1);
  assert.equal(M.litAt(times, 3, 999), walk(3), "from an index past the end");
});

/** midi-sync's studio, as small as it can be: no page, the clock's port `port`. */
function syncStudio({ clockOut = false } = {}) {
  const storage = new Map([["eui-score-midi-sync", JSON.stringify({ clockOut })]]);
  globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) };
  const listeners = {};
  const root = { isConnected: true, querySelector: () => null, addEventListener: (type, fn) => (listeners[type] = fn) };
  const st = { playing: null };
  const sent = [];
  const port = { send: (data) => sent.push(data) };
  const P = { outputPort: () => port };
  return { root, st, listeners, sent, sync: S.attach({ root, st, M, P, act: () => {}, say: () => {} }) };
}

test("the MIDI clock is polled only while the music plays with the clock on, not every 25 ms for as long as the page is open (#689)", async () => {
  const off = syncStudio({ clockOut: false });
  assert.equal(off.sync.polling(), false, "nothing polled once the editor is open");
  off.st.playing = { passes: [], handle: { playing: true, heard: 0, time: 0, rate: 1 } };
  off.sync.wake();
  assert.equal(off.sync.polling(), false, "the clock off: nothing polled while the music plays");
  off.sync.stop();

  const on = syncStudio({ clockOut: true });
  assert.equal(on.sync.polling(), false, "the clock on, the music stopped: nothing polled");
  on.sync.wake();
  assert.equal(on.sync.polling(), false, "woken with no music: nothing polled");
  on.st.playing = { passes: M.playback(M.fromParsed(withSpans(FEATURES), FEATURES).score), handle: { playing: true, heard: 0, time: 0, rate: 1 } };
  on.sync.wake();
  assert.equal(on.sync.polling(), true, "polled while the music plays");
  assert.ok(on.sent.some((data) => data[0] === 0xfa), "the clock started with the music");
  on.sync.wake();
  assert.equal(on.sync.polling(), true, "already polling: woken again, still once");
  // The music stops: the next poll, 25 ms on, ends the polling, and the clock with it.
  on.st.playing = null;
  await new Promise((done) => setTimeout(done, 80));
  assert.equal(on.sync.polling(), false, "nothing polled once the music has stopped");
  assert.equal(on.sent.at(-1)[0], 0xfc, "the clock stopped with the music");
  // Played again: polled again.
  on.st.playing = { passes: [], handle: { playing: false, paused: true, heard: 0, time: 0, rate: 1 } };
  on.sync.wake();
  assert.equal(on.sync.polling(), true);
  on.sync.stop();
  assert.equal(on.sync.polling(), false, "the editor gone: nothing polled");
  delete globalThis.localStorage;
});
