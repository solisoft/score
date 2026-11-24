// The built-in orchestra (#1040): sampled instruments served by the site,
// one SF3 bank an instrument, loaded when a score that plays it is heard.
//
// The banks are made from two free libraries (scripts/sounds/build.py):
// VSCO 2 Community Edition (Versilian Studios, CC0 1.0) and the Salamander
// Grand Piano (Alexander Holm, CC BY 3.0 — credited wherever the sounds are
// listed: `credits`). The manifest, ../soundfonts/orchestra.json, names each
// instrument's file (its digest in its name, so it is served immutable), its
// size, the articulations it holds, and the sounds of Score's it plays:
//
//   { "base": "/soundfonts/orchestra/", "articulations": ["sustain", "staccato", "pizzicato", "tremolo"],
//     "instruments": [{ "id": "violin", "name": "Solo violin", "file": "violin.3f2a….sf3", "sha256": "…",
//                       "size": 10100000, "sounds": { "violin": "sustain" },
//                       "articulations": ["sustain", "staccato", "pizzicato", "tremolo"] }] }
//
// A staff plays the instrument its sound (LilyPond's midiInstrument) names:
// the first the manifest lists for it, the section when the score has
// several such staves or the staff's name says so (Violin I). What neither
// library has — saxophones, guitars, voices, the drum kit — keeps its
// General MIDI sound, and so does a staff on the synthesizer or on a
// SoundFont of your own (synth.js, soundbank.js), which come first.
//
// Kept with the score, on its `%% eui-score` line, only when it is not the
// default:
//
//   "sounds": "gm"                         every staff plays General MIDI
//   "orchestra": { "0": "violin-section" } this staff's instrument; "gm" for its General MIDI sound
//
// How it is heard: each bank is given to SpessaSynth beside the default one
// (player.js `useBank`), its banks moved up by an offset of its own
// (`SLOTS`); the staff's track gets that bank at its start, and a program
// change where the articulation changes — a staccato dot, pizz. until arco,
// a tremolo — each articulation a program of the bank (`apply`). A bank
// that is not loaded yet, or cannot be, leaves its staves on General MIDI:
// the music always plays. Save as MIDI and a MIDI device get none of this.
//
// A bank fetched is kept in Cache Storage with the default sounds
// ("eui-score-sounds"; the service worker keeps /soundfonts/ there too).
// No DOM here: tests/js/orchestra.test.mjs.

const V = new URL(import.meta.url).search;
const { tr } = await import(`./words.js${V}`);
const M = await import(`./score-model.js${V}`);
const F = await import(`./feel.js${V}`);
const Ch = await import(`./channels.js${V}`);
const Sb = await import(`./soundbank.js${V}`);
const Snd = await import(`./sound.js${V}`);

/** Where the manifest is. */
export const MANIFEST = new URL(`../soundfonts/orchestra.json${V}`, import.meta.url);
const CACHE = "eui-score-sounds";

// The bank offsets the instruments take, in the manifest's order: those
// MuseScore_General leaves free (it has presets in banks 0, 1, 8, 16–18,
// 20, 21, 25, 26, 30, 31, 40, 41, 50, 51) under 64, where the SoundFonts of
// your own begin (soundbank.js `OFFSETS`).
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, k) => from + k);
export const SLOTS = [...range(32, 39), ...range(42, 49), ...range(52, 63), ...range(2, 7), ...range(9, 15)];

/** The articulations a bank may hold, each at its program. */
export const ARTICULATIONS = ["sustain", "staccato", "pizzicato", "tremolo"];
/** An articulation's name in the page's language. */
export const articulationName = (id) => ({ sustain: tr("sustained"), staccato: tr("staccato"), pizzicato: tr("pizzicato"), tremolo: tr("tremolo") })[id] ?? String(id);

