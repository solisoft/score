// The drum grooves (public/eui-score/drums.js, #442): each groove's basic
// bar and its break, in its own metre, written through the drum grid
// (patterns.js), engraved by the real engraver, played, and read back.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, midi, score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as D from "../../public/eui-score/drums.js";
import * as G from "../../public/eui-score/patterns.js";
import * as V from "../../public/eui-score/velocity.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

const read = (source) => M.fromParsed(JSON.parse(score_json(source))).score;
const again = (score) => read(M.toLilyPond(score).source);
const BAR = { "4/4": "1", "3/4": "2.", "6/8": "2.", "12/8": "1." };

/** Four empty bars of a drum staff in `time`. */
function kit(time) {
  return read(String.raw`\new DrumStaff \with { instrumentName = "Drums" } \drummode { \time ${time} r${BAR[time]} | r | r | r }`);
}

/** The drums struck in bar `b`, as "step:name" strings, from the grid. */
function struck(score, b) {
  const grid = G.drumGrid(score, 0, b);
  const out = Object.entries(grid.rows).flatMap(([name, row]) => row.flatMap((v, k) => (v ? [`${k}:${name}`] : [])));
  grid.others.forEach((names, k) => names.forEach((name) => out.push(`${k}:${name}`)));
  return out.sort();
}

test("a lot of grooves, each with a basic bar and a break, in the drums the score knows", () => {
  assert.ok(D.GROOVES.length >= 45, `${D.GROOVES.length} grooves`);
  const names = new Set(M.DRUMS.map((d) => d.name));
  const ids = new Set();
  for (const groove of D.GROOVES) {
    assert.ok(!ids.has(groove.id), `${groove.id} once`);
    ids.add(groove.id);
    assert.ok(BAR[groove.time], `${groove.id}: a metre the grid knows`);
    for (const lines of [groove.main, D.breakOf(groove)]) {
      for (const [name, line] of Object.entries(lines)) {
        assert.ok(names.has(name), `${groove.id}: ${name} is a drum`);
        assert.equal(line.length, D.stepsOf(groove), `${groove.id}: the ${name} line fills the bar`);
        assert.match(line, /^[-xXg]+$/);
      }
    }
    assert.notDeepEqual(D.breakOf(groove), groove.main, `${groove.id}: its break is not its basic bar`);
  }
  assert.equal(D.grooveOf("no-such"), null);
});

test("every groove written in its metre, its break every fourth bar, engraves, plays and reads back", () => {
  for (const groove of D.GROOVES) {
    const score = kit(groove.time);
    assert.equal(G.writeGroove(score, 0, 0, 3, groove), 4);
    const { source } = M.toLilyPond(score);
    try {
      JSON.parse(editor_view(source, 1200, 7, -1, -1));
    } catch (error) {
      throw new Error(`${groove.id}: ${error.message ?? error}\n${source}`);
    }
    midi(M.toLilyPond(score, { unfold: true }).source, 100, 4, 0);
    const back = again(score);
    const expected = (lines) => {
      const per = G.drumGrid(back, 0, 0).steps / D.stepsOf(groove);
      return Object.entries(lines).flatMap(([name, line]) => [...line].flatMap((c, k) => (c === "-" ? [] : [`${k * per}:${name}`]))).sort();
    };
    for (const b of [0, 1, 2]) assert.deepEqual(struck(back, b), expected(D.variedBar(groove.main, b)), `${groove.id}: bar ${b + 1}, the basic bar, as varied`);
    assert.deepEqual(struck(back, 3), expected(D.breakOf(groove)), `${groove.id}: bar 4, the break`);
  }
});

test("without breaks, the basic bar in each; a groove refused in another metre, or off a drum staff", () => {
  const score = kit("4/4");
  const rock = D.grooveOf("rock");
  G.writeGroove(score, 0, 0, 1, rock, { breaks: false });
  assert.deepEqual(struck(score, 1), struck(score, 0));
  assert.throws(() => G.writeGroove(score, 0, 0, 0, D.grooveOf("waltz")), /This groove is in 3\/4 and bar 1 in 4\/4/);
  const notes = read(String.raw`{ c'1 }`);
  assert.throws(() => G.writeGroove(notes, 0, 0, 0, rock), /a drum staff's/);
  assert.throws(() => G.grooveGrid(score, 0, { sn: "x-x" }, "4/4"), /3 steps/);
});

test("played as a drummer plays it (#455): strong backbeat, light off-beats, ghost notes, a fill that builds", () => {
  const funk = D.grooveOf("funk");
  const at = (strokes, drum, k) => strokes.find((x) => x.drum === drum && x.at === k)?.velocity;
  const main = D.dynamicsOf(funk.main, "4/4");
  assert.ok(at(main, "sn", 4) >= 105, "the backbeat");
  assert.ok(at(main, "sn", 7) <= 40, "a ghost note");
  assert.ok(at(main, "hh", 0) > at(main, "hh", 2), "the hi-hat on the beat over its off-beat");
  assert.ok(at(main, "hh", 2) > at(main, "hh", 3), "and its off-beat over its sixteenth");
  const fill = D.dynamicsOf(D.breakOf(D.grooveOf("rock")), "4/4", { fill: true }).filter((x) => x.drum.startsWith("tom") || x.drum === "sn");
  assert.ok(fill.at(-1).velocity > fill[0].velocity + 20, "the break builds");
  const waltz = D.dynamicsOf(D.grooveOf("waltz").main, "3/4");
  assert.ok(waltz.every((x) => x.velocity >= 1 && x.velocity <= 127));
});

test("each stroke's force kept as its velocity; a crash opens the second phrase; humanized when asked", () => {
  const score = read(String.raw`\new DrumStaff \drummode { \time 4/4 r1 | r | r | r | r | r | r | r }`);
  G.writeGroove(score, 0, 0, 7, D.grooveOf("funk"), { feel: true });
  const set = score.meta.velocity;
  const values = Object.values(set);
  assert.ok(values.length > 50, "every stroke has its force");
  assert.ok(Math.max(...values) - Math.min(...values) > 60, "from ghost notes to the backbeat");
  const ids = new Set(V.velocityNotes(score).map((n) => n.id));
  assert.ok(Object.keys(set).every((id) => ids.has(id)), "each velocity names a note the MIDI view shows");
  assert.ok(struck(score, 4).includes("0:cymc"), "a crash opens the second phrase");
  assert.ok(!struck(score, 0).includes("0:cymc"), "not the first");
  assert.ok(struck(score, 2).some((x) => x.endsWith(":hho")), "the third bar breathes");
  assert.deepEqual(score.meta.humanize, D.DRUMMER_FEEL);
  // Written again: the bar's old velocities go, none left behind.
  G.writeGroove(score, 0, 0, 0, D.grooveOf("rock"), { breaks: false });
  assert.ok(Object.keys(score.meta.velocity).every((id) => ids.has(id) || V.velocityNotes(score).some((n) => n.id === id)));
  // Heard: the velocities reach the MIDI.
  const bytes = new Uint8Array(midi(M.toLilyPond(score, { unfold: true }).source, 100, 4, 0));
  const heard = new Set(V.midiNoteOns(V.applyVelocities(score, bytes)).map((n) => n.velocity));
  assert.ok(heard.size > 4, `${heard.size} different forces heard`);
});
