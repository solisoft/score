// The subtractive synthesizer (public/eui-score/synth.js, #391): its
// settings as the score keeps them, its knobs as sound, its voices on a
// fake AudioContext, and its notes taken from the heard MIDI — on Play
// ahead of the music, on Save the sound all at once, into the mixer's strips.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import init, { score_json } from "../../public/eui-score/eui_score_web.js";
import * as M from "../../public/eui-score/score-model.js";
import * as F from "../../public/eui-score/feel.js";
import * as X from "../../public/eui-score/mixer.js";
import * as Sy from "../../public/eui-score/synth.js";
import { synthPatch, knobText, synthHtml } from "../../public/eui-score/instruments-ui.js";

await init({ module_or_path: readFileSync(new URL("../../public/eui-score/eui_score_web_bg.wasm", import.meta.url)) });

// ---- A fake AudioContext, its parameters keeping what they are told ----------------------

class Param {
  constructor(value = 0) {
    this.value = value;
    this.calls = [];
  }
  setValueAtTime(v, t) {
    this.calls.push(["set", v, t]);
  }
  linearRampToValueAtTime(v, t) {
    this.calls.push(["ramp", v, t]);
  }
  setTargetAtTime(v, t, k) {
    this.calls.push(["target", v, t, k]);
  }
  cancelScheduledValues(t) {
    this.calls.push(["cancel", t]);
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
  constructor() {
    this.currentTime = 10;
    this.sampleRate = 8000;
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
  createOscillator() {
    const n = Object.assign(this.node("oscillator", [["frequency", 440], ["detune", 0]]), { type: "sine" });
    n.start = (t) => (n.started = t);
    n.stop = (t) => (n.stopped = t);
    return n;
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
    return Object.assign(this.node("analyser", []), { fftSize: 2048, getFloatTimeDomainData: (out) => out.fill(0) });
  }
  createBuffer(channels, length) {
    return { length, getChannelData: () => new Float32Array(length) };
  }
}

const oscillators = (ctx) => ctx.made.filter((n) => n.kind === "oscillator");

// ---- The settings, as the score keeps them ---------------------------------------------

test("a preset in full; only the preset and what differs from it kept; every knob held in range", () => {
  const pad = Sy.settings({ preset: "pad" });
  assert.deepEqual(pad.osc1, Sy.PRESETS.pad.osc1);
  assert.deepEqual(Sy.compact(pad), { preset: "pad" });
  const odd = Sy.settings({ preset: "bass", filter: { cutoff: 7, resonance: -1 }, osc1: { wave: "noise", detune: 500, octave: 1.6 }, amp: { attack: 0 } });
  assert.equal(odd.filter.cutoff, 1);
  assert.equal(odd.filter.resonance, 0);
  assert.equal(odd.osc1.wave, "sawtooth", "an unknown wave: the preset's");
  assert.equal(odd.osc1.detune, 100);
  assert.equal(odd.osc1.octave, 2);
  assert.equal(odd.amp.attack, 0.001);
  assert.deepEqual(Sy.compact(odd), { preset: "bass", osc1: { detune: 100, octave: 2 }, filter: { cutoff: 1, resonance: 0 }, amp: { attack: 0.001 } });
  // An unknown preset: the default one.
  assert.equal(Sy.settings({ preset: "organ" }).preset, Sy.DEFAULT_PRESET);
  assert.equal(Sy.settings(null).preset, Sy.DEFAULT_PRESET);
});

test("a staff's synthesizer kept on the meta line, read back from the text, taken away", () => {
  const { score } = M.fromParsed(JSON.parse(score_json("<< \\new Staff { c''1 } \\new Staff { \\clef bass c1 } >>")));
  score.meta = { mixer: { tracks: { 1: { volume: -6 } } } };
  assert.equal(Sy.synthOf(score, 1), null, "none: the SoundFont plays it");
  assert.deepEqual(Sy.setSynth(score, 1, { preset: "lead" }), { preset: "lead" });
  assert.deepEqual(Sy.setSynth(score, 1, synthPatch("filter.cutoff", "0.8")), { preset: "lead", filter: { cutoff: 0.8 } });
  assert.deepEqual(Sy.setSynth(score, 1, synthPatch("osc2.wave", "sine")), { preset: "lead", osc2: { wave: "sine" }, filter: { cutoff: 0.8 } });
  // A new preset starts again from it.
  Sy.setSynth(score, 0, { preset: "pluck" });
  const text = M.toLilyPond(score).source;
  const meta = M.readMeta(text);
  assert.deepEqual(meta.synth, { 0: { preset: "pluck" }, 1: { preset: "lead", osc2: { wave: "sine" }, filter: { cutoff: 0.8 } } });
  assert.deepEqual(meta.mixer, { tracks: { 1: { volume: -6 } } }, "the other keys kept");
  // Read back, the same synthesizer.
  const again = { ...score, meta };
  assert.deepEqual(Sy.synthOf(again, 1), Sy.settings(meta.synth[1]));
  assert.deepEqual(Sy.synthLanes(again), [0, 1]);
  // Through writeMeta too, as the text editor keeps it.
  assert.deepEqual(M.readMeta(M.writeMeta("{ c'1 }\n", { synth: meta.synth })).synth, meta.synth);
  // Taken away: the SoundFont again; the key gone with the last.
  Sy.setSynth(score, 1, null);
  Sy.setSynth(score, 0, null);
  assert.equal(score.meta.synth, undefined);
  assert.equal(M.readMeta(M.toLilyPond(score).source).synth, undefined);
  // A staff on the synthesizer keeps its own channel.
  Sy.setSynth(score, 0, { preset: "pad" });
  const channels = M.channels(score);
  assert.notEqual(channels[0].channel, channels[1].channel);
});

test("the knobs as sound: cutoff by octaves, resonance as Q, the envelope's reach, velocity's gain", () => {
  assert.equal(Sy.cutoffHz(0), 20);
  assert.ok(Math.abs(Sy.cutoffHz(1) - 20000) < 1e-6);
  assert.ok(Math.abs(Sy.cutoffHz(0.5) - 20 * Math.sqrt(1000)) < 1e-9);
  assert.equal(Sy.resonanceQ(0), 0.7);
  assert.equal(Sy.resonanceQ(1), 20);
  assert.equal(Sy.keyHz(69), 440);
  assert.equal(Sy.keyHz(81), 880);
  const lead = Sy.settings({ preset: "lead", filter: { cutoff: 0.5, env: 0.5 } });
  const p = Sy.voiceParams(lead, 60, 127);
  assert.ok(Math.abs(p.cutoffPeak - p.cutoff * 2 ** 3) < 1e-6, "half the amount: three octaves up");
  assert.equal(p.gain, 0.25);
  assert.ok(Sy.voiceParams(lead, 60, 64).gain < p.gain, "softer struck, quieter");
  // A negative amount closes the filter instead; never under 20 Hz.
  const closing = Sy.voiceParams(Sy.settings({ preset: "lead", filter: { cutoff: 0.1, env: -1 } }), 60);
  assert.equal(closing.cutoffPeak, 20);
  // The octave goes in the detune, in cents.
  const bass = Sy.voiceParams(Sy.settings({ preset: "bass" }), 40);
  assert.equal(bass.osc[1].cents, -1200);
  assert.equal(bass.osc[0].hz, Sy.keyHz(40));
  // The knobs' words.
  assert.equal(knobText("filter.cutoff", 0), "20 Hz");
  assert.equal(knobText("amp.attack", 0.25), "250 ms");
  assert.equal(knobText("amp.release", 1.5), "1.50 s");
  assert.equal(knobText("osc1.detune", 7), "+7 ct");
  assert.equal(knobText("osc2.octave", -1), "-1 oct");
  assert.equal(knobText("filter.env", -0.4), "-40 %");
  assert.deepEqual(synthPatch("osc1.wave", "square"), { osc1: { wave: "square" } });
  assert.deepEqual(synthPatch("preset", "bass"), { preset: "bass" });
});

test("the knobs' panel shows the staff's settings, and every preset", () => {
  const html = synthHtml(3, Sy.settings({ preset: "bass", filter: { cutoff: 0.2 } }));
  for (const preset of Object.keys(Sy.PRESETS)) assert.match(html, new RegExp(`<option value="${preset}"`));
  assert.match(html, /<option value="bass" selected>Bass<\/option>/);
  assert.match(html, /data-inst="filter.cutoff" data-inst-lane="3"[^>]*value="0.2"/);
  assert.equal((html.match(/data-inst="osc\d.wave"/g) ?? []).length, 2, "two oscillators");
  for (const field of ["amp.attack", "amp.decay", "amp.sustain", "amp.release", "filter.resonance", "filter.env", "osc1.detune", "osc2.detune"]) assert.ok(html.includes(`data-inst="${field}"`), field);
});

test("a voice: two oscillators through the low-pass into its destination, the envelope shaped, released", () => {
  const ctx = new FakeContext();
  const out = new Node("strip");
  const s = Sy.settings({ preset: "lead" });
  const v = Sy.voice(ctx, s, out, { key: 69, velocity: 127, at: 11 });
  const [o1, o2] = oscillators(ctx);
  assert.equal(o1.type, "square");
  assert.equal(o2.type, "sawtooth");
  assert.equal(o1.frequency.value, 440);
  assert.equal(o2.detune.value, 5);
  assert.equal(o1.started, 11);
  const { filter, amp } = v.nodes;
  assert.equal(filter.type, "lowpass");
  assert.equal(filter.Q.value, Sy.resonanceQ(s.filter.resonance));
  assert.deepEqual(amp.out.map((c) => c.node), [out], "into the strip");
  assert.deepEqual(amp.gain.calls.slice(0, 2), [["set", 0, 11], ["ramp", 0.25, 11 + s.amp.attack]]);
  const end = v.stop(12);
  assert.equal(end, 12 + s.amp.release);
  assert.equal(o1.stopped, end + 0.05);
  assert.equal(v.stop(13), end, "released once");
  // MPE: its own bend and pressure.
  v.bend(2, 12.5);
  assert.deepEqual(o1.detune.calls.at(-1), ["target", 200, 12.5, 0.005]);
  assert.deepEqual(o2.detune.calls.at(-1), ["target", 205, 12.5, 0.005]);
  v.pressure(127, 12.5);
  const p = Sy.voiceParams(s, 69, 127);
  assert.ok(Math.abs(filter.frequency.calls.at(-1)[1] - Math.min(20000, p.cutoffSustain * 2)) < 1e-6, "full pressure opens it an octave");
  // Released during its attack: from where the attack got to, not from the peak.
  const pad = Sy.settings({ preset: "pad" });
  const early = Sy.voice(ctx, pad, out, { key: 60, velocity: 127, at: 20 });
  early.stop(20 + pad.amp.attack / 2);
  const reached = early.nodes.amp.gain.calls.find((c) => c[0] === "set" && c[2] > 20);
  assert.ok(Math.abs(reached[1] - 0.125) < 1e-9, "half the peak, half way through the attack");
  assert.equal(reached[2], 20 + pad.amp.attack / 2);
});

// ---- The notes, from the MIDI ---------------------------------------------------------

const smf = (tracks, division = 480) => F.writeSmf({ format: 1, division, tracks: tracks.map((t) => [...t, { tick: Math.max(0, ...t.map((e) => e.tick)), data: [0xff, 0x2f, 0] }]) });
// Track 0: the tempo (120, then 60 from beat 2); track 1: channel 0; track 2: channel 3.
const PIECE = smf([
  [{ tick: 0, data: [0xff, 0x51, 3, 0x07, 0xa1, 0x20] }, { tick: 960, data: [0xff, 0x51, 3, 0x0f, 0x42, 0x40] }],
  [{ tick: 0, data: [0xc0, 0] }, { tick: 0, data: [0x90, 60, 100] }, { tick: 480, data: [0x80, 60, 0] }, { tick: 960, data: [0x90, 62, 90] }, { tick: 1440, data: [0x90, 62, 0] }],
  [{ tick: 0, data: [0xc3, 33] }, { tick: 480, data: [0x93, 40, 70] }, { tick: 960, data: [0xa3, 40, 20] }, { tick: 1920, data: [0x83, 40, 0] }],
]);

test("the synthesizer's notes, in seconds through the tempo changes; taken out of what the SoundFont plays", () => {
  const notes = Sy.notesOf(PIECE, new Set([3]));
  // 120 a quarter for two beats (0.5 s each), then 60 (1 s each).
  assert.deepEqual(notes, [{ channel: 3, key: 40, velocity: 70, on: 0.5, off: 3 }]);
  const both = Sy.notesOf(PIECE, new Set([0, 3]));
  assert.deepEqual(both.map((n) => [n.channel, n.key, n.on, n.off]), [[0, 60, 0, 0.5], [3, 40, 0.5, 3], [0, 62, 1, 2]]);
  assert.deepEqual(Sy.notesOf(PIECE, new Set()), []);
  // Stripped: channel 3's notes and key pressure gone, its program and the other channel kept.
  const left = F.readSmf(Sy.stripNotes(PIECE, new Set([3])));
  assert.deepEqual(left.tracks[2].map((e) => e.data), [[0xc3, 33], [0xff, 0x2f, 0]]);
  assert.equal(left.tracks[1].filter((e) => (e.data[0] & 0xf0) === 0x90 && e.data[2] > 0).length, 2);
  assert.equal(Sy.stripNotes(PIECE, new Set()), PIECE, "nothing to take out: the same bytes");
  // A note never let go lasts a second.
  const open = smf([[{ tick: 0, data: [0x90, 50, 80] }]]);
  assert.deepEqual(Sy.notesOf(open, new Set([0])).map((n) => n.off), [1]);
});

test("a second MIDI port's channel is its port's: channel 16 + n", () => {
  const ported = smf([[{ tick: 0, data: [0xff, 0x21, 1, 1] }, { tick: 0, data: [0x92, 64, 80] }, { tick: 480, data: [0x82, 64, 0] }]]);
  assert.deepEqual(Sy.notesOf(ported, new Set([18])).map((n) => n.key), [64]);
  assert.deepEqual(Sy.notesOf(ported, new Set([2])), []);
});

test("Save the sound: every note scheduled at once, each into its staff's mixer strip", () => {
  const ctx = new FakeContext();
  const synth = { connectChannel() {}, worklet: new Node("worklet") };
  const graph = X.mixerGraph(ctx, synth);
  const notes = Sy.notesOf(PIECE, new Set([0, 3]));
  const voices = Sy.scheduleAll(ctx, notes, () => Sy.settings({ preset: "pluck" }), (channel) => graph.strips[channel].input);
  assert.equal(voices.length, 3);
  assert.deepEqual(oscillators(ctx).map((o) => o.started), [0, 0, 0.5, 0.5, 1, 1]);
  assert.deepEqual(voices[1].nodes.amp.out.map((c) => c.node), [graph.strips[3].input], "channel 3 into strip 3");
  // Muted in the mixer, its strip is silent: the synthesizer with it.
  graph.apply({ tracks: { 1: { mute: true } } }, [{ lane: 0, channel: 0 }, { lane: 1, channel: 3 }]);
  assert.equal(graph.strips[3].nodes.volume.gain.value, 0);
  assert.equal(graph.strips[0].nodes.volume.gain.value, 1);
});

test("Play: the notes due in the next moment scheduled against the audio clock, at the speed played; a jump lets them go", () => {
  const ctx = new FakeContext();
  const into = new Node("strip");
  const notes = Sy.notesOf(PIECE, new Set([0, 3]));
  const player = new Sy.Scheduler({ ctx, notes, settingsOf: () => Sy.settings({ preset: "lead" }), destinationOf: () => into });
  player.tick(0, 1);
  assert.deepEqual(oscillators(ctx).map((o) => o.started), [10, 10], "the first note, now");
  player.tick(0.4, 0.5);
  assert.equal(oscillators(ctx).length, 2, "at half speed, 0.1 s of music is 0.2 s of audio away: not yet");
  player.tick(0.48, 0.5);
  assert.deepEqual(oscillators(ctx).slice(2).map((o) => o.started), [10.04, 10.04], "0.02 s of music at half speed: 0.04 s");
  assert.equal(player.voices.size, 2);
  // The loop jumps back: what sounds is let go, the count starts again there.
  player.tick(0, 1);
  assert.equal(player.voices.size, 1);
  assert.equal(oscillators(ctx).length, 6, "the first note again");
  player.silence();
  assert.equal(player.voices.size, 0);
  assert.equal(player.last, null);
});

test("an audio track's lane (#390, \"audio-1\") plays no synthesizer and no own SoundFont, and none is kept for it", async () => {
  const Sb = await import("../../public/eui-score/soundbank.js");
  const score = { staves: [{}], meta: { synth: { "audio-1": { preset: "lead" } }, soundfont: { "audio-1": { name: "x", hash: "0123456789abcdef" } } } };
  assert.equal(Sy.isStaff(score, "audio-1"), false);
  assert.equal(Sy.isStaff(score, 0), true);
  assert.equal(Sy.isStaff(score, 3), false, "no such staff");
  assert.equal(Sy.synthOf(score, "audio-1"), null);
  assert.equal(Sb.soundfontOf(score, "audio-1"), null);
  assert.deepEqual(Sy.synthLanes(score), []);
  const before = JSON.stringify(score.meta);
  assert.equal(Sy.setSynth(score, "audio-2", { preset: "pad" }), null);
  assert.equal(Sb.setSoundfont(score, "audio-2", { name: "y", hash: "0123456789abcdef", bank: 0, program: 0 }), null);
  assert.equal(JSON.stringify(score.meta), before, "nothing written");
});

test("a staff taken away takes its synthesizer and SoundFont with it; the later staves' move back; an audio track's stays", () => {
  const { score } = M.fromParsed(JSON.parse(score_json("<< \\new Staff { c''1 } \\new Staff { e''1 } \\new Staff { \\clef bass c1 } >>")));
  const font = { name: "A.sf2", hash: "0123456789abcdef", bank: 0, program: 3, preset: "P" };
  score.meta = { synth: { 0: { preset: "lead" }, 2: { preset: "bass" } }, soundfont: { 1: font }, mixer: { tracks: { 2: { volume: -6 }, "audio-1": { volume: -3 } } } };
  M.removeStaff(score, 1);
  assert.deepEqual(score.meta.synth, { 0: { preset: "lead" }, 1: { preset: "bass" } }, "the bass is lane 1 now");
  assert.equal(score.meta.soundfont, undefined, "the removed staff's SoundFont went, and the key with it");
  assert.deepEqual(score.meta.mixer.tracks, { 1: { volume: -6 }, "audio-1": { volume: -3 } }, "an audio track's lane is not a number to move");
  assert.deepEqual(Sy.synthOf(score, 1), Sy.settings({ preset: "bass" }));
});

test("keys played live on a synthesizer staff sound on it; on another, the SoundFont's", () => {
  const ctx = new FakeContext();
  const into = new Node("master");
  const live = Sy.liveKeys({ context: () => ctx, settingsOf: (channel) => (channel === 2 ? Sy.settings({ preset: "pad" }) : null), destinationOf: () => into });
  assert.equal(live.on(0, 60, 90), false, "not a synthesizer staff");
  assert.equal(live.on(2, 60, 90), true);
  assert.deepEqual(live.held, [60]);
  assert.equal(live.expression(60, { bend: -1, pressure: 64 }), true);
  assert.equal(live.expression(61, { bend: 1 }), false, "a key not held");
  assert.equal(live.off(2, 60), true);
  assert.deepEqual(live.held, []);
  assert.equal(live.off(0, 60), false);
});
