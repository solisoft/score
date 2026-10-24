// Plays a Standard MIDI File in the browser, with real instruments.
//
// The sounds are MuseScore_General (MIT, ../soundfonts/), a General MIDI
// SoundFont: a staff's `midiInstrument` picks its program, and the
// percussion channel its drum kit. SpessaSynth (vendor/, Apache-2.0) is the
// synthesizer, in an AudioWorklet, with its sequencer.
//
// Nothing is fetched before the first Play: the sounds are 38 MB. They are
// kept in the browser's Cache Storage after that, so the next Play, and the
// next visit, start at once. One piece plays at a time: a new one stops the
// one playing.
//
//   import { unlock, play, stop } from "/eui-score/player.js";
//   button.onclick = async () => {
//     unlock();                                  // inside the click
//     const playing = await play(midiBytes, { onStop: () => …, onProgress: (f) => … });
//     playing.time;                              // seconds, as heard
//     playing.time = 30;                         // seek
//     playing.heard;                             // seconds, less the output's latency
//     playing.stop();
//   };

// Served immutable: this module's version goes to the files it loads.
const V = new URL(import.meta.url).search;
const SOUNDS = new URL("../soundfonts/MuseScore_General.sf3?v=0.2", import.meta.url);
const CACHE = "eui-score-sounds";

let context = null;
let engine = null;
let current = null;
const watchers = new Set();

/**
 * Lets the page make sound. Call it inside the click, before anything
 * waits: a browser starts audio only from a gesture, and a gesture does not
 * outlive a download. A page that has to load this module first makes an
 * AudioContext in its click and hands it over here.
 */
export function unlock(made) {
  if (made && context && made !== context) made.close().catch(() => {});
  context ??= made ?? new AudioContext();
  context.resume().catch(() => {});
  return context;
}

// What the synthesizer's outputs go through on their way out: straight to
// the speakers, or a mixer's graph (mixer.js), on Play's AudioContext and on
// the OfflineAudioContext that renders a WAV alike.
let router = null;

/**
 * `fn(ctx, synth, offline, destination)` connects each synthesizer made
 * from now on (Play's, once; a WAV's, each time) to `destination` — Play's
 * through the MIDI-learn volume, a WAV's straight out; null connects them
 * straight there.
 */
export function setRouter(fn) {
  router = fn;
}

function route(ctx, synth, offline, destination = ctx.destination) {
  if (router) router(ctx, synth, offline, destination);
  else synth.connect(destination);
}

/** True once the synthesizer and its sounds are loaded: Play will start at once. */
export function isReady() {
  return Boolean(engine?.done);
}

/** Loads the synthesizer and the sounds; `onProgress(fraction)` while the sounds download. */
export function prepare(onProgress) {
  if (onProgress) watchers.add(onProgress);
  engine ??= start();
  const loading = engine.promise;
  return onProgress ? loading.finally(() => watchers.delete(onProgress)) : loading;
}

function start() {
  const job = { done: false, promise: null };
  job.promise = (async () => {
    const ctx = unlock();
    const [{ WorkletSynthesizer, Sequencer }, bank] = await Promise.all([
      import(`./vendor/spessasynth.js${V}`),
      sounds(),
      ctx.audioWorklet.addModule(new URL(`vendor/spessasynth_processor.min.js${V}`, import.meta.url)),
    ]);
    const synth = new WorkletSynthesizer(ctx);
    // Through a gain: the volume a controller's fader sets (MIDI learn), a
    // performance control after the mixer, not kept with the score.
    const gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);
    route(ctx, synth, false, gain);
    await synth.soundBankManager.addSoundBank(bank, "main");
    await synth.isReady;
    // The score's first beat is at 0 s, a rest or not: the editor's timings count from there.
    const seq = new Sequencer(synth, { skipToFirstNoteOn: false });
    job.done = true;
    return { ctx, synth, seq, gain };
  })();
  // A failed load is tried again on the next Play.
  job.promise.catch(() => {
    if (engine === job) engine = null;
  });
  return job;
}

/** The SoundFont's bytes: from Cache Storage, or downloaded (with progress) and kept there. */
async function sounds() {
  let cache = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(SOUNDS);
    if (hit) return await hit.arrayBuffer();
  } catch (error) {
    cache = null; // no Cache Storage (plain http, private window): the HTTP cache only
  }
  const response = await fetch(SOUNDS);
  if (!response.ok) throw new Error(`the sounds could not be loaded (${response.status})`);
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) for (const watch of watchers) watch(Math.min(1, received / total));
  }
  const bytes = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  try {
    // Before the synthesizer gets the buffer: it may take it for its worklet.
    // The app's service worker (public/sw.js) keeps the sounds in this same
    // cache, under this same address: one copy, whoever puts it first.
    await cache?.put(SOUNDS, new Response(bytes, { headers: { "content-type": "audio/x-soundfont" } }));
    // An older version of the sounds goes: 38 MB each.
    for (const kept of (await cache?.keys()) ?? []) {
      const url = new URL(kept.url);
      if (url.pathname === SOUNDS.pathname && url.search !== SOUNDS.search) await cache.delete(kept);
    }
  } catch (error) {}
  return bytes.buffer;
}

