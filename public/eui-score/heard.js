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
//   import { heardMidi } from "/eui-score/heard.js";
//   const { bytes, turns } = await heardMidi(src, { midi, parse });
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
 * swing and humanize still heard.
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
  if (!loop?.bars) return { bytes: F.feel(bytes, { score, passes, ...feel }), turns: 1 };
  const turns = turnsOf(loop.bars);
  const turn = loop.bars * F.barTicks(loop.time || "4/4", F.readSmf(bytes).division);
  return { bytes: F.feel(F.loopSmf(bytes, turn, turns), feel), turns };
}
