// Two people editing one score (public/eui-score/merge.js): the three-way
// merge by staff and by bar, and of the meta line key by key, against the
// real engraver's reader.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import { mergeScores, conflictLines } from "../../public/eui-score/merge.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

/** The text as the editor writes it (what an editor saves). */
function canon(text, meta = null) {
  const { score } = M.fromParsed(JSON.parse(score_json(text)));
  assert.ok(score, `reads: ${text}`);
  score.meta = meta;
  return M.toLilyPond(score).source;
}

const merge = (base, mine, theirs, prefer = null) => mergeScores(base, mine, theirs, { parse: score_json, prefer });

/** One staff of `bars` (each a bar's music). */
const melody = (bars, title = "Duet") => canon(`\\header { title = "${title}" } \\new Staff { \\time 4/4 ${bars.join(" | ")} }`);

/** A piano: two staves in a brace, `upper` and `lower` bar by bar. */
const piano = (upper, lower) =>
  canon(`\\new PianoStaff << \\new Staff { \\time 4/4 ${upper.join(" | ")} } \\new Staff { \\clef bass ${lower.join(" | ")} } >>`);

const BARS = ["c'4 d' e' f'", "g'1", "a'1", "b'1"];
const edit = (bars, k, music) => bars.map((bar, i) => (i === k ? music : bar));

test("bars changed on each side, apart: both kept", () => {
  const base = melody(BARS);
  const mine = melody(edit(BARS, 0, "e'2 e'2"));
  const theirs = melody(edit(BARS, 2, "f'2 f'2"));
  const out = merge(base, mine, theirs);
  assert.deepEqual(out.conflicts, []);
  assert.equal(out.text, melody(edit(edit(BARS, 0, "e'2 e'2"), 2, "f'2 f'2")));
});

test("the same bar changed two ways: a conflict naming the bar and the staff, settled either way", () => {
  const base = melody(BARS);
  const mine = melody(edit(edit(BARS, 1, "d''1"), 3, "c''1"));
  const theirs = melody(edit(BARS, 1, "e''1"));
  const out = merge(base, mine, theirs);
  assert.equal(out.text, null);
  assert.equal(out.whole, false);
  assert.equal(out.conflicts.length, 1);
  assert.equal(out.conflicts[0].label, "Bar 2, the staff");
  assert.deepEqual(conflictLines(out.conflicts), ["Bar 2, the staff"]);
  // Keep mine for that bar: theirs elsewhere (nothing), mine's other change kept.
  assert.equal(merge(base, mine, theirs, "mine").text, melody(edit(edit(BARS, 1, "d''1"), 3, "c''1")));
  // Take theirs for that bar: mine's bar 4 kept all the same.
  assert.equal(merge(base, mine, theirs, "theirs").text, melody(edit(edit(BARS, 1, "e''1"), 3, "c''1")));
});

test("the same bar changed the same way on both sides is no conflict", () => {
  const base = melody(BARS);
  const both = edit(BARS, 1, "d''1");
  const out = merge(base, melody(edit(both, 3, "c'1")), melody(both));
  assert.deepEqual(out.conflicts, []);
  assert.equal(out.text, melody(edit(both, 3, "c'1")));
});

test("bars next to one another in conflict are said together", () => {
  const base = melody(BARS);
  const mine = melody(["c''1", "c''1", "c''1", "b'1"]);
  const theirs = melody(["d''1", "d''1", "d''1", "b'1"]);
  const out = merge(base, mine, theirs);
  assert.equal(out.conflicts.length, 3);
  assert.deepEqual(conflictLines(out.conflicts), ["Bars 1–3, the staff"]);
});

test("round trips: what one side left alone takes the other's text as it is", () => {
  const base = melody(BARS);
  const x = melody(edit(BARS, 2, "c''1"));
  assert.equal(merge(base, base, x).text, x);
  assert.equal(merge(base, x, base).text, x);
  assert.equal(merge(base, x, x).text, x);
  // Not even read: a text the model cannot hold goes through too.
  assert.equal(merge(base, base, "anything at all").text, "anything at all");
});

