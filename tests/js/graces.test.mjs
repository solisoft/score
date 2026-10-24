// Grace notes played as their kind asks (#389, public/eui-score/graces.js):
// an acciaccatura short and before the beat, an appoggiatura half the note
// (two thirds of a dotted one), after-grace notes in the note's last quarter.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { midi, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as F from "../../public/eui-score/feel.js";
import * as G from "../../public/eui-score/graces.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const read = (source) => {
  const score = M.fromParsed(JSON.parse(score_json(source))).score;
  score.meta = M.readMeta(source);
  return score;
};
const engraved = (score) => midi(M.toLilyPond(score, { unfold: true }).source, M.DEFAULT_BPM, 4, 0);

/** Each note of the file's tracks, in seconds: [{ key, on, off }] by start, through the tempo events. */
function notes(bytes) {
  const smf = F.readSmf(bytes);
  const tempos = smf.tracks.flat().filter((e) => e.data[0] === 0xff && e.data[1] === 0x51).map((e) => [e.tick, (e.data[3] << 16) | (e.data[4] << 8) | e.data[5]]);
  tempos.sort((a, b) => a[0] - b[0]);
  const sec = (tick) => {
    let s = 0;
    let last = 0;
    let us = 500000;
    for (const [at, u] of tempos) {
      if (at >= tick) break;
      s += ((at - last) * us) / smf.division / 1e6;
      last = at;
      us = u;
    }
    return s + ((tick - last) * us) / smf.division / 1e6;
  };
  const out = [];
  for (const events of smf.tracks) {
    const open = new Map();
    for (const e of events) {
      const kind = e.data[0] & 0xf0;
      if (kind === 0x90 && e.data[2] > 0) {
        const n = { key: e.data[1], on: sec(e.tick), off: null };
        open.set(e.data[1], [...(open.get(e.data[1]) ?? []), n]);
        out.push(n);
      } else if (kind === 0x80 || kind === 0x90) {
        const n = open.get(e.data[1])?.shift();
        if (n) n.off = sec(e.tick);
      }
    }
  }
  return out.sort((a, b) => a.on - b.on || a.key - b.key);
}
const near = (actual, expected, what) => assert.ok(Math.abs(actual - expected) < 0.002, `${what}: ${actual.toFixed(4)} s, not ${expected.toFixed(4)} s`);
const played = (source) => {
  const score = read(source);
  return notes(G.applyGraces(score, engraved(score)));
};
const C4 = 60;
const D4 = 62;
const E4 = 64;

test("the timing of each kind, worked out alone", () => {
  const short = 10;
  // Short ones: before the beat, a short value each, the note before cut.
  assert.deepEqual(G.graceTiming({ kind: "acciaccatura", start: 100, value: 40, written: [5], short }), { graces: [[90, 100]], main: 100, mainEnd: null, cut: 90 });
  assert.deepEqual(G.graceTiming({ kind: "grace", start: 100, value: 40, written: [5, 5], short }).graces, [[80, 90], [90, 100]], "a group: a short value each");
  assert.deepEqual(G.graceTiming({ kind: "slashedGrace", start: 100, value: 40, written: [5], short }).main, 100);
  // No room before: taken from the note, half of it at most.
  assert.deepEqual(G.graceTiming({ kind: "acciaccatura", start: 0, value: 40, written: [5], short, room: 0 }), { graces: [[0, 10]], main: 10, mainEnd: null, cut: null });
  assert.equal(G.graceTiming({ kind: "acciaccatura", start: 0, value: 12, written: [5, 5], short, room: 0 }).main, 6);
  // Appoggiaturas: half the note, two thirds of a dotted one, shared as written.
  assert.deepEqual(G.graceTiming({ kind: "appoggiatura", start: 0, value: 60, written: [8], short }), { graces: [[0, 30]], main: 30, mainEnd: null, cut: null });
  assert.equal(G.graceTiming({ kind: "appoggiatura", start: 0, value: 60, dotted: true, written: [8], short }).main, 40);
  assert.deepEqual(G.graceTiming({ kind: "appoggiatura", start: 0, value: 60, written: [2, 1], short }).graces, [[0, 20], [20, 30]]);
  // After-grace: the note from its beat to its 3/4 point, the graces in the last quarter.
  assert.deepEqual(G.graceTiming({ kind: "afterGrace", start: 0, value: 80, written: [1, 1], short }), { graces: [[60, 70], [70, 80]], main: 0, mainEnd: 60, cut: null });
});