// The instruments' names are the manifest's, in English until shown: here so that each has its French
// (tests/js/words.test.mjs reads the `tr(…)` of every module).
const english = { tr: (text) => text };
export const NAMES = [
  english.tr("Grand piano"), english.tr("Solo violin"), english.tr("Violin section"), english.tr("Viola section"),
  english.tr("Cello section"), english.tr("Double bass"), english.tr("String orchestra"), english.tr("Harp"),
  english.tr("Piccolo"), english.tr("Flute"), english.tr("Oboe"), english.tr("Clarinet"), english.tr("Bassoon"),
  english.tr("French horn"), english.tr("Trumpet"), english.tr("Muted trumpet"), english.tr("Trombone"), english.tr("Tuba"),
  english.tr("Timpani"), english.tr("Glockenspiel"), english.tr("Xylophone"), english.tr("Marimba"),
  english.tr("Tubular bells"), english.tr("Pipe organ"),
];
/** An instrument's name in the page's language. */
export const instrumentName = (instrument) => tr(instrument.name);

// ---- The manifest ---------------------------------------------------------------------------

const isObject = (x) => x && typeof x === "object" && !Array.isArray(x);
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FILE = /^[a-z0-9-]+\.[0-9a-f]{16}\.sf3$/;

/**
 * A manifest as the players use it, or null for what is not one: its
 * instruments that are well-formed — an id, a file named after its digest, a
 * size, the sounds it plays and the articulations it holds — each with its
 * address (`url`, the digest as its version: served immutable) and its
 * bank offset (`offset`). An instrument past the last slot is left out.
 */
export function readManifest(json, at = MANIFEST) {
  if (!isObject(json) || !Array.isArray(json.instruments)) return null;
  const base = typeof json.base === "string" && json.base.startsWith("/") ? json.base : "/soundfonts/orchestra/";
  const sources = isObject(json.sources) ? json.sources : {};
  const instruments = [];
  for (const raw of json.instruments) {
    if (!isObject(raw) || !ID.test(String(raw.id)) || !FILE.test(String(raw.file)) || !/^[0-9a-f]{64}$/.test(String(raw.sha256))) continue;
    if (!String(raw.file).startsWith(`${raw.id}.${raw.sha256.slice(0, 16)}.`) || !isObject(raw.sounds)) continue;
    const articulations = (Array.isArray(raw.articulations) ? raw.articulations : []).filter((a) => ARTICULATIONS.includes(a));
    if (!articulations.includes("sustain") || instruments.some((i) => i.id === raw.id) || instruments.length >= SLOTS.length) continue;
    const sounds = Object.fromEntries(Object.entries(raw.sounds).filter(([, start]) => articulations.includes(start)));
    const source = isObject(sources[raw.source]) ? sources[raw.source] : {};
    instruments.push({
      id: raw.id,
      name: String(raw.name ?? raw.id).slice(0, 60),
      file: raw.file,
      url: new URL(`${base}${raw.file}?v=${raw.sha256.slice(0, 16)}`, at).href,
      sha256: raw.sha256,
      size: Math.max(0, Number(raw.size) || 0),
      sounds,
      articulations,
      source: String(raw.source ?? ""),
      license: String(raw.license ?? source.license ?? ""),
      offset: SLOTS[instruments.length],
    });
  }
  return { base, instruments, sources };
}

/**
 * Whom the sounds are owed to, as the manifest's sources say: [{ name,
 * credit, license, home, required }] — `required` when the licence asks for
 * the credit (CC BY), which is then shown wherever the sounds are listed.
 */
export function credits(manifest) {
  return Object.values(manifest?.sources ?? {})
    .filter(isObject)
    .map((s) => ({ name: String(s.name ?? ""), credit: String(s.credit ?? ""), license: String(s.license ?? ""), home: String(s.home ?? ""), required: /^CC-BY/i.test(String(s.license ?? "")) }));
}

const LICENSES = { "CC0-1.0": "CC0 1.0", "CC-BY-3.0": "CC BY 3.0" };
/** The credits as one sentence. */
export function creditText(manifest) {
  const said = credits(manifest).map((c) => tr("{name} by {credit} ({license})", { name: c.name, credit: c.credit, license: LICENSES[c.license] ?? c.license }));
  return said.length ? tr("Built-in sounds: {list}.", { list: said.join("; ") }) : "";
}

