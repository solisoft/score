// The synthesizer's settings from a meta line (#537): a preset named after an
// Object property ("constructor", "toString") is no preset, and the panel
// that reads it does not throw.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as Sy from "../../public/eui-score/synth.js";

test("a preset named after an Object property falls back to the default, and settings answer", () => {
  const plain = Sy.settings({});
  for (const preset of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    const s = Sy.settings({ preset });
    assert.equal(s.preset, plain.preset, preset);
    assert.equal(s.wave, plain.wave, preset);
  }
});
