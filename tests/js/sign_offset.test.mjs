// Signs moved and reshaped by hand (#1020): a dynamic, an articulation, a
// fingering, words, a slur, a tie or a hairpin dragged on the score is
// written as LilyPond writes it — `-\tweak Grob.extra-offset #'(x . y)`, a
// curve's `-\shape`, a hairpin's `shorten-pair` — in the note's `tweaks`,
// beside what was there already. Read back from the text, drawn by the
// engraver where it says, and gone when it is set back to nothing.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { editor_view, score_json, source_spans } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

/** The engraver's reading of a text with where each note is written, as the editor reads it. */
function parse(src) {
  const parsed = JSON.parse(score_json(src));
  parsed.spans = JSON.parse(source_spans(src));
  return parsed;
}
/** The model of a text: it must read, nothing lost. */
function open(src) {
  const result = M.fromParsed(parse(src), src);
  assert.ok(result.score, `reads: ${result.unsupported}`);
  assert.deepEqual(result.lost ?? [], [], `nothing lost of ${src}`);
  return result.score;
}
const text = (score) => M.toLilyPond(score).source;
/** The music of the first staff as written, without the header and the bar checks around it. */
const music = (score) => /\{\s*(?:\\time \d+\/\d+\s*)?(.*?)\s*(?:\\bar "\|\.")?\s*\}\s*$/s.exec(text(score).replace(/\s+/g, " "))?.[1] ?? text(score);
/** The engraver's signs for a score, and what it warns of. */
function drawn(score) {
  const source = text(score);
  const view = JSON.parse(editor_view(source, 900, 8, -1, -1));
  return { signs: view.signs, heads: view.items.map((it) => it.heads[0]?.box ?? it.box), warnings: JSON.parse(score_json(source)).warnings };
}
/** A sign's box measured from the first note's head: a sign pushed past the staff's ink moves the line on the page. */
function placed(score, on) {
  const { signs, heads } = drawn(score);
  const sign = signs.find((x) => x.on === on);
  assert.ok(sign, `the engraver draws ${on}`);
  return sign.box.map((n, k) => n - heads[0][k % 2]);
}
const near = (got, want, what) => assert.ok(Math.abs(got - want) < 1e-6, `${what}: ${got}, not ${want}`);

test("a sign is moved by a \\tweak of its own grob, read back and drawn there", () => {
  for (const [src, on, grob] of [
    ["{ c''4\\mf d'' e'' f'' }", "dynamic", "DynamicText"],
    ["{ c''4-> d'' e'' f'' }", "art:accent", "Script"],
    ["{ c''4\\fermata d'' e'' f'' }", "art:fermata", "Script"],
    ["{ c''4-2 d'' e'' f'' }", "finger:2", "Fingering"],
    ["{ c''4^\"dolce\" d'' e'' f'' }", "text:dolce", "TextScript"],
    ["{ c''4_\\markup \\italic \"dolce\" d'' e'' f'' }", "text:dolce", "TextScript"],
    ["{ c''4( d'' e'' f'') }", "slur", "Slur"],
    ["{ c''4\\( d'' e'' f''\\) }", "phrase", "PhrasingSlur"],
    ["{ c''2~ c'' }", "tie", "Tie"],
    ["{ c''4\\< d'' e'' f''\\! }", "hairpin", "Hairpin"],
  ]) {
    const score = open(src);
    assert.equal(M.signGrob(on), grob);
    assert.ok(M.hasSign(score.staves[0].events[0], on), `${on} is on the note`);
    const before = placed(score, on);
    M.setSignTweak(score, 0, 0, on, { offset: [1.5, -2] });
    assert.ok(text(score).includes(`-\\tweak ${grob}.extra-offset #'(1.5 . -2) `), `${on}: ${music(score)}`);
    const after = placed(score, on);
    // 8 pixels a staff space: right 1.5, down 2.
    after.forEach((n, k) => near(n - before[k], k % 2 ? 16 : 12, `${on}, side ${k}`));
    assert.deepEqual(drawn(score).warnings, [], `${on}: the engraver reads it without a warning`);
    // Read back from the text, it is the same score, and says the same offset.
    const again = open(text(score));
    assert.equal(text(again), text(score));
    assert.deepEqual(M.signTweak(again.staves[0].events[0], on).offset, [1.5, -2]);
    assert.ok(M.signIsSet(again.staves[0].events[0], on));
  }
});