// ---- What the score keeps -------------------------------------------------------------------

/** What the score plays with: "orchestra" (the built-in sounds, where there are some) or "gm". */
export const choiceOf = (score) => (score?.meta?.sounds === "gm" ? "gm" : "orchestra");

/** The score set to play the built-in sounds ("orchestra") or General MIDI ("gm"). */
export function setChoice(score, choice) {
  score.meta = { ...(score.meta ?? {}) };
  if (choice === "gm") score.meta.sounds = "gm";
  else delete score.meta.sounds;
  return choiceOf(score);
}

const isLane = (lane) => /^\d+$/.test(String(lane));

/** Lane `lane`'s own choice: an instrument's id, "gm", or null when it takes what its sound gives it. */
export function laneChoice(score, lane) {
  const kept = isLane(lane) ? score?.meta?.orchestra?.[lane] : null;
  return typeof kept === "string" && (kept === "gm" || ID.test(kept)) ? kept : null;
}

/** Lane `lane` set to instrument `id`, to "gm", or back to what its sound gives it with null. */
export function setLaneChoice(score, lane, id) {
  if (!isLane(lane)) return null;
  const all = { ...(score.meta?.orchestra ?? {}) };
  if (id == null || !(id === "gm" || ID.test(String(id)))) delete all[lane];
  else all[lane] = id;
  score.meta = { ...(score.meta ?? {}) };
  if (Object.keys(all).length) score.meta.orchestra = all;
  else delete score.meta.orchestra;
  return all[lane] ?? null;
}

// ---- Which instrument a staff plays ---------------------------------------------------------

/** The sound lane `lane`'s staff names (its upper staff's, for a voice or a keyboard's lower staff), or null for a drum staff. */
export function soundOf(score, lane) {
  if (!isLane(lane) || !score?.staves?.[lane]) return null;
  const staff = score.staves[M.upperOf(score, Number(lane))] ?? score.staves[lane];
  if (staff.drums || score.staves[lane].drums) return null;
  return staff.instrument || "acoustic grand";
}

/** The manifest's instruments that play `sound`, in its order. */
export const candidates = (manifest, sound) => (manifest?.instruments ?? []).filter((i) => Object.hasOwn(i.sounds, sound));

// A staff named as one desk of several, or in the plural: a section's.
const SECTION_NAME = /\b(i{1,3}|iv|[1-4]|violins|violons|violas|altos|cellos|violoncelles|section|tutti)\b/i;

/**
 * What lane `lane` plays of the built-in sounds: { instrument, start }
 * (`start`, the articulation it begins in), or null when it keeps its
 * General MIDI sound — the score says so, the staff does, no instrument
 * plays its sound, or it is on the synthesizer or a SoundFont of your own.
 *
 * Where a sound has a solo instrument and a section (the violin), the
 * section plays a staff that is one of several with that sound, or whose
 * name is a section's; the staff's own choice comes first.
 */
export function instrumentFor(manifest, score, lane) {
  if (!manifest || choiceOf(score) === "gm") return null;
  if (score.meta?.synth?.[lane] || score.meta?.soundfont?.[lane]) return null;
  const sound = soundOf(score, lane);
  const list = sound ? candidates(manifest, sound) : [];
  if (!list.length) return null;
  const own = laneChoice(score, lane);
  if (own === "gm") return null;
  let instrument = list.find((i) => i.id === own);
  if (!instrument) {
    const section = list.find((i) => i.id.endsWith("-section"));
    const solo = list.find((i) => !i.id.endsWith("-section")) ?? list[0];
    const upper = M.upperOf(score, Number(lane));
    const alike = new Set(score.staves.map((_, k) => M.upperOf(score, k)).filter((k) => soundOf(score, k) === sound)).size;
    instrument = section && (alike > 1 || SECTION_NAME.test(score.staves[upper]?.name ?? "")) ? section : solo;
  }
  return { instrument, start: instrument.sounds[sound] };
}

