// Each staff its own MIDI channel, past fifteen staves too (#389).
//
// eui-score writes a track a staff and numbers their channels by place: the
// tenth is the drums', and from the sixteenth staff on they all play on the
// sixteenth — one instrument, one volume, notes cutting each other off.
// score-model.js `channels` plans better (its own channel each, then shared
// by staves alike, then a second MIDI port); this rewrites the engraver's
// file to that plan: each track's channel events moved to its channel, and
// a MIDI Port meta event (FF 21) at the head of every track when a second
// port is used. A staff keeps its program, volume and pan: they are its
// track's own events, moved along.
//
// SpessaSynth, which plays it, reads the port events: it gives each port 16
// channels of its own (synthesizer channel = port × 16 + channel), so a
// staff's mute is still `synth.midiChannels[channel]`. Its worklet has 16
// dry outputs, channel n on output n mod 16: mixer.js `channelSettings`
// deals with two tracks on one output.
//
//   import { assignChannels } from "/eui-score/channels.js";
//   const bytes = assignChannels(score, await toMidi(source));

const V = new URL(import.meta.url).search;
const M = await import(`./score-model.js${V}`);
const F = await import(`./feel.js${V}`);

const isChannel = (data) => data[0] >= 0x80 && data[0] < 0xf0;

/** A track's MIDI port: its Port meta event's, 0 without one. */
export function portOf(events) {
  const ev = events.find((e) => e.data[0] === 0xff && e.data[1] === 0x21);
  return ev ? ev.data[3] : 0;
}

/** The synthesizer channel each track plays on: port × 16 + the channel of its first channel event; null for a track without any. */
export function trackChannels(smf) {
  return smf.tracks.map((events) => {
    const ev = events.find((e) => isChannel(e.data));
    return ev ? 16 * portOf(events) + (ev.data[0] & 15) : null;
  });
}

/**
 * `bytes` (the MIDI eui-score wrote from `score`, a track a staff) on the
 * channels score-model.js `channels` plans: the same bytes when the
 * engraver's numbering is already the plan, or when the file is not a
 * track a staff (then nothing is known to move).
 */
export function assignChannels(score, bytes) {
  if (!score) return bytes;
  const plan = M.channels(score);
  const smf = F.readSmf(bytes);
  const playing = smf.tracks.map((events, k) => k).filter((k) => smf.tracks[k].some((e) => isChannel(e.data)));
  if (playing.length !== plan.length) return bytes;
  const now = trackChannels(smf);
  if (playing.every((k, n) => now[k] === plan[n].channel)) return bytes;
  const ports = plan.some((p) => p.port > 0);
  const tracks = smf.tracks.map((events) => events.filter((e) => !(e.data[0] === 0xff && e.data[1] === 0x21)).map((e) => ({ tick: e.tick, data: e.data.slice() })));
  playing.forEach((k, n) => {
    const { channel, port } = plan[n];
    for (const e of tracks[k]) if (isChannel(e.data)) e.data[0] = (e.data[0] & 0xf0) | (channel & 15);
    if (ports) tracks[k].unshift({ tick: 0, data: [0xff, 0x21, 1, port] });
  });
  return F.writeSmf({ ...smf, format: tracks.length > 1 ? 1 : smf.format, tracks });
}
