// Score following (public/eui-score/follow.js): the place in the score moved
// on by the notes heard — played right, with wrong notes, with notes
// missed, from elsewhere — and the notes to expect read from a score with
// a repeat.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as Fo from "../../public/eui-score/follow.js";

// Four bars of four notes: C D E F | G A B C | C B A G | F E D C (C4 = 60).
const KEYS = [60, 62, 64, 65, 67, 69, 71, 72, 72, 71, 69, 67, 65, 64, 62, 60];
const tune = () => KEYS.map((key, k) => ({ keys: [key], bar: Math.floor(k / 4) }));

function play(follower, keys) {
  return keys.map((key) => follower.hear(key));
}

test("played right, each note moves the place on by one", () => {
  const f = Fo.createFollower(tune());
  const heard = play(f, KEYS);
  assert.ok(heard.every((h) => h.kind === "match"));
  assert.deepEqual(heard.map((h) => h.index), KEYS.map((_, k) => k));
  assert.equal(f.at, KEYS.length);
  assert.equal(f.hear(60).kind, "end");
});

test("a wrong note leaves the place where it was; the right one then moves on", () => {
  const f = Fo.createFollower(tune());
  play(f, [60, 62]);
  const wrong = f.hear(61);
  assert.equal(wrong.kind, "wrong");
  assert.equal(wrong.at, 2);
  assert.deepEqual(f.hear(64), { kind: "match", index: 2, at: 3 });
});

test("notes missed: the place jumps to the note played, within the next bar", () => {
  const f = Fo.createFollower(tune());
  play(f, [60, 62]);
  // E and F missed, G played.
  assert.deepEqual(f.hear(67), { kind: "skip", index: 4, at: 5 });
  // Not further than the bar after: from bar 1, a note only bar 3 has is out of reach.
  const far = [...tune().slice(0, 8), { keys: [62], bar: 2 }, { keys: [50], bar: 3 }];
  const g = Fo.createFollower(far, { octaves: false });
  assert.equal(g.hear(60).kind, "match");
  assert.equal(g.hear(50).kind, "wrong");
  assert.equal(g.at, 1);
});

test("an octave off counts, unless asked otherwise", () => {
  assert.equal(Fo.createFollower(tune()).hear(48).kind, "match");
  assert.equal(Fo.createFollower(tune(), { octaves: false }).hear(48).kind, "wrong");
  assert.ok(Fo.answers({ keys: [60, 64, 67] }, 64), "a chord: any of its notes");
  assert.ok(!Fo.answers({ keys: [60, 64, 67] }, 65));
});

test("the player goes back a bar: after two notes that do not follow, the place finds them", () => {
  const f = Fo.createFollower(tune());
  play(f, [60, 62, 64, 65, 67, 69, 71, 72, 72, 71]);
  assert.equal(f.at, 10);
  // Back to the start of bar 2: G A …
  const first = f.hear(67);
  assert.equal(first.kind, "skip", "G is in reach ahead (bar 3's last note)");
  const heard = play(f, [69, 71]);
  assert.equal(heard.at(-1).kind, "resync");
  assert.equal(f.at, 7, "after bar 2's B");
  assert.equal(f.hear(72).index, 7);
});

test("lost far away: three notes heard together find the place anywhere", () => {
  const f = Fo.createFollower(tune());
  play(f, [60, 62, 64]);
  // The player starts the last bar: F E D C.
  const heard = play(f, [65, 64, 62]);
  assert.equal(heard.at(-1).kind, "resync");
  assert.equal(heard.at(-1).index, 14);
  assert.equal(f.hear(60).kind, "match");
});

test("from the top again after the end", () => {
  const f = Fo.createFollower(tune());
  play(f, KEYS);
  const again = play(f, [60, 62, 64]);
  assert.equal(again.at(-1).kind, "resync");
  assert.equal(f.at, 3);
});

test("noise among the notes (a stray low note every other one) does not lose the place", () => {
  const f = Fo.createFollower(tune());
  for (const key of KEYS.slice(0, 8)) {
    f.hear(key);
    f.hear(30);
  }
  assert.equal(f.at, 8);
});

test("jump sets the place", () => {
  const f = Fo.createFollower(tune());
  f.jump(8);
  assert.equal(f.hear(72).index, 8);
  f.jump(99);
  assert.equal(f.at, KEYS.length);
});

test("the notes to expect: one staff, chords as one, a repeat played out", () => {
  // Two bars of 4 ticks; the second played twice.
  const notes = [
    { lane: 0, t0: 0, key: 60 },
    { lane: 0, t0: 2, key: 64 },
    { lane: 0, t0: 2, key: 67 },
    { lane: 1, t0: 0, key: 48 },
    { lane: 0, t0: 4, key: 65 },
  ];
  const passes = [
    { bar: 0, start: 0, end: 2 },
    { bar: 1, start: 2, end: 4 },
    { bar: 1, start: 4, end: 6 },
  ];
  const expected = Fo.expectedNotes(notes, 0, passes, {
    barStart: (b) => b * 4,
    barAt: (t) => Math.floor(t / 4),
    secOf: (pass, into) => pass.start + (into / 4) * (pass.end - pass.start),
  });
  assert.deepEqual(expected.map((e) => [e.keys, e.bar, e.sec]), [
    [[60], 0, 0],
    [[64, 67], 0, 1],
    [[65], 1, 2],
    [[65], 1, 4],
  ]);
});