/**
 * Plays `midi` (a Uint8Array or ArrayBuffer, a Standard MIDI File) from `at`
 * seconds; answers a handle, or null when another Play came first.
 * `onStop()` is called once, when the piece ends or is stopped.
 */
export async function play(midi, { at = 0, onStop, onProgress } = {}) {
  stop();
  const token = { onStop };
  current = token;
  const { ctx, synth, seq } = await prepare(onProgress);
  if (current !== token) return null;
  await ctx.resume();
  const bytes = midi instanceof ArrayBuffer ? midi : midi.buffer.slice(midi.byteOffset, midi.byteOffset + midi.byteLength);
  await new Promise((resolve) => {
    seq.eventHandler.addEvent("songChange", "eui-score", () => resolve());
    seq.loadNewSongList([{ binary: bytes, fileName: "score.mid" }]);
  });
  seq.eventHandler.removeEvent("songChange", "eui-score");
  if (current !== token) return null;
  seq.eventHandler.addEvent("songEnded", "eui-score", () => {
    if (current === token) stop();
  });
  if (output) seq.connectMIDIOutput(output);
  else seq.connectMIDIOutput();
  if (at > 0) seq.currentTime = at;
  seq.play();
  token.stop = () => {
    seq.pause();
    synth.stopAll(true);
  };
  return {
    /** Where the music is, in seconds — smoothed, for drawing. */
    get time() {
      return seq.currentHighResolutionTime;
    },
    set time(sec) {
      seq.currentTime = Math.max(0, Math.min(sec, seq.duration));
    },
    /**
     * Where the music is as it reaches the ear: the time above, less what
     * the audio output takes to play it — a tenth of a second or more on
     * Bluetooth headphones. For lighting the notes being heard.
     */
    get heard() {
      return Math.max(0, seq.currentHighResolutionTime - outputDelay(ctx, Boolean(output), deviceDelay) * seq.playbackRate);
    },
    get duration() {
      return seq.duration;
    },
    get playing() {
      return current === token;
    },
    get paused() {
      return seq.paused;
    },
    pause() {
      if (current !== token || seq.paused) return;
      seq.pause();
      synth.stopAll();
    },
    resume() {
      if (current === token && seq.paused) seq.play();
    },
    /** Speed, 1 as written: the time above stays the piece's own. */
    get rate() {
      return seq.playbackRate;
    },
    set rate(value) {
      seq.playbackRate = value;
    },
    stop() {
      if (current === token) stop();
    },
  };
}

// ---- To a file -------------------------------------------------------------------------------

/**
 * `midi` rendered with the same sounds, faster than it plays, as a WAV file
 * (a Blob): 44.1 kHz, stereo, with two seconds after the last note for the
 * sound to die away. `muted` lists the MIDI channels to leave out;
 * `onProgress(fraction)` while the sounds download.
 */
export async function renderWav(midi, options = {}) {
  const { audioBufferToWav } = await import(`./vendor/spessasynth.js${V}`);
  return audioBufferToWav(await renderAudio(midi, options));
}

/** `midi` rendered as renderWav renders it, as an AudioBuffer: for a compressed file, or a stem. */
export async function renderAudio(midi, { muted = [], onProgress } = {}) {
  const [{ WorkletSynthesizer, BasicMIDI }, bank] = await Promise.all([import(`./vendor/spessasynth.js${V}`), (onProgress && watchers.add(onProgress), sounds())]);
  if (onProgress) watchers.delete(onProgress);
  const bytes = midi instanceof ArrayBuffer ? midi : midi.buffer.slice(midi.byteOffset, midi.byteOffset + midi.byteLength);
  const sequence = BasicMIDI.fromArrayBuffer(bytes);
  const rate = 44100;
  const offline = new OfflineAudioContext({ numberOfChannels: 2, sampleRate: rate, length: Math.ceil(rate * (sequence.duration + 2)) });
  await offline.audioWorklet.addModule(new URL(`vendor/spessasynth_processor.min.js${V}`, import.meta.url));
  const synth = new WorkletSynthesizer(offline);
  route(offline, synth, true);
  await synth.startOfflineRender({ midiSequence: sequence, soundBankList: [{ soundBankBuffer: bank, bankOffset: 0 }], loopCount: 0, sequencerOptions: { skipToFirstNoteOn: false } });
  for (const channel of muted) synth.midiChannels[channel]?.setSystemParameter?.("isMuted", true);
  return offline.startRendering();
}