/**
 * What the score's staves play of the built-in sounds, given its channels
 * (score-model.js `channels`): `{ files, lanes }` — `files` the instruments
 * to load, `lanes` [{ lane, channel, instrument, start }], one a channel
 * (staves sharing a channel past the fifteenth play its first staff's).
 */
export function plan(manifest, score, channels) {
  const lanes = [];
  const taken = new Set();
  for (const { lane, channel } of channels) {
    if (taken.has(channel)) continue;
    const found = score ? instrumentFor(manifest, score, lane) : null;
    if (!found) continue;
    taken.add(channel);
    // Articulations follow the marks only where the staff has the channel to itself.
    const alone = channels.filter((c) => c.channel === channel && M.upperOf(score, c.lane) !== M.upperOf(score, lane)).length === 0;
    lanes.push({ lane, channel, ...found, alone });
  }
  const files = [...new Map(lanes.map((l) => [l.instrument.id, l.instrument])).values()];
  return { files, lanes };
}

// ---- Articulations --------------------------------------------------------------------------

/**
 * The articulation a note with `marks` (sound.js `onsetsOf`) is played in
 * on `instrument`, `start` when nothing says otherwise or the instrument
 * has no such samples: plucked from pizz. to arco, a tremolo, a staccato
 * (the strings' spiccato).
 */
export function articulationOf(marks, instrument, start = "sustain") {
  const has = (a) => instrument.articulations.includes(a);
  if (marks.has("pizz") && has("pizzicato")) return "pizzicato";
  if (marks.has("tremolo") && has("tremolo")) return "tremolo";
  if ((marks.has("staccato") || marks.has("staccatissimo")) && has("staccato") && start === "sustain") return "staccato";
  return start;
}

/**
 * Where lane `lane`'s staff changes articulation on `instrument`, in written
 * order: [[tick, program, bank]] as sound.js keeps program changes. Its
 * first note says its articulation too, `start` or not: a repeat that goes
 * back to it finds it again. None for an instrument with one articulation.
 */
export function switches(score, lane, instrument, start = "sustain") {
  if (instrument.articulations.length < 2) return [];
  const out = [];
  let now = null;
  let tick = -1;
  for (const note of Snd.onsetsOf(score, lane)) {
    if (note.tick === tick) continue;
    tick = note.tick;
    const next = articulationOf(note.marks, instrument, start);
    if (next !== now) out.push([tick, ARTICULATIONS.indexOf(next), instrument.offset]);
    now = next;
  }
  // Never left: the track's start says it all.
  return out.length === 1 && out[0][1] === ARTICULATIONS.indexOf(start) ? [] : out;
}

/** The channels of `bytes` (port × 16 + channel) that change program on the way: an instrument change in the score. */
export function changingChannels(bytes) {
  const seen = new Map();
  const smf = F.readSmf(bytes);
  for (const events of smf.tracks) {
    const port = Ch.portOf(events);
    for (const e of events) {
      if ((e.data[0] & 0xf0) !== 0xc0) continue;
      const channel = 16 * port + (e.data[0] & 15);
      if (!seen.has(channel)) seen.set(channel, new Set());
      seen.get(channel).add(e.data[1]);
    }
  }
  return new Set([...seen].filter(([, programs]) => programs.size > 1).map(([channel]) => channel));
}

/**
 * `bytes` (the MIDI of `score` as it is heard) with the staves of `lanes`
 * (`plan`'s, those whose bank is loaded) on their built-in instruments: the
 * staff's track begins on the instrument's bank, in its first articulation,
 * and changes program where the articulation does (`passes`: every repeat
 * played out; `early`, ms: how early humanize may strike a note). A staff
 * that changes instrument on the way keeps its General MIDI sounds.
 */