test("a piano's two hands, each changed by one person: both kept; the same hand, a conflict named by hand", () => {
  const up = ["c''1", "d''1", "e''1"];
  const low = ["c1", "d1", "e1"];
  const base = piano(up, low);
  const out = merge(base, piano(edit(up, 0, "g''1"), low), piano(up, edit(low, 0, "g,1")));
  assert.deepEqual(out.conflicts, []);
  assert.equal(out.text, piano(edit(up, 0, "g''1"), edit(low, 0, "g,1")));
  const clash = merge(base, piano(up, edit(low, 2, "a,1")), piano(up, edit(low, 2, "b,1")));
  assert.deepEqual(conflictLines(clash.conflicts), ["Bar 3, Piano left hand"]);
});

test("the title on one side and a bar on the other: both kept; two titles, a conflict", () => {
  const base = melody(BARS);
  const out = merge(base, melody(BARS, "Renamed"), melody(edit(BARS, 3, "c''1")));
  assert.deepEqual(out.conflicts, []);
  assert.equal(out.text, melody(edit(BARS, 3, "c''1"), "Renamed"));
  const clash = merge(base, melody(BARS, "One"), melody(BARS, "Two"));
  assert.deepEqual(conflictLines(clash.conflicts), ["Title"]);
});

test("the meta line merges key by key, and inside the mixer setting by setting", () => {
  const notes = `\\new Staff { ${BARS.join(" | ")} }`;
  const base = canon(notes, { mixer: { 0: { volume: 100, pan: 0 } } });
  const mine = canon(notes, { mixer: { 0: { volume: 80, pan: 0 } }, swing: { amount: 0.6 } });
  const theirs = canon(notes, { mixer: { 0: { volume: 100, pan: -20 } }, velocity: { "0:0:60": 90 } });
  const out = merge(base, mine, theirs);
  assert.deepEqual(out.conflicts, []);
  assert.deepEqual(M.readMeta(out.text), { mixer: { 0: { volume: 80, pan: -20 } }, swing: { amount: 0.6 }, velocity: { "0:0:60": 90 } });
  // One setting set two ways: a conflict on that setting alone.
  const clash = merge(base, canon(notes, { mixer: { 0: { volume: 70, pan: 0 } } }), canon(notes, { mixer: { 0: { volume: 60, pan: 0 } } }));
  assert.deepEqual(conflictLines(clash.conflicts), ["Mixer (0 › volume)"]);
  assert.equal(M.readMeta(merge(base, canon(notes, { mixer: { 0: { volume: 70, pan: 0 } } }), canon(notes, { mixer: { 0: { volume: 60, pan: 0 } } }), "theirs").text).mixer[0].volume, 60);
  // A key taken away on one side, untouched on the other: gone.
  assert.deepEqual(M.readMeta(merge(base, canon(notes), canon(`\\new Staff { ${edit(BARS, 1, "c''1").join(" | ")} }`, { mixer: { 0: { volume: 100, pan: 0 } } })).text), {});
});

test("a bar inserted on one side: the other side's change lands on its bar, moved along", () => {
  const base = melody(BARS);
  // Theirs: a bar inserted after the first. Mine: the last bar changed.
  const theirs = melody([BARS[0], "r1", ...BARS.slice(1)]);
  const mine = melody(edit(BARS, 3, "c''1"));
  const out = merge(base, mine, theirs);
  assert.deepEqual(out.conflicts, []);
  assert.equal(out.text, melody([BARS[0], "r1", BARS[1], BARS[2], "c''1"]));
  // And the other way round.
  assert.equal(merge(base, theirs, mine).text, out.text);
});

test("a bar taken away on one side and changed on the other: the whole score", () => {
  const base = melody(BARS);
  const out = merge(base, melody(edit(BARS, 2, "c''1")), melody([BARS[0], BARS[1], BARS[3]]));
  assert.equal(out.whole, true);
  assert.equal(out.text, null);
  assert.match(out.conflicts[0].label, /Bar 3, taken away/);
  // Taken away, and the other side changed another bar: merged.
  const fine = merge(base, melody(edit(BARS, 0, "c''1")), melody([BARS[0], BARS[1], BARS[3]]));
  assert.equal(fine.text, melody(["c''1", BARS[1], BARS[3]]));
});

test("bars added on both sides: a conflict over the whole score", () => {
  const base = melody(BARS);
  const out = merge(base, melody([...BARS, "c''1"]), melody([...BARS, "d''1"]));
  assert.equal(out.whole, true);
  assert.equal(out.text, null);
});