// ---- Around the piece ---------------------------------------------------------------------

// The metronome's clicks: wood blocks on a drum channel of their own, so
// muting the drums leaves the beat.
const CLICK = 14;

/** The audio clock, in seconds: what `click` is scheduled against. */
export function audioTime() {
  return context?.currentTime ?? 0;
}

/**
 * A metronome click at audio time `when`; `accent` for a bar's first beat,
 * `soft` for an eighth or a sixteenth between the beats. Silent before the
 * sounds have loaded.
 */
export function click(when, accent = false, soft = false) {
  if (!engine?.done) return;
  engine.promise.then(({ synth }) => {
    synth.midiChannels[CLICK]?.setDrums(true);
    const key = accent ? 76 : 77;
    synth.noteOn(CLICK, key, accent ? 120 : soft ? 50 : 90, { time: when });
    synth.noteOff(CLICK, key, { time: when + 0.08 });
  });
}

/** Mutes or sounds again MIDI channel `channel` of the piece. */
export function mute(channel, muted) {
  if (!engine?.done) return;
  engine.promise.then(({ synth }) => synth.midiChannels[channel]?.setSystemParameter("isMuted", muted));
}

// Where the piece is sent: this browser's synthesizer, or a MIDI device
// (GarageBand, Logic…, through the IAC bus on a Mac).
let output = null;
let access = null;

/** The MIDI outputs the browser may use, asking the person the first time: [{ id, name }]. */
export async function midiOutputs() {
  if (!navigator.requestMIDIAccess) throw new Error("This browser sends no MIDI: Chrome, Edge and Firefox do, Safari does not.");
  access ??= await navigator.requestMIDIAccess();
  return [...access.outputs.values()].map((port) => ({ id: port.id, name: port.name }));
}

/** The MIDI keyboards the browser may read, asking the person the first time: [{ id, name }]. */
export async function midiInputs() {
  if (!navigator.requestMIDIAccess) throw new Error("This browser reads no MIDI keyboard: Chrome, Edge and Firefox do, Safari does not.");
  access ??= await navigator.requestMIDIAccess();
  return [...access.inputs.values()].map((port) => ({ id: port.id, name: port.name }));
}

let input = null;
const taps = new Set();
const ears = new Set();

/**
 * Hears every message of the MIDI keyboard listened to, before anything
 * else does, and keeps none from going further: `fn(data, timeStamp)` — the
 * knobs and the bend recorded while recording (automation-ui.js). Answers
 * the function that stops it.
 */
export function overhear(fn) {
  ears.add(fn);
  return () => ears.delete(fn);
}

/**
 * Hears every message of the MIDI keyboard listened to, before its keys are:
 * `fn(data, timeStamp)` answering true keeps a message from going further
 * (a key learnt for Play writes no note). Answers the function that stops it.
 */
export function tap(fn) {
  taps.add(fn);
  return () => taps.delete(fn);
}

/**
 * Listens to MIDI keyboard `id` (null: to none). `onKey(key, held,
 * velocity)` is called on each key pressed, `held` the other keys still down — keys
 * played together make a chord — and `onRelease(key)`, when given, on each
 * key let go.
 */
export function listen(id, onKey, onRelease = null) {
  if (input) input.onmidimessage = null;
  input = id && access ? access.inputs.get(id) ?? null : null;
  if (!input) return null;
  const down = new Set();
  input.onmidimessage = ({ data, timeStamp }) => {
    for (const fn of ears) fn(data, timeStamp);
    for (const fn of taps) if (fn(data, timeStamp)) return;
    const [status, key, velocity] = data;
    const kind = status & 0xf0;
    if (kind === 0x90 && velocity > 0) {
      const held = [...down];
      down.add(key);
      onKey(key, held, velocity, timeStamp);
    } else if (kind === 0x80 || kind === 0x90) {
      down.delete(key);
      onRelease?.(key);
    }
  };
  return input;
}

/** A note on or off, straight to the MIDI device chosen in Sound to. */
function sendNote(channel, key, on, velocity = 90) {
  try {
    output.send(on ? [0x90 | channel, key, velocity] : [0x80 | channel, key, 0]);
  } catch (error) {}
}

