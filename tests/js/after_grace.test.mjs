// Grace notes after a note, \afterGrace (#389): never lost by the editor,
// whatever engraver the site ships — refused by one that does not read it,
// edited as text by one that reads it without handing its notes over, and
// read, written back and played from the 3/4 point by one that does.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { check, midi, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as F from "../../public/eui-score/feel.js";
import * as G from "../../public/eui-score/graces.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const SOURCE = "\\header { title = \"After\" }\n{ \\time 4/4 c''4 \\afterGrace d''2 { e''16 f''16 } c''4 | \\afterGrace 7/8 g'1 { a'16 } }";
/** The engraver reads \afterGrace (eui #389 on). */
const READS = check(SOURCE) === "";
/** …and hands its notes over to the editor (wasm/src/editor.rs's after_graces). */
const HANDS_OVER = READS && JSON.parse(score_json(SOURCE)).staves[0].events.some((ev) => "after_graces" in ev);

const open = (source) => M.fromParsed(JSON.parse(score_json(source)), source);

/** Each note of a MIDI file, in its ticks: [{ key, on, off }] by start. */
function notes(bytes) {
  const smf = F.readSmf(bytes);
  const out = [];
  for (const track of smf.tracks) {
    const open = new Map();
    for (const ev of track) {
      const [status, key, vel] = ev.data;
      if ((status & 0xf0) === 0x90 && vel > 0) open.set(key, ev.tick);
      else if ((status & 0xf0) === 0x80 || ((status & 0xf0) === 0x90 && vel === 0)) {
        if (open.has(key)) out.push({ key, on: open.get(key), off: ev.tick });
        open.delete(key);
      }
    }
  }
  return { division: smf.division, notes: out.sort((a, b) => a.on - b.on || a.key - b.key) };
}

test("whatever the engraver, the editor never writes a text without its after-grace notes", () => {
  let result;
  try {
    result = open(SOURCE);
  } catch (error) {
    // An engraver from before #389 refuses it: the page edits the text.
    assert.ok(!READS);
    assert.match(String(error.message ?? error), /afterGrace/);
    return;
  }
  if (!result.score) {
    assert.ok(result.unsupported.some((u) => /afterGrace/.test(u)), `said: ${result.unsupported}`);
    assert.ok(!HANDS_OVER, "only when the notes are not handed over");
    return;
  }
  const { source } = M.toLilyPond(result.score);
  assert.match(source, /\\afterGrace d''2 \{ e''16 f''16 \}/);
  assert.match(source, /\\afterGrace 7\/8 g'1 \{ a'16 \}/);
});

test("\\afterGrace's fraction as LilyPond writes it, and graceTiming's starting point", () => {
  assert.equal(M.afterFraction(7 / 8), "7/8");
  assert.equal(M.afterFraction(15 / 16), "15/16");
  assert.equal(M.afterFraction(1 / 2), "1/2");
  assert.equal(M.afterFraction(0.7), "45/64", "the nearest sixty-fourth");
  // From 3/4 of the note by default, from the fraction given.
  const at = (opts) => G.graceTiming({ kind: "afterGrace", start: 0, value: 64, written: [1], short: 2, ...opts });
  assert.deepEqual(at({}), { graces: [[48, 64]], main: 0, mainEnd: 48, cut: null });
  assert.deepEqual(at({ at: 7 / 8 }), { graces: [[56, 64]], main: 0, mainEnd: 56, cut: null });
});

test("read, written back, transposed, and dropped with the note made a rest", { skip: !HANDS_OVER && "this engraver does not hand \\afterGrace's notes over" }, () => {
  const { score } = open(SOURCE);
  const d = score.staves[0].events[1];
  assert.deepEqual(d.afterGraces.map((g) => [g.pitches[0].d, g.base]), [[16, 16], [17, 16]]);
  assert.equal(d.afterAt, M.AFTER_GRACE_AT);
  const g = score.staves[0].events[3];
  assert.equal(g.afterAt, 7 / 8);
  // Written as read: the same text again.
  const once = M.toLilyPond(score).source;
  assert.equal(M.toLilyPond(open(once).score).source, once);
  assert.equal(check(once), "");
  // A tone up: the after-grace notes go with their note.
  M.transpose(score, { steps: 1, semitones: 2 });
  assert.match(M.toLilyPond(score).source, /\\afterGrace e''2 \{ fis''16 g''16 \}/);
  // A rest has none.
  const s = open(SOURCE).score;
  M.remove(s, 0, 1);
  assert.ok(s.staves[0].events[1].rest);
  assert.equal(s.staves[0].events[1].afterGraces, undefined);
  assert.doesNotMatch(M.toLilyPond(s).source, /afterGrace d''/);
});

test("played from the note's 3/4 point, as graceTiming says", { skip: !HANDS_OVER && "this engraver does not hand \\afterGrace's notes over" }, () => {
  const { score } = open(SOURCE);
  const { division, notes: played } = notes(midi(M.toLilyPond(score).source, M.DEFAULT_BPM, 4, 0));
  const ratio = M.WHOLE / 4 / division;
  const found = G.afterGraces(score);
  assert.equal(found.length, 2);
  for (const { s, i, timing } of found) {
    const ev = score.staves[s].events[i];
    const main = played.find((n) => n.key === M.midiKey(ev.pitches[0].d, ev.pitches[0].alter) && Math.abs(n.on * ratio - timing.main) <= 2 * ratio);
    assert.ok(main, "the note, on its beat");
    assert.ok(Math.abs(main.off * ratio - timing.mainEnd) <= 2 * ratio, `the note ends at ${timing.mainEnd}`);
    ev.afterGraces.forEach((gn, j) => {
      const heard = played.find((n) => n.key === M.midiKey(gn.pitches[0].d, gn.pitches[0].alter) && Math.abs(n.on * ratio - timing.graces[j][0]) <= 2 * ratio);
      assert.ok(heard, `after-grace note ${j} at ${timing.graces[j][0]}`);
    });
  }
  // The grace notes before a note are still moved; those after it are left where eui-score plays them.
  const bytes = midi(M.toLilyPond(score).source, M.DEFAULT_BPM, 4, 0);
  assert.deepEqual(G.applyGraces(score, bytes), bytes);
});