test("an offset is kept to a tenth of a space, within reach, and zero takes the tweak away", () => {
  const score = open("{ c''4\\mf d'' e'' f'' }");
  const plain = text(score);
  M.setSignTweak(score, 0, 0, "dynamic", { offset: [0.26, -1.349999] });
  assert.deepEqual(M.signTweak(score.staves[0].events[0], "dynamic").offset, [0.3, -1.3]);
  assert.ok(text(score).includes("#'(0.3 . -1.3)"));
  // Moved again: one tweak, not two.
  M.setSignTweak(score, 0, 0, "dynamic", { offset: [2, 0] });
  assert.equal(text(score).match(/extra-offset/g).length, 1);
  assert.equal(score.staves[0].events[0].tweaks.length, 1);
  // A slip of the hand does not send it off the page.
  M.setSignTweak(score, 0, 0, "dynamic", { offset: [1e9, -Infinity] });
  assert.deepEqual(M.signTweak(score.staves[0].events[0], "dynamic").offset, [M.SIGN_REACH, -M.SIGN_REACH]);
  // Less than half a tenth is nothing: no tweak, no `tweaks` left on the note, the text as it was.
  M.setSignTweak(score, 0, 0, "dynamic", { offset: [0.04, -0.04] });
  assert.equal(score.staves[0].events[0].tweaks, undefined);
  assert.equal(text(score), plain);
  assert.equal(M.signIsSet(score.staves[0].events[0], "dynamic"), false);
});

test("what was written before the sign stays: a colour beside the offset, and after a reset", () => {
  const score = open("{ c''4-\\tweak color #red -> d''\\mf e'' f'' }");
  const ev = score.staves[0].events[0];
  assert.deepEqual(ev.tweaks, [{ on: "art:accent", lead: "-", text: "\\tweak color #red" }]);
  M.setSignTweak(score, 0, 0, "art:accent", { offset: [1, 0.5] });
  // Each with its own dash and its grob named: how the engraver reads two before one sign.
  assert.ok(text(score).includes("c''4-\\tweak Script.color #red -\\tweak Script.extra-offset #'(1 . 0.5) ->"), music(score));
  const again = open(text(score));
  assert.equal(text(again), text(score), "read back whole");
  assert.deepEqual(M.signTweak(again.staves[0].events[0], "art:accent").offset, [1, 0.5]);
  assert.equal(again.staves[0].events[0].tweaks.length, 1);
  // The accent is drawn a space to the right of where it was.
  const moved = placed(again, "art:accent");
  M.resetSign(again, 0, 0, "art:accent");
  assert.ok(text(again).includes("c''4-\\tweak Script.color #red ->"), music(again));
  assert.ok(!text(again).includes("extra-offset"));
  near(moved[0] - placed(again, "art:accent")[0], 8, "the accent's left");
  // Another note's sign is not touched by any of it.
  assert.equal(again.staves[0].events[1].tweaks, undefined);
});

test("a sign the engraver reads by name after a tweak is written by name: tenuto, marcato, portato", () => {
  for (const [src, name, written] of [["{ c''4-- d'' }", "tenuto", "\\tenuto"], ["{ c''4-^ d'' }", "marcato", "\\marcato"], ["{ c''4_- d'' }", "tenuto", "_\\tenuto"], ["{ c''4-_ d'' }", "portato", "\\portato"]]) {
    const score = open(src);
    const before = placed(score, `art:${name}`);
    const plain = text(score);
    M.setSignTweak(score, 0, 0, `art:${name}`, { offset: [2, 0] });
    assert.ok(text(score).includes(`-\\tweak Script.extra-offset #'(2 . 0) ${written}`), music(score));
    near(placed(score, `art:${name}`)[0] - before[0], 16, name);
    assert.deepEqual(drawn(score).warnings, []);
    assert.equal(text(open(text(score))), text(score));
    // Set back, it is written with its sign again.
    M.resetSign(score, 0, 0, `art:${name}`);
    assert.equal(text(score), plain);
  }
});

