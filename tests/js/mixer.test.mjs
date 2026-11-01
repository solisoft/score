// The mixer (public/eui-score/mixer.js): its settings as the score keeps
// them, mute and solo, and the audio graph it builds on SpessaSynth's
// outputs — against a fake AudioContext that records what is connected
// and what each parameter is set to.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as X from "../../public/eui-score/mixer.js";

test("an audio track's settings (#390) sit beside the staves', by name: its solo silences the staves", () => {
  let mix = X.patched({}, "audio-1", { volume: -6, solo: true });
  assert.deepEqual(mix, { tracks: { "audio-1": { volume: -6, solo: true } } });
  assert.deepEqual(X.lanesWith(mix, "solo"), ["audio-1"]);
  assert.ok(X.audible(mix, "audio-1"));
  assert.ok(!X.audible(mix, 0), "a staff, while an audio track is soloed");
  mix = X.patched(mix, 0, { mute: true });
  assert.deepEqual(X.lanesWith(mix, "mute"), [0]);
  assert.equal(X.trackOf(mix, "audio-1").volume, -6);
  assert.equal(X.patched(X.patched(mix, "audio-1", { volume: 0, solo: false }), 0, { mute: false }), null);
});

// ---- A fake AudioContext ----------------------------------------------------------------

class Param {
  constructor(value = 0) {
    this.value = value;
  }
}

class Node {
  constructor(kind) {
    this.kind = kind;
    this.out = [];
  }
  connect(node, output = 0) {
    this.out.push({ node, output });
    return node;
  }
}

class FakeContext {
  constructor(sampleRate = 8000) {
    this.sampleRate = sampleRate;
    this.destination = new Node("destination");
    this.made = [];
  }
  node(kind, params) {
    const n = Object.assign(new Node(kind), Object.fromEntries(params.map(([k, v]) => [k, new Param(v)])));
    this.made.push(n);
    return n;
  }
  createGain() {
    return this.node("gain", [["gain", 1]]);
  }
  createBiquadFilter() {
    return Object.assign(this.node("biquad", [["frequency", 350], ["gain", 0], ["Q", 1]]), { type: "lowpass" });
  }
  createDynamicsCompressor() {
    return this.node("compressor", [["threshold", -24], ["ratio", 12]]);
  }
  createStereoPanner() {
    return this.node("panner", [["pan", 0]]);
  }
  createConvolver() {
    return Object.assign(this.node("convolver", []), { buffer: null });
  }
  createAnalyser() {
    const n = Object.assign(this.node("analyser", []), { fftSize: 2048 });
    n.getFloatTimeDomainData = (out) => out.fill(0).fill(-0.5, 0, 1);
    return n;
  }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, getChannelData: (c) => data[c] };
  }
}

/** SpessaSynth's worklet as the mixer sees it: 17 outputs, a channel's on output channel + 1. */
function fakeSynth() {
  const worklet = new Node("worklet");
  return {
    worklet,
    connectChannel(node, channel) {
      worklet.connect(node, (channel % 16) + 1);
    },
  };
}

/** Whether audio flows from `from` to `to` through the recorded connections. */
function reaches(from, to, seen = new Set()) {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return from.out.some(({ node }) => reaches(node, to, seen));
}

// ---- The settings ------------------------------------------------------------------------

test("a track's settings: the defaults filled in, each field in range", () => {
  const s = X.settings({ volume: 40, pan: -3, eq: { on: true, low: 99 }, reverb: { on: true, room: "nowhere", mix: 2 } });
  assert.equal(s.volume, X.VOLUME_MAX);
  assert.equal(s.pan, -1);
  assert.deepEqual(s.eq, { on: true, low: 12, mid: 0, high: 0 });
  assert.deepEqual(s.reverb, { on: true, room: "hall", mix: 1 });
  assert.deepEqual(X.settings(undefined).comp, { on: false, threshold: -24, ratio: 4 });
  assert.equal(X.settings({ volume: "loud" }).volume, X.VOLUME_MIN, "what does not read is the bottom");
});