test("an acciaccatura at 100 a quarter: 60 ms before the beat, which the note keeps", () => {
  const n = played("{ \\tempo 4 = 100 c'4 \\acciaccatura d'8 e'4 c'2 }");
  const q = 0.6;
  assert.equal(n[0].key, C4);
  near(n[0].off, q - 0.06, "the note before ends where the grace note starts");
  assert.equal(n[1].key, D4);
  near(n[1].on, q - 0.06, "the grace note, 60 ms before the beat");
  near(n[1].off, q, "to the beat");
  assert.equal(n[2].key, E4);
  near(n[2].on, q, "the note, on its beat");
  near(n[2].off, 2 * q, "as long as written");
});

test("an acciaccatura at 240 a quarter: a 32nd (31 ms), shorter than 60 ms", () => {
  const n = played("{ \\tempo 4 = 240 c'4 \\acciaccatura d'8 e'4 c'2 }");
  const q = 0.25;
  const short = q / 8;
  near(n[1].on, q - short, "a 32nd before the beat");
  near(n[2].on, q, "the note on the beat");
  near(n[0].off, q - short, "the note before shortened by as much");
});

test("an appoggiatura takes half the note, two thirds of a dotted one, at either speed", () => {
  for (const bpm of [100, 240]) {
    const q = 60 / bpm;
    const n = played(`{ \\tempo 4 = ${bpm} \\appoggiatura d'8 e'4 \\appoggiatura d'8 e'4. r8 }`);
    near(n[0].on, 0, `${bpm}: the appoggiatura on the beat`);
    near(n[0].off, q / 2, `${bpm}: half the quarter`);
    near(n[1].on, q / 2, `${bpm}: the note half a quarter late`);
    near(n[1].off, q, `${bpm}: and ends where written`);
    near(n[2].on, q, `${bpm}: the second on its beat`);
    near(n[2].off, q + q, `${bpm}: two thirds of a dotted quarter`);
    near(n[3].on, 2 * q, `${bpm}: the dotted note starts there`);
    near(n[3].off, 2.5 * q, `${bpm}: and ends where written`);
  }
});

test("a plain \\grace is short like an acciaccatura; a group shares the time before the beat", () => {
  const n = played("{ \\tempo 4 = 100 c'4 \\grace { d'16 e' } f'4 c'2 }");
  near(n[0].off, 0.6 - 0.12, "two short values taken from the note before");
  near(n[1].on, 0.48, "the first");
  near(n[2].on, 0.54, "the second");
  near(n[3].on, 0.6, "the note on the beat");
});

test("a grace note on the very first beat takes its time from its note", () => {
  const n = played("{ \\tempo 4 = 100 \\acciaccatura d'8 c'4 r2. }");
  near(n[0].on, 0, "the grace note from the start, not before it");
  near(n[1].on, 0.06, "the note 60 ms late");
  near(n[1].off, 0.6, "and ends where written");
});

test("each pass of a repeat is played so; a score without grace notes is the same bytes", () => {
  const score = read("{ \\tempo 4 = 100 \\repeat volta 2 { c'4 \\acciaccatura d'8 e'4 r2 } }");
  const n = notes(G.applyGraces(score, engraved(score)));
  const ds = n.filter((x) => x.key === D4);
  assert.equal(ds.length, 2);
  near(ds[0].on, 0.54, "first time");
  near(ds[1].on, 2.4 + 0.54, "second time");
  const plain = read("{ c'4 d' e' f' }");
  const bytes = engraved(plain);
  assert.equal(G.applyGraces(plain, bytes), bytes);
  assert.equal(G.applyGraces(null, bytes), bytes);
});

test("a file that is not this score's is left as it is", () => {
  const score = read("{ c'4 \\acciaccatura d'8 e'4 r2 }");
  const other = read("{ c'4 d'4 r2 }\n");
  const bytes = engraved(other);
  assert.equal(G.applyGraces(score, bytes), bytes, "its notes are not where the grace notes would be");
  const two = read("<< \\new Staff { c'4 \\acciaccatura d'8 e'4 r2 } \\new Staff { c4 r2. } >>");
  const one = engraved(score);
  assert.equal(G.applyGraces(two, one), one, "one track for two staves");
  assert.notEqual(G.applyGraces(score, one), one, "its own score's: moved");
});

test("lighting: the note after an appoggiatura lights late, after an acciaccatura on its beat", () => {
  const score = read("{ \\tempo 4 = 100 c'4 \\acciaccatura d'8 e'4 \\appoggiatura d'8 e'4 r4 }");
  const passes = M.playback(score);
  const at = M.starts(score.staves[0]);
  near(G.heardAt(score, passes, 0, 1)[0], 0.6, "acciaccatura: on the beat");
  near(G.heardAt(score, passes, 0, 2, at[2])[0], 1.2 + 0.3, "appoggiatura: half a quarter late");
  near(G.heardAt(score, passes, 0, 0)[0], 0, "no grace notes: as written");
  near(M.heardAt(score, passes, 0, 1)[0], 0.6 + 0.3, "eui-score's own MIDI, for velocity.js: the note after the eighth");
});