test("a staff added on one side, a bar changed on the other: both", () => {
  const base = melody(BARS);
  const two = (first) => canon(`\\header { title = "Duet" } << \\new Staff { \\time 4/4 ${first.join(" | ")} } \\new Staff \\with { instrumentName = "Bass" } { \\clef bass c1 | d1 | e1 | f1 } >>`);
  const out = merge(base, melody(edit(BARS, 1, "c''1")), two(BARS));
  assert.deepEqual(out.conflicts, []);
  assert.equal(out.text, two(edit(BARS, 1, "c''1")));
});

test("a second voice written on one side, the first voice changed on the other", () => {
  const base = melody(BARS);
  const voiced = canon(`\\header { title = "Duet" } \\new Staff { \\time 4/4 ${BARS[0]} | << { g'1 } \\\\ { c'1 } >> | ${BARS[2]} | ${BARS[3]} }`);
  const out = merge(base, melody(edit(BARS, 3, "c''1")), voiced);
  assert.deepEqual(out.conflicts, []);
  const read = M.fromParsed(JSON.parse(score_json(out.text))).score;
  assert.equal(read.staves.length, 2, "the second voice kept");
  assert.match(out.text, /c''1/);
  assert.match(out.text, /\\\\ \{ c'1 \}/);
});

test("lyrics written on one side are kept beside a bar changed on the other", () => {
  const plainText = `\\header { title = "Song" } \\new Staff { \\time 4/4 c'4 d' e' f' | g'1 | a'1 | b'1 }`;
  const base = canon(plainText);
  const sung = canon(`${plainText.replace(/\}$/, "}")} \\addlyrics { la la la la so la }`);
  const mine = canon(plainText.replace("b'1", "c''1"));
  const out = merge(base, mine, sung);
  assert.deepEqual(out.conflicts, []);
  assert.match(out.text, /\\addlyrics \{ la la la la so la/);
  assert.match(out.text, /c''1/);
});

test("a text that holds what the model does not keep is never merged by bar", () => {
  const base = melody(BARS);
  const out = merge(base, melody(edit(BARS, 0, "c''1")), `${base}% a comment of theirs\n`);
  assert.equal(out.whole, true);
  assert.equal(out.text, null);
  assert.equal(merge(base, "\\new Staff { c'1 ", melody(BARS, "Other")).whole, true);
});

test("a change of metre on one side and a bar on the other, where the bars no longer agree: a conflict", () => {
  const base = melody(BARS);
  const threeFour = canon(`\\header { title = "Duet" } \\new Staff { \\time 4/4 c'4 d' e' f' | g'1 | \\time 3/4 a'2. | b'2. }`);
  const out = merge(base, melody(edit(BARS, 3, "c''1")), threeFour);
  assert.equal(out.text, null);
  assert.ok(out.conflicts.length > 0);
});

// ---- The meta line follows the bars and the staves ------------------------------------

const W = M.WHOLE;
const melodyWith = (bars, meta) => canon(`\\header { title = "Duet" } \\new Staff { \\time 4/4 ${bars.join(" | ")} }`, meta);

test("a bar inserted on one side: the other side's velocities and curves move along with their bars", () => {
  const base = melody(BARS);
  const inserted = melody([BARS[0], "r1", ...BARS.slice(1)]);
  // On bar 3 (its a', key 69): a velocity, and a modulation curve across it.
  const mine = melodyWith(BARS, { velocity: { [`0:${2 * W}:69`]: 90 }, cc: { 0: { 1: [[2 * W, 10], [2 * W + W / 2, 90]] } } });
  const out = merge(base, mine, inserted);
  assert.deepEqual(out.conflicts, []);
  const meta = M.readMeta(out.text);
  assert.deepEqual(meta.velocity, { [`0:${3 * W}:69`]: 90 });
  assert.deepEqual(meta.cc, { 0: { 1: [[3 * W, 10], [3 * W + W / 2, 90]] } });
  // The same, sides swapped.
  assert.deepEqual(M.readMeta(merge(base, inserted, mine).text), meta);
});

test("a bar taken away on one side: what was in it goes, what was after it moves back; changed in it, the whole score", () => {
  const base = melodyWith(BARS, { velocity: { [`0:${W}:67`]: 80, [`0:${2 * W}:69`]: 90 }, cc: { 0: { 1: [[0, 0], [W + W / 4, 64], [2 * W, 127]] } } });
  // Theirs: bar 2 taken away, its velocity and its curve point with it.
  const theirs = melodyWith([BARS[0], BARS[2], BARS[3]], { velocity: { [`0:${W}:69`]: 90 }, cc: { 0: { 1: [[0, 0], [W, 127]] } } });
  // Mine: the a' (bar 3) louder, and a point added in bar 4.
  const mine = melodyWith(BARS, { velocity: { [`0:${W}:67`]: 80, [`0:${2 * W}:69`]: 100 }, cc: { 0: { 1: [[0, 0], [W + W / 4, 64], [2 * W, 127], [3 * W, 30]] } } });
  const out = merge(base, mine, theirs);
  assert.deepEqual(out.conflicts, []);
  const meta = M.readMeta(out.text);
  assert.deepEqual(meta.velocity, { [`0:${W}:69`]: 100 });
  assert.deepEqual(meta.cc, { 0: { 1: [[0, 0], [W, 127], [2 * W, 30]] } });
  // Mine changed the velocity of the bar theirs took away: not merged by bar.
  const touched = melodyWith(BARS, { velocity: { [`0:${W}:67`]: 50, [`0:${2 * W}:69`]: 90 }, cc: { 0: { 1: [[0, 0], [W + W / 4, 64], [2 * W, 127]] } } });
  const clash = merge(base, touched, theirs);
  assert.equal(clash.whole, true);
  assert.equal(clash.text, null);
  // Or a curve point in it.
  const moved = melodyWith(BARS, { velocity: { [`0:${W}:67`]: 80, [`0:${2 * W}:69`]: 90 }, cc: { 0: { 1: [[0, 0], [W + W / 2, 64], [2 * W, 127]] } } });
  assert.equal(merge(base, moved, theirs).whole, true);
});

test("a staff added before the others on one side: the other side's mixer and velocities follow their staff", () => {
  const duet = (meta) => canon(`\\header { title = "Duet" } << \\new Staff { \\time 4/4 ${BARS.join(" | ")} } \\new Staff \\with { instrumentName = "Bass" } { \\clef bass c1 | d1 | e1 | f1 } >>`, meta);
  const trio = (meta) => canon(`\\header { title = "Duet" } << \\new Staff \\with { instrumentName = "Flute" } { \\time 4/4 c''1 | c''1 | c''1 | c''1 } \\new Staff { ${BARS.join(" | ")} } \\new Staff \\with { instrumentName = "Bass" } { \\clef bass c1 | d1 | e1 | f1 } >>`, meta);
  const base = duet(null);
  // Mine: the bass (lane 1) quieter, its first note softer.
  const mine = duet({ mixer: { tracks: { 1: { volume: -6 } } }, velocity: { "1:0:48": 70 } });
  // Theirs: a flute added first (lane 0), panned left.
  const theirs = trio({ mixer: { tracks: { 0: { pan: -0.5 } } } });
  const out = merge(base, mine, theirs);
  assert.deepEqual(out.conflicts, []);
  const meta = M.readMeta(out.text);
  assert.deepEqual(meta.mixer, { tracks: { 0: { pan: -0.5 }, 2: { volume: -6 } } });
  assert.deepEqual(meta.velocity, { "2:0:48": 70 });
  // An audio track's fader (#390) is no staff's: it stays where it is.
  const sung = merge(base, duet({ mixer: { tracks: { 1: { volume: -6 }, "audio-1": { volume: -12 } } } }), theirs);
  assert.deepEqual(M.readMeta(sung.text).mixer, { tracks: { 0: { pan: -0.5 }, 2: { volume: -6 }, "audio-1": { volume: -12 } } });
  assert.equal(M.fromParsed(JSON.parse(score_json(out.text))).score.staves[2].name, "Bass");
});

test("a second voice added on one side: the other side's later staves' meta moves to their new lanes", () => {
  const two = (first, meta) => canon(`\\header { title = "Duet" } << \\new Staff { \\time 4/4 ${first} } \\new Staff \\with { instrumentName = "Bass" } { \\clef bass c1 | d1 | e1 | f1 } >>`, meta);
  const base = two(BARS.join(" | "), null);
  const voiced = two(`${BARS[0]} | << { g'1 } \\\\ { c'1 } >> | ${BARS[2]} | ${BARS[3]}`, null);
  const mine = two(BARS.join(" | "), { mixer: { tracks: { 1: { mute: true } } } });
  const out = merge(base, mine, voiced);
  assert.deepEqual(out.conflicts, []);
  // The bass is lane 2 now, after the melody's second voice.
  assert.deepEqual(M.readMeta(out.text).mixer, { tracks: { 2: { mute: true } } });
});

test("a staff's synthesizer and its own SoundFont (#391) follow their staff, and merge setting by setting", () => {
  const duet = (meta) => canon(`\\header { title = "Duet" } << \\new Staff { \\time 4/4 ${BARS.join(" | ")} } \\new Staff \\with { instrumentName = "Bass" } { \\clef bass c1 | d1 | e1 | f1 } >>`, meta);
  const trio = (meta) => canon(`\\header { title = "Duet" } << \\new Staff \\with { instrumentName = "Flute" } { \\time 4/4 c''1 | c''1 | c''1 | c''1 } \\new Staff { ${BARS.join(" | ")} } \\new Staff \\with { instrumentName = "Bass" } { \\clef bass c1 | d1 | e1 | f1 } >>`, meta);
  const font = { name: "Pads.sf2", hash: "0123456789abcdef", bank: 0, program: 89, preset: "Warm Pad" };
  const base = duet({ synth: { 1: { preset: "bass" } } });
  // Mine: the bass's filter opened, the melody on my SoundFont.
  const mine = duet({ synth: { 1: { preset: "bass", filter: { cutoff: 0.6 } } }, soundfont: { 0: font } });
  // Theirs: a flute added first, on the lead; the bass's release longer.
  const theirs = trio({ synth: { 0: { preset: "lead" }, 2: { preset: "bass", amp: { release: 0.5 } } } });
  const out = merge(base, mine, theirs);
  assert.deepEqual(out.conflicts, []);
  const meta = M.readMeta(out.text);
  assert.deepEqual(meta.synth, { 0: { preset: "lead" }, 2: { preset: "bass", filter: { cutoff: 0.6 }, amp: { release: 0.5 } } });
  assert.deepEqual(meta.soundfont, { 1: font }, "the melody is lane 1 now");
  // The same knob turned two ways: a conflict naming it, settled either way.
  const a = duet({ synth: { 1: { preset: "bass", filter: { cutoff: 0.2 } } } });
  const b = duet({ synth: { 1: { preset: "bass", filter: { cutoff: 0.9 } } } });
  const clash = merge(base, a, b);
  assert.equal(clash.text, null);
  assert.deepEqual(clash.conflicts.map((c) => c.label), ["Synthesizer (1 › filter › cutoff)"]);
  assert.equal(M.readMeta(merge(base, a, b, "theirs").text).synth[1].filter.cutoff, 0.9);
  // A staff taken away on one side, its synthesizer untouched on the other: it goes with its staff.
  const solo = canon(`\\header { title = "Duet" } \\new Staff { \\time 4/4 ${BARS.join(" | ")} }`, null);
  assert.equal(M.readMeta(merge(base, base, solo).text).synth, undefined);
});

test("an audio track's lane (#390) in the synthesizer or SoundFont keys is no staff's: it goes, and nothing conflicts", () => {
  const one = (meta) => canon(`\\header { title = "Duet" } \\new Staff { \\time 4/4 ${BARS.join(" | ")} }`, meta);
  const base = one({ mixer: { tracks: { "audio-1": { volume: -3 } } } });
  const mine = one({ mixer: { tracks: { "audio-1": { volume: -3 } } }, synth: { 0: { preset: "lead" }, "audio-1": { preset: "pad" } } });
  const theirs = one({ mixer: { tracks: { "audio-1": { volume: -9 } } }, soundfont: { "audio-2": { name: "x.sf2", hash: "0123456789abcdef", bank: 0, program: 1 } } });
  const out = merge(base, mine, theirs);
  assert.deepEqual(out.conflicts, []);
  const meta = M.readMeta(out.text);
  assert.deepEqual(meta.synth, { 0: { preset: "lead" } });
  assert.equal(meta.soundfont, undefined);
  assert.deepEqual(meta.mixer, { tracks: { "audio-1": { volume: -9 } } }, "the audio track's own mixer settings kept");
});