export function apply(score, bytes, lanes, { passes = null, early = 0 } = {}) {
  if (!lanes?.length) return bytes;
  const changing = changingChannels(bytes);
  const played = lanes.filter((l) => !changing.has(l.channel));
  if (!played.length) return bytes;
  const out = Sb.applyPresets(bytes, played.map((l) => ({ channel: l.channel, bank: l.instrument.offset, program: ARTICULATIONS.indexOf(l.start) })));
  if (!score) return out;
  const ks = {};
  for (const l of played) {
    const programs = l.alone ? switches(score, l.lane, l.instrument, l.start) : [];
    if (programs.length) ks[l.lane] = { programs };
  }
  if (!Object.keys(ks).length) return out;
  // The program changes go in as a staff's own do (sound.js): through a copy of the score that holds only these.
  const { ksmaps, ksopt, ...meta } = score.meta ?? {};
  const copy = { ...score, meta: { ...meta, ks } };
  // Past fifteen staves, what a staff keeps decides who shares a channel: the copy must leave every staff where it is.
  if (JSON.stringify(M.channels(copy)) !== JSON.stringify(M.channels(score))) return out;
  return Snd.applySound(copy, out, { passes, early });
}

// ---- Loading --------------------------------------------------------------------------------

let manifestRead = null;
// The banks in this tab: id → ArrayBuffer; and those on their way: id → Promise.
const loaded = new Map();
const loading = new Map();
const failed = new Set();

/** The manifest, read once a tab: null when the site has none (then every staff plays General MIDI). */
export function manifest({ fetch = globalThis.fetch, url = MANIFEST } = {}) {
  manifestRead ??= (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return readManifest(await response.json(), url);
    } catch (error) {
      return null;
    }
  })().then((read) => {
    // Not there this time (offline): asked again on the next Play.
    if (!read) manifestRead = null;
    return read;
  });
  return manifestRead;
}

/** Uses `json` as the manifest from now on (the specs' tiny instrument); null reads the site's again. */
export function useManifest(json, at = MANIFEST) {
  manifestRead = json == null ? null : Promise.resolve(readManifest(json, at));
  loaded.clear();
  loading.clear();
  failed.clear();
  return manifestRead;
}

/** True when `instrument`'s bank is in this tab. */
export const isLoaded = (instrument) => loaded.has(instrument.id);

const hex = (bytes) => [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** True when `buffer` is the file the manifest names; where the browser cannot tell (plain http), it is taken as it is. */
async function genuine(instrument, buffer) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return true;
  return hex(await subtle.digest("SHA-256", buffer)) === instrument.sha256;
}

async function openCache(storage) {
  try {
    return (await storage?.open(CACHE)) ?? null;
  } catch (error) {
    return null; // no Cache Storage (plain http, a private window): the HTTP cache only
  }
}

/** True when `instrument`'s bank is in this tab or kept in this browser: it loads without the network. */
export async function isKept(instrument, { caches = globalThis.caches } = {}) {
  if (loaded.has(instrument.id)) return true;
  const cache = await openCache(caches);
  try {
    return Boolean(await cache?.match(instrument.url));
  } catch (error) {
    return false;
  }
}

/**
 * `instrument`'s bank (an ArrayBuffer): from this tab, from Cache Storage,
 * or downloaded — `onProgress(received)` in bytes as it comes — checked
 * against the manifest's digest, and kept. Null when it cannot be had
 * (offline, not on this site, not the file named): its staves play General
 * MIDI. A failed download is tried again on the next Play.
 */