test("a curve is reshaped point by point, each piece of one a line break parts", () => {
  const score = open("{ c''4( d'' e'' f'') }");
  const handles = (sc) => {
    const { signs, heads } = drawn(sc);
    return signs.filter((x) => x.on === "slur").map((x) => x.handles.map(([x0, y0]) => [x0 - heads[0][0], y0 - heads[0][1]]));
  };
  const [before] = handles(score);
  M.setSignTweak(score, 0, 0, "slur", { shape: [[[0, 0], [0.5, 2], [0, 0], [0, -1]]] });
  assert.ok(text(score).includes("c''4-\\shape #'((0 . 0) (0.5 . 2) (0 . 0) (0 . -1)) ("), music(score));
  const [after] = handles(score);
  // y up in the text, down on the page.
  [[0, 0], [4, -16], [0, 0], [0, 8]].forEach(([dx, dy], k) => {
    near(after[k][0] - before[k][0], dx, `point ${k}, x`);
    near(after[k][1] - before[k][1], dy, `point ${k}, y`);
  });
  assert.deepEqual(drawn(score).warnings, []);
  const again = open(text(score));
  assert.equal(text(again), text(score));
  assert.deepEqual(M.signTweak(again.staves[0].events[0], "slur").shape, [[[0, 0], [0.5, 2], [0, 0], [0, -1]]]);
  // Moved whole as well: the offset first, the shape right before its curve.
  M.setSignTweak(again, 0, 0, "slur", { offset: [0, 1] });
  assert.ok(text(again).includes("-\\tweak Slur.extra-offset #'(0 . 1) -\\shape #'((0 . 0) (0.5 . 2) (0 . 0) (0 . -1)) ("), music(again));
  assert.deepEqual(drawn(again).warnings, []);
  const both = M.signTweak(open(text(again)).staves[0].events[0], "slur");
  assert.deepEqual([both.offset, both.shape.length], [[0, 1], 1]);
  // The second piece alone: the first is written as zeros, a list of lists.
  M.setSignTweak(again, 0, 0, "slur", { offset: [0, 0], shape: [null, [[0, 0], [0, 1], [0, 1], [0, 0]]] });
  assert.ok(text(again).includes("-\\shape #'(((0 . 0) (0 . 0) (0 . 0) (0 . 0)) ((0 . 0) (0 . 1) (0 . 1) (0 . 0))) ("), music(again));
  assert.equal(text(open(text(again))), text(again));
  // Every point back to nothing: the shape is gone.
  M.resetSign(again, 0, 0, "slur");
  assert.ok(!/shape|tweak/.test(text(again)), music(again));
});

test("a broken slur's second piece is reshaped where the engraver draws it", () => {
  const score = open("{ c''1( \\break d'') }");
  const pieces = (sc) => drawn(sc).signs.filter((x) => x.on === "slur");
  const before = pieces(score);
  assert.deepEqual(before.map((x) => x.piece), [0, 1]);
  M.setSignTweak(score, 0, 0, "slur", { shape: [null, [[0, 0], [0, 2], [0, 2], [0, 0]]] });
  const after = pieces(score);
  assert.deepEqual(drawn(score).warnings, []);
  // The second piece's middle points went up; the first piece's box is as tall as it was.
  assert.ok(after[1].box[3] - after[1].box[1] > before[1].box[3] - before[1].box[1] + 4, "the second piece arches higher");
  near(after[0].box[3] - after[0].box[1], before[0].box[3] - before[0].box[1], "the first piece's height");
});

