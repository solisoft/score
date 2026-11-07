// What outlives a page in player.js and mixer.js, let go of when the editor
// is gone (#680): instant navigation keeps the tab, and with it the
// modules' MIDI keyboard, the router and the voicer of Play's synthesizer.
// The editor that leaves lets go of its own, never of the next editor's.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../../public/eui-score/player.js";
import * as X from "../../public/eui-score/mixer.js";

// A MIDI keyboard given to the page instead of the browser's: its handler is set by `listen`.
// One for the file: player.js asks for MIDI access once a tab, and keeps it.
const keyboard = { id: "kb", name: "Fake keys", onmidimessage: null };

async function fakeKeyboard() {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { requestMIDIAccess: async () => ({ inputs: new Map([["kb", keyboard]]), outputs: new Map() }) },
  });
  await P.midiInputs();
  return keyboard;
}

test("the keyboard let go of by the editor that had it: its keys reach it no more", async () => {
  const keyboard = await fakeKeyboard();
  const left = [];
  const playKey = (key) => left.push(key);
  const recordKey = (key) => left.push(-key);
  P.listen("kb", playKey);
  keyboard.onmidimessage({ data: [0x90, 60, 90], timeStamp: 1 });
  assert.deepEqual(left, [60]);
  P.unlisten(playKey, recordKey);
  assert.equal(keyboard.onmidimessage, null, "the port no longer read");
  keyboard.onmidimessage?.({ data: [0x90, 62, 90], timeStamp: 2 });
  assert.deepEqual(left, [60], "no key written into the score left");
});

test("an editor that is gone does not take the keyboard from the one opened after it", async () => {
  const keyboard = await fakeKeyboard();
  const first = [];
  const second = [];
  const firstKey = (key) => first.push(key);
  const secondKey = (key) => second.push(key);
  P.listen("kb", firstKey);
  // The next editor chooses the keyboard before the first one has let go.
  P.listen("kb", secondKey);
  P.unlisten(firstKey);
  keyboard.onmidimessage({ data: [0x90, 64, 90], timeStamp: 3 });
  assert.deepEqual(first, []);
  assert.deepEqual(second, [64], "still the second editor's");
  P.unlisten(secondKey);
  assert.equal(keyboard.onmidimessage, null);
  // Nothing listened to: letting go again changes nothing.
  P.unlisten(secondKey);
  assert.equal(keyboard.onmidimessage, null);
});

test("the router and the voicer let go of only while they are still the editor's", () => {
  const first = () => {};
  const second = () => {};
  const releaseFirst = P.setRouter(first);
  const releaseSecond = P.setRouter(second);
  // The first editor leaves after the second came: the second's router stays.
  releaseFirst();
  const heard = [];
  const releaseVoicer = P.setVoicer((channel, key, on) => (heard.push([channel, key, on]), true));
  assert.equal(P.preview([60], 0, { channel: 2 }), true, "the voicer sounds a synthesizer staff's key");
  assert.deepEqual(heard[0], [2, 60, true]);
  releaseVoicer();
  heard.length = 0;
  // No voicer, no sounds loaded: the note is not heard, and nothing reaches the old voicer.
  assert.equal(P.preview([60], 0, { channel: 2 }), false);
  assert.deepEqual(heard, []);
  releaseSecond();
  // Let go twice, or after another took its place: nothing changes.
  const third = () => {};
  const releaseThird = P.setRouter(third);
  releaseSecond();
  releaseThird();
});

// ---- The mixer's graph -------------------------------------------------------------------

class Node {
  constructor() {
    this.out = [];
  }
  connect(node) {
    this.out.push(node);
    return node;
  }
  disconnect() {
    this.out = [];
  }
}

class FakeContext {
  constructor() {
    this.destination = new Node();
  }
  param(value) {
    return { value };
  }
  createGain() {
    return Object.assign(new Node(), { gain: this.param(1) });
  }
  createBiquadFilter() {
    return Object.assign(new Node(), { frequency: this.param(350), gain: this.param(0), Q: this.param(1) });
  }
  createDynamicsCompressor() {
    return Object.assign(new Node(), { threshold: this.param(-24), ratio: this.param(12) });
  }
  createStereoPanner() {
    return Object.assign(new Node(), { pan: this.param(0) });
  }
  createAnalyser() {
    return Object.assign(new Node(), { fftSize: 2048, getFloatTimeDomainData: (out) => out.fill(0) });
  }
}

function reaches(from, to, seen = new Set()) {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return from.out.some((node) => reaches(node, to, seen));
}

test("a mixer's graph disconnected: nothing of it reaches the way out any more", () => {
  const ctx = new FakeContext();
  const worklet = new Node();
  const synth = { worklet, connectChannel: (node) => worklet.connect(node) };
  const graph = X.mixerGraph(ctx, synth);
  assert.ok(reaches(graph.meter, ctx.destination));
  assert.ok(reaches(graph.strips[3].output, ctx.destination));
  graph.disconnect();
  assert.ok(!reaches(graph.meter, ctx.destination), "the meter off the way out");
  assert.ok(!reaches(graph.master.output, ctx.destination));
  for (const s of graph.strips) assert.ok(!reaches(s.input, ctx.destination), "every strip off it");
});