export function bank(instrument, { onProgress = null, fetch = globalThis.fetch, caches = globalThis.caches } = {}) {
  if (loaded.has(instrument.id)) return Promise.resolve(loaded.get(instrument.id));
  if (loading.has(instrument.id)) return loading.get(instrument.id);
  const job = (async () => {
    const cache = await openCache(caches);
    try {
      const hit = await cache?.match(instrument.url);
      if (hit) {
        const kept = await hit.arrayBuffer();
        if (await genuine(instrument, kept)) return kept;
        await cache.delete(instrument.url);
      }
    } catch (error) {}
    const response = await fetch(instrument.url);
    if (!response.ok) throw new Error(`${instrument.file}: ${response.status}`);
    let buffer;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        onProgress?.(received);
      }
      const bytes = new Uint8Array(received);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.length;
      }
      buffer = bytes.buffer;
    } else buffer = await response.arrayBuffer();
    if (!(await genuine(instrument, buffer))) throw new Error(`${instrument.file}: not the file the manifest names`);
    try {
      await cache?.put(instrument.url, new Response(buffer.slice(0), { headers: { "content-type": "audio/x-soundfont" } }));
      // An older version of this instrument goes.
      const mine = new URL(instrument.url);
      const prefix = mine.pathname.slice(0, mine.pathname.lastIndexOf("/") + 1) + instrument.id + ".";
      for (const kept of (await cache?.keys()) ?? []) {
        const url = new URL(kept.url);
        if (url.pathname.startsWith(prefix) && url.pathname !== mine.pathname) await cache.delete(kept);
      }
    } catch (error) {}
    return buffer;
  })().then(
    (buffer) => {
      loaded.set(instrument.id, buffer);
      failed.delete(instrument.id);
      loading.delete(instrument.id);
      return buffer;
    },
    () => {
      failed.add(instrument.id);
      loading.delete(instrument.id);
      return null;
    }
  );
  loading.set(instrument.id, job);
  return job;
}

/** How long Play waits for a bank that is not in the browser yet, in ms: after that it plays General MIDI. */
export const PATIENCE = 2500;

/** The megabytes of `bytes`, as shown: "4.2". */
export const megabytes = (bytes) => (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0);

/**
 * The score's built-in instruments made ready on player `P` (player.js):
 * answers `{ lanes, pending, missing, done }`.
 *
 * - `lanes`: the staves to play on them now (`apply`), their banks given to
 *   the synthesizer;
 * - `pending`: the instruments still downloading — their staves play General
 *   MIDI this time. With `wait` (Save the sound) there are none: every bank
 *   is waited for; with `until` (a promise: the default sounds loading on a
 *   first Play) they are waited for as long as it takes, and with
 *   `patience` (ms) that much longer at most;
 * - `missing`: those that could not be had;
 * - `done`: a promise for the downloads started here, answering how many
 *   came (`onProgress({ received, total, count })` while they do).
 *
 * A bank kept in this browser is waited for either way: it is there at once.
 */
export async function prepare(P, score, channels, { wait = false, until = null, patience = 0, onProgress = null, io = {} } = {}) {
  const none = { lanes: [], pending: [], missing: [], done: Promise.resolve(0) };
  if (!score || choiceOf(score) === "gm") return none;
  const read = await manifest(io);
  if (!read) return none;
  const wanted = plan(read, score, channels);
  if (!wanted.files.length) return none;
  const pending = [];
  const received = new Map();
  const total = () => pending.reduce((sum, i) => sum + i.size, 0);
  const tell = () => onProgress?.({ received: [...received.values()].reduce((a, b) => a + b, 0), total: total(), count: pending.length });
  const jobs = [];
  for (const instrument of wanted.files) {
    if (loaded.has(instrument.id)) continue;
    const kept = await isKept(instrument, io);
    if (!kept) pending.push(instrument);
    const job = bank(instrument, {
      ...io,
      onProgress: (n) => {
        received.set(instrument.id, n);
        tell();
      },
    });
    if (kept || wait) await job;
    else jobs.push(job);
  }
  const done = Promise.all(jobs).then((got) => got.filter(Boolean).length);
  // Something else is waited for anyway (the default sounds, on a first Play): what comes meanwhile is played.
  if (until && jobs.length) await Promise.race([done, Promise.resolve(until).catch(() => {})]);
  // And a little longer: a bank nearly there is worth a moment's wait, a slow line is not.
  if (patience > 0 && jobs.length) await Promise.race([done, new Promise((resolve) => setTimeout(resolve, patience))]);
  for (const instrument of wanted.files) {
    const buffer = loaded.get(instrument.id);
    if (buffer) await P.useBank(`orchestra:${instrument.id}`, buffer, instrument.offset);
  }
  return {
    lanes: wanted.lanes.filter((l) => loaded.has(l.instrument.id)),
    pending: pending.filter((i) => !loaded.has(i.id) && !failed.has(i.id)),
    missing: wanted.files.filter((i) => failed.has(i.id)),
    done,
  };
}