/** Plays to MIDI output `id` from the next Play on, or to this browser with null. */
export function setOutput(id) {
  output = id && access ? access.outputs.get(id) ?? null : null;
  return output;
}

/** The MIDI device chosen in Sound to (a MIDIOutput), or null: where the MIDI clock goes too. */
export function outputPort() {
  return output;
}

// How late a MIDI device sounds what it is sent, in ms: set by hand, since
// no device says. Bluetooth MIDI, or a software synth's buffer, adds some.
let deviceDelay = 0;

/** Sets the Sound to device's latency, in ms. */
export function setDeviceDelay(ms) {
  deviceDelay = Number(ms) || 0;
}

/**
 * How late the music reaches the ear, in seconds: the audio output's own
 * latency (`outputLatency`, or `baseLatency` where it is all a browser
 * says) in this browser; the latency set by hand for a MIDI device.
 */
export function outputDelay(ctx, toDevice = false, deviceMs = 0) {
  if (toDevice) return Math.max(0, deviceMs) / 1000;
  return (ctx?.outputLatency || 0) + (ctx?.baseLatency || 0);
}

let volume = 1;

/** The volume, 0 to 1: this browser's sound, or Channel Volume (CC 7) on every channel of a MIDI device. */
export function setVolume(value) {
  volume = Math.max(0, Math.min(1, Number(value)));
  if (output) {
    for (let channel = 0; channel < 16; channel++) {
      try {
        output.send([0xb0 | channel, 7, Math.round(volume * 127)]);
      } catch (error) {}
    }
  }
  if (engine?.done) engine.promise.then(({ ctx, gain }) => gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.02));
  return volume;
}

// The notes heard while writing sound on a channel of their own, so the
// piece's channels keep their instruments.
const PREVIEW = 15;

/**
 * Sounds `keys` (MIDI keys, a chord) briefly with General MIDI `program` —
 * the note just written or selected. Before the sounds have loaded, it
 * starts loading them and stays silent: the next note is heard.
 */
export function preview(keys, program = 0, { drums = false, channel = 0 } = {}) {
  live = drums ? 9 : output ? channel : PREVIEW;
  // To the MIDI device chosen in Sound to, on the staff's channel.
  if (output) {
    for (const key of keys) sendNote(drums ? 9 : channel, key, true, 90);
    setTimeout(() => {
      for (const key of keys) sendNote(drums ? 9 : channel, key, false);
    }, 450);
    return true;
  }
  if (!engine?.done) {
    prepare().catch(() => {});
    return false;
  }
  engine.promise.then(({ ctx, synth }) => {
    ctx.resume().catch(() => {});
    // Drums on the kit's channel, the tenth; the rest on the preview's own.
    const channel = drums ? 9 : PREVIEW;
    if (!drums) synth.programChange(channel, program);
    for (const key of keys) synth.noteOn(channel, key, 90);
    setTimeout(() => {
      for (const key of keys) synth.noteOff(channel, key);
    }, 450);
  });
  return true;
}

/**
 * Sounds `key` with General MIDI `program` (or the drum kit) for as long as
 * it is held — a key played while recording, as hard as it was struck — and
 * stops it with `on` false. Silent until the sounds have loaded.
 */
export function hold(key, on, program = 0, { drums = false, velocity = 100, channel = 0 } = {}) {
  live = drums ? 9 : output ? channel : PREVIEW;
  if (output) {
    sendNote(drums ? 9 : channel, key, on, velocity);
    return true;
  }
  if (!engine?.done) return false;
  engine.promise.then(({ ctx, synth }) => {
    ctx.resume().catch(() => {});
    const channel = drums ? 9 : PREVIEW;
    if (!on) return synth.noteOff(channel, key);
    if (!drums) synth.programChange(channel, program);
    synth.noteOn(channel, key, velocity);
  });
  return true;
}

// The channel the last key sounded on: where the keyboard's bends go.
let live = PREVIEW;

/**
 * Pitch bend, channel pressure or key pressure from the keyboard (`data`, a
 * MIDI message), sounded on the channel of the keys being played: in this
 * browser, or on the MIDI device.
 */
export function express(data) {
  const message = [(data[0] & 0xf0) | live, ...Array.from(data).slice(1)];
  if (output) {
    try {
      output.send(message);
    } catch (error) {}
    return true;
  }
  if (!engine?.done) return false;
  engine.promise.then(({ synth }) => synth.sendMessage(message));
  return true;
}

/** Stops what is playing, if anything. */
export function stop() {
  const was = current;
  current = null;
  if (!was) return;
  try {
    was.stop?.();
  } catch (error) {}
  was.onStop?.();
}
