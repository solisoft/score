// What the page says of a photo being read (#435): the time it has taken, and
// whether the AI is still reading the photo or writing the music.
import { test } from "node:test";
import assert from "node:assert/strict";
import { took, readingSays } from "../../public/js/score-photo.js";

test("the time a reading has taken, as people read it", () => {
  assert.equal(took(0), "0 s");
  assert.equal(took(45.4), "45 s");
  assert.equal(took(60), "1 min 00 s");
  assert.equal(took(200), "3 min 20 s");
  assert.equal(took(-3), "0 s");
  assert.equal(took(undefined), "0 s");
});

test("waiting, reading the photo, writing the music", () => {
  assert.equal(readingSays({ phase: "waiting", seconds: 4 }), "Waiting for the AI… 4 s");
  assert.match(readingSays({ phase: "thinking", seconds: 200 }), /^The AI is reading the photo… 3 min 20 s\. It thinks before it writes/);
  assert.equal(readingSays({ phase: "writing", seconds: 610 }), "The AI is writing the music… 10 min 10 s");
  assert.equal(readingSays(null), "Waiting for the AI… 0 s");
});