test("the score keeps only what differs from the defaults, and nothing at all when all is default", () => {
  const score = { staves: [] };
  X.setMix(score, 1, { volume: -6, pan: 0.5 });
  X.setMix(score, "master", { reverb: { on: true, room: "cathedral" } });
  assert.deepEqual(score.meta.mixer, { master: { reverb: { on: true, room: "cathedral" } }, tracks: { 1: { volume: -6, pan: 0.5 } } });
  X.setMix(score, 1, { eq: { on: true, high: 3 } });
  assert.deepEqual(score.meta.mixer.tracks[1], { volume: -6, pan: 0.5, eq: { on: true, high: 3 } }, "effects merge field by field");
  X.setMix(score, 1, { volume: 0, pan: 0, eq: { on: false, high: 0 } });
  X.setMix(score, "master", { reverb: { on: false, room: "hall" } });
  assert.equal(score.meta.mixer, undefined, "back to the defaults: no mixer kept");
});

test("mute and solo: a muted track is silent, a solo silences the others", () => {
  let mix = X.patched({}, 0, { mute: true });
  assert.deepEqual(X.lanesWith(mix, "mute"), [0]);
  assert.equal(X.audible(mix, 0), false);
  assert.equal(X.audible(mix, 1), true);
  mix = X.patched(mix, 2, { solo: true });
  assert.equal(X.audible(mix, 1), false, "not soloed while another is");
  assert.equal(X.audible(mix, 2), true);
  mix = X.patched(mix, 0, { solo: true });
  assert.equal(X.audible(mix, 0), false, "muted wins over soloed");
});

test("each channel's settings: a staff's on its channel, silence for the muted, the others as they are", () => {
  const mix = { tracks: { 0: { volume: -20, pan: -1 }, 2: { mute: true } } };
  const channels = [{ lane: 0, channel: 0 }, { lane: 2, channel: 1 }, { lane: 3, channel: 9 }];
  const out = X.channelSettings(mix, channels);
  assert.equal(out.length, 16);
  assert.equal(out[0].pan, -1);
  assert.ok(Math.abs(out[0].gain - 0.1) < 1e-9, "-20 dB is a tenth");
  assert.equal(out[1].gain, 0);
  assert.equal(out[9].gain, 1);
  assert.equal(out[14].gain, 1, "the metronome's channel as it is");
  assert.equal(X.dbToGain(X.VOLUME_MIN), 0);
  assert.equal(X.dbToGain(0), 1);
});

// ---- The rooms ---------------------------------------------------------------------------

test("each room's impulse: as long as the room, silent first, dying away, the same each time", () => {
  for (const [name, room] of Object.entries(X.ROOMS)) {
    const [left, right] = X.impulseSamples(name, 8000);
    assert.equal(left.length, Math.round(room.seconds * 8000));
    assert.equal(left[0], 0, "a short silence before the reflections");
    const energy = (a, b) => left.slice(a, b).reduce((s, x) => s + x * x, 0);
    const tenth = Math.floor(left.length / 10);
    assert.ok(energy(tenth, 2 * tenth) > 100 * energy(left.length - tenth, left.length), `${name} dies away`);
    assert.notDeepEqual(left.slice(tenth, tenth + 100), right.slice(tenth, tenth + 100), "the two sides differ: a wide room");
    assert.deepEqual(X.impulseSamples(name, 8000)[0].slice(0, 500), left.slice(0, 500));
  }
  assert.ok(X.ROOMS.cathedral.seconds > X.ROOMS.room.seconds);
});

// ---- The graph ---------------------------------------------------------------------------

test("the graph: every channel through its strip to the master, the effects bus too, through the meter", () => {
  const ctx = new FakeContext();
  const synth = fakeSynth();
  const graph = X.mixerGraph(ctx, synth);
  assert.equal(graph.strips.length, 16);
  const outputs = synth.worklet.out.map((c) => c.output).sort((a, b) => a - b);
  assert.deepEqual(outputs, Array.from({ length: 17 }, (_, k) => k), "the 17 outputs each connected once");
  for (const s of graph.strips) assert.ok(reaches(s.input, ctx.destination));
  assert.ok(reaches(synth.worklet, graph.meter));
  assert.ok(reaches(graph.master.output, ctx.destination));
  assert.ok(reaches(graph.meter, ctx.destination));
  assert.equal(graph.level().peak, 0.5);
});

