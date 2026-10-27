// The toolbox's sections (#419): open at first are those written with all
// the time, the rest folded; a fold by hand is kept; a selection opens the
// section its tools are in.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { sectionOpen, neededSection, OPEN_AT_FIRST } from "../../public/eui-score/studio-toolbox.js";

test("with nothing kept, Mode, Duration, Notes and Pitch are open, the rest folded", () => {
  assert.deepEqual([...OPEN_AT_FIRST], ["mode", "duration", "notes", "pitch"]);
  for (const name of OPEN_AT_FIRST) assert.equal(sectionOpen(name, {}), true, name);
  for (const name of ["articulations", "ornaments", "bars-and-staves", "from-bar"]) assert.equal(sectionOpen(name, {}), false, name);
});

test("a section folded or opened by hand stays so", () => {
  const kept = { pitch: true, ornaments: false };
  assert.equal(sectionOpen("pitch", kept), false);
  assert.equal(sectionOpen("ornaments", kept), true);
  // The others as at first.
  assert.equal(sectionOpen("notes", kept), true);
  assert.equal(sectionOpen("dynamics", kept), false);
});

test("bars selected need Bars & staves; a line of chord names, Words; a note, nothing", () => {
  const score = { staves: [{ events: [] }, { chords: true, events: [] }] };
  assert.equal(neededSection(score, { staff: 0, t0: 0, t1: 0, bars: [0, 1] }), "bars-and-staves");
  assert.equal(neededSection(score, { staff: 1, t0: 0, t1: 0 }), "words");
  assert.equal(neededSection(score, { staff: 0, t0: 0, t1: 0 }), null);
  assert.equal(neededSection(score, null), null);
  assert.equal(neededSection(null, { staff: 0 }), null);
});