test("a hairpin's ends are drawn in or out, beside its offset; other signs refuse what is not theirs", () => {
  const score = open("{ c''4\\< d'' e'' f''\\! }");
  const ends = (sc) => drawn(sc).signs.find((x) => x.on === "hairpin").handles.map((p) => p[0]);
  const before = ends(score);
  M.setSignTweak(score, 0, 0, "hairpin", { shorten: [1, -0.5] });
  assert.ok(text(score).includes("c''4-\\tweak Hairpin.shorten-pair #'(1 . -0.5) \\<"), music(score));
  const after = ends(score);
  near(after[0] - before[0], 8, "the left end, in by a space");
  near(after[1] - before[1], 4, "the right end, out by half a space");
  M.setSignTweak(score, 0, 0, "hairpin", { offset: [0, -1] });
  assert.ok(text(score).includes("-\\tweak Hairpin.extra-offset #'(0 . -1) -\\tweak Hairpin.shorten-pair #'(1 . -0.5) \\<"), music(score));
  assert.deepEqual(drawn(score).warnings, []);
  const again = open(text(score));
  assert.deepEqual(M.signTweak(again.staves[0].events[0], "hairpin"), { offset: [0, -1], shorten: [1, -0.5], shape: [] });
  M.resetSign(again, 0, 0, "hairpin");
  assert.ok(!text(again).includes("tweak"));
  // What a sign does not take is refused, and nothing is written.
  const plain = open("{ c''4\\mf( d'')\\< e''\\! f'' }");
  const was = text(plain);
  assert.throws(() => M.setSignTweak(plain, 0, 0, "dynamic", { shape: [[[0, 1], [0, 1], [0, 1], [0, 1]]] }), /reshaped/);
  assert.throws(() => M.setSignTweak(plain, 0, 0, "slur", { shorten: [1, 1] }), /hairpin/);
  // A sign the note has not, a name that is none.
  assert.throws(() => M.setSignTweak(plain, 0, 0, "art:accent", { offset: [1, 1] }), /no longer/);
  assert.throws(() => M.setSignTweak(plain, 0, 2, "dynamic", { offset: [1, 1] }), /no longer/);
  assert.throws(() => M.setSignTweak(plain, 0, 99, "dynamic", { offset: [1, 1] }), /no longer/);
  assert.throws(() => M.setSignTweak(plain, 0, 0, "arpeggio", { offset: [1, 1] }), /no longer/);
  assert.equal(M.signGrob("arpeggio"), null);
  assert.equal(text(plain), was);
});

test("which signs a note has to move", () => {
  const score = open("{ <c' e'-3>4-1\\2 d'^\"Am\" r4\\p e'~ | e'1 }");
  const [chord, d, rest, tied] = score.staves[0].events;
  // A chord's loose fingering is moved; the one on a head, and a string's number, are not.
  assert.equal(M.hasSign(chord, "finger:1"), true);
  assert.equal(M.hasSign(chord, "finger:3"), false);
  assert.equal(M.hasSign(chord, "finger:2"), false);
  assert.equal(M.hasSign(d, `text:${d.chord ?? d.texts[0]?.text}`), true);
  assert.equal(M.hasSign(d, "text:Other"), false);
  assert.equal(M.hasSign(rest, "dynamic"), true);
  assert.equal(M.hasSign(rest, "tie"), false);
  assert.equal(M.hasSign(tied, "tie"), true);
  assert.equal(M.hasSign(tied, "slur"), false);
  assert.equal(M.hasSign(null, "dynamic"), false);
});

test("a moved sign goes with its note: transposed, copied and pasted, and leaves with its sign", () => {
  const score = open("{ c''4\\mf-> d'' e'' f'' | r1 }");
  M.setSignTweak(score, 0, 0, "dynamic", { offset: [1, -1] });
  M.setSignTweak(score, 0, 0, "art:accent", { offset: [0, 2] });
  // Transposed a tone up: the note changes, its signs stay where they were put.
  M.transpose(score, { steps: 1, semitones: 2 });
  const up = score.staves[0].events[0];
  assert.equal(M.spellPitch(up.pitches[0].d, up.pitches[0].alter), "d''");
  assert.deepEqual([M.signTweak(up, "dynamic").offset, M.signTweak(up, "art:accent").offset], [[1, -1], [0, 2]]);
  // Copied and pasted into the next bar: the copy has them too, the engraver draws both.
  M.paste(score, 0, M.barStart(score, 1), M.copy(score, 0, 0, 3));
  const copy = score.staves[0].events[4];
  assert.deepEqual([M.signTweak(copy, "dynamic").offset, M.signTweak(copy, "art:accent").offset], [[1, -1], [0, 2]]);
  assert.equal(text(score).match(/DynamicText\.extra-offset #'\(1 \. -1\)/g).length, 2);
  assert.deepEqual(drawn(score).warnings, []);
  // The accent taken off: its tweak goes with it, the dynamic's stays.
  M.toggleArticulation(score, 0, 4, "accent");
  assert.deepEqual(copy.tweaks.map((x) => x.on), ["dynamic"]);
  assert.ok(!text(score).split("|")[1].includes("Script"), music(score));
});
