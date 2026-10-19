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
    synth.connect(ctx.destination);
    await synth.soundBankManager.addSoundBank(bank, "main");
    await synth.isReady;
    // The score's first beat is at 0 s, a rest or not: the editor's timings count from there.
    const seq = new Sequencer(synth, { skipToFirstNoteOn: false });
    job.done = true;
    return { ctx, synth, seq };
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
    await cache?.put(SOUNDS, new Response(bytes, { headers: { "content-type": "audio/x-soundfont" } }));
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
    get duration() {
      return seq.duration;
    },
    get playing() {
      return current === token;
    },
    stop() {
      if (current === token) stop();
    },
  };
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
