// What Play plays outside the editor (#682): the read page /s/…, the
// shared and section pages, the examples (public/js/score.js). The MIDI is
// made as the editor's Play makes it (studio-playback.js `heardMidi`): the
// score read with its meta line, every repeat played out, each staff on its
// own channel, each note at the velocity set for it, the curves drawn, the
// grace notes timed, then swung, humanized and its rit. and accel. gliding.
// A change to one goes to the other.
//
// What the editor's mixer does on the sound, these pages have no graph
// for: the staves' volume and pan go in the file (as Save as MIDI writes
// them), and a muted staff — or one left out by a solo — is left out of it.
//
// The built-in orchestra (orchestra.js, #1040) plays here as in the editor:
// `withOrchestra` gives the player the banks of the instruments the score
// names and puts them in the MIDI; a bank that has not come keeps its staff
// on General MIDI.
//
//   import { heardMidi, withOrchestra } from "/eui-score/heard.js";
//   const heard = await heardMidi(src, { midi, parse });       // { bytes, turns, score, passes }
//   const bytes = await withOrchestra(heard, player);
//
// `midi(source, { bpm, beat, unfold })` is eui-score.js `toMidi`; `parse`
// the engraver's score_json of a source, parsed, its spans in.

const V = new URL(import.meta.url).search;
export const M = await import(`./score-model.js${V}`);
const F = await import(`./feel.js${V}`);
const Vel = await import(`./velocity.js${V}`);
const A = await import(`./automation.js${V}`);
const G = await import(`./graces.js${V}`);
const Ch = await import(`./channels.js${V}`);
const X = await import(`./mixer.js${V}`);

/** The score `src` holds as the editor reads it, its meta line in `score.meta`; null when the model does not read it. */
export function scoreOf(src, parse) {
  let parsed = null;
  try {
    parsed = parse(src);
  } catch {}
  let read;
  try {
    read = M.fromParsed(parsed, src, { parse });
  } catch {
    return null;
  }
  if (!read?.score) return null;
  read.score.meta = M.readMeta(src);
  return read.score;
}

/** The turns a looped section is played: two minutes or so of music, then it stops. */
export function turnsOf(bars) {
  return Math.max(8, Math.ceil(64 / Math.max(1, bars)));
}

/** The channels the mixer leaves silent: those on which no staff sounds (muted, or not soloed while another is). */
export function silentChannels(score) {
  const mix = X.mixOf(score);
  const rows = M.channels(score);
  const heard = new Set(rows.filter(({ lane }) => X.audible(mix, lane)).map(({ channel }) => channel));
  return [...new Set(rows.map(({ channel }) => channel))].filter((channel) => !heard.has(channel));
}

/** `bytes` without the notes of `channels` (port × 16 + channel): the same bytes when there are none. */
export function withoutChannels(bytes, channels) {
  if (!channels.length) return bytes;
  const smf = F.readSmf(bytes);
  const { ports } = A.channelTracks(smf);
  const silent = new Set(channels);
  const note = (data) => (data[0] & 0xe0) === 0x80;
  const tracks = smf.tracks.map((track, k) => track.filter((e) => !(note(e.data) && silent.has(ports[k] + (e.data[0] & 15)))));
  return F.writeSmf({ ...smf, tracks });
}

/**
 * The MIDI of `src` as it is to be heard: { bytes, turns }. `loop`
 * ({ bars, time }) plays it over and over (a section, #457), `turnsOf`
 * times; swung and humanized after the loop, no two turns quite alike. A
 * source the model does not read is played as written, its meta line's
 * swing and humanize still heard. `score` and `passes` (the score as read,
 * its bars as played; null and none for a source the model does not read)
 * are what `withOrchestra` needs.
 */
export async function heardMidi(src, { midi, parse, loop = null }) {
  const score = scoreOf(src, parse);
  const feel = F.feelOf(score ? score.meta : M.readMeta(src));
  let bytes;
  let passes = [];
  if (score) {
    passes = M.playback(score);
    const written = await midi(M.toLilyPond(score, { unfold: true }).source, { bpm: M.DEFAULT_BPM, beat: 4, unfold: false });
    const channelled = Ch.assignChannels(score, written);
    const velocities = Vel.applyVelocities(score, channelled);
    const mix = X.mixOf(score);
    const curves = A.applyAutomation(score, velocities, { passes, mix: mix.tracks ? mix : null, volumeMin: X.VOLUME_MIN });
    const graced = G.applyGraces(score, curves, { passes });
    bytes = withoutChannels(graced, silentChannels(score));
  } else {
    bytes = await midi(src, { bpm: M.DEFAULT_BPM, beat: 4 });
  }
  if (!loop?.bars) return { bytes: F.feel(bytes, { score, passes, ...feel }), turns: 1, score, passes };
  const turns = turnsOf(loop.bars);
  const turn = loop.bars * F.barTicks(loop.time || "4/4", F.readSmf(bytes).division);
  return { bytes: F.feel(F.loopSmf(bytes, turn, turns), feel), turns, score, passes };
}

/**
 * What `heard` (heardMidi's) plays on player `P` (player.js) with the
 * built-in orchestra (#1040): its MIDI with each staff on its built-in
 * instrument — those whose bank is in this browser, or comes while `until`
 * (a promise: the default sounds loading, on a first Play) is waited for,
 * and a moment more (`patience`, ms; orchestra.js `PATIENCE` when not given);
 * the others play General MIDI this time and are there for the next. A
 * looped section's staves play their instrument's first articulation
 * throughout: its turns are not the score's bars. The bytes as they were
 * for a source the model does not read, or when anything fails.
 */
export async function withOrchestra(heard, P, { until = null, patience = 0, onProgress = null } = {}) {
  if (!heard?.score) return heard.bytes;
  try {
    const O = await import(`./orchestra.js${V}`);
    const sound = await O.prepare(P, heard.score, M.channels(heard.score), { until, patience: patience || O.PATIENCE, onProgress });
    if (!sound.lanes.length) return heard.bytes;
    if (heard.turns !== 1) return O.apply(null, heard.bytes, sound.lanes);
    const early = F.humanizeOf(F.feelOf(heard.score.meta).humanize)?.time ?? 0;
    return O.apply(heard.score, heard.bytes, sound.lanes, { passes: heard.passes, early });
  } catch (error) {
    return heard.bytes;
  }
}