test("applied: volume, pan and mute per channel; effects bypassed until turned on", () => {
  const ctx = new FakeContext();
  const graph = X.mixerGraph(ctx, fakeSynth());
  const channels = [{ lane: 0, channel: 0 }, { lane: 1, channel: 1 }];
  graph.apply({ tracks: { 0: { volume: -6, pan: 0.5 }, 1: { mute: true } } }, channels);
  const [a, b] = graph.strips;
  assert.ok(Math.abs(a.nodes.volume.gain.value - 0.501) < 0.001);
  assert.equal(a.nodes.panner.pan.value, 0.5);
  assert.equal(b.nodes.volume.gain.value, 0);
  // Bypassed: a flat EQ, the compressor's path shut, no reverb at all.
  assert.deepEqual([a.nodes.low.gain.value, a.nodes.mid.gain.value, a.nodes.high.gain.value], [0, 0, 0]);
  assert.deepEqual([a.nodes.compWet.gain.value, a.nodes.compDry.gain.value], [0, 1]);
  assert.equal(a.nodes.send.gain.value, 0);
  assert.equal(a.convolver, null, "no convolver made before the reverb is on");
  graph.apply({ tracks: { 0: { eq: { on: true, low: 4, mid: -3, high: 2 }, comp: { on: true, threshold: -30, ratio: 6 }, reverb: { on: true, room: "room", mix: 0.4 } } } }, channels);
  assert.deepEqual([a.nodes.low.gain.value, a.nodes.mid.gain.value, a.nodes.high.gain.value], [4, -3, 2]);
  assert.deepEqual([a.nodes.compWet.gain.value, a.nodes.compDry.gain.value], [1, 0]);
  assert.equal(a.nodes.comp.threshold.value, -30);
  assert.equal(a.nodes.comp.ratio.value, 6);
  assert.equal(a.nodes.send.gain.value, 0.4);
  assert.ok(a.convolver, "the convolver made");
  assert.equal(a.convolver.buffer.length, Math.round(X.ROOMS.room.seconds * ctx.sampleRate));
  assert.ok(reaches(a.nodes.send, ctx.destination));
  // Bypassed again: the EQ flat, the reverb's send shut — the convolver stays, silent.
  const convolver = a.convolver;
  graph.apply({ tracks: { 0: { eq: { on: false, low: 4 }, reverb: { on: false, room: "room" } } } }, channels);
  assert.equal(a.nodes.low.gain.value, 0);
  assert.equal(a.nodes.send.gain.value, 0);
  assert.equal(a.convolver, convolver);
});

test("the master: its volume, and its own reverb in another room", () => {
  const ctx = new FakeContext();
  const graph = X.mixerGraph(ctx, fakeSynth());
  graph.apply({ master: { volume: -60, reverb: { on: true, room: "cathedral", mix: 0.2 } } }, []);
  assert.equal(graph.master.nodes.volume.gain.value, 0, "the bottom of the fader is silence");
  assert.equal(graph.master.nodes.panner, null, "the master has no pan");
  assert.equal(graph.master.convolver.buffer.length, Math.round(X.ROOMS.cathedral.seconds * ctx.sampleRate));
  assert.equal(X.impulse(ctx, "cathedral"), graph.master.convolver.buffer, "one buffer per room and context");
});

test("a room named after an Object property is no room: the default reverb, not the Object function (#537)", () => {
  for (const room of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.equal(X.settings({ reverb: { on: true, room } }).reverb.room, "hall", room);
  }
  const samples = X.impulseSamples("constructor", 8000);
  assert.ok(samples.length > 0 && samples.every((channel) => channel.every(Number.isFinite)), "a hall's impulse");
});
