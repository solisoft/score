// Sound: what a virtual instrument (a library hosted in a DAW, reached
// through "Sound to", or a saved MIDI file) is sent besides the notes, to
// choose how they sound — keyswitches, program changes, and the keyswitches
// an articulation map derives from the marks written (#670). None of it is
// notation: nothing is engraved, nothing is a note of the score (the piano
// roll, MusicXML, LilyPond, practice and follow never see them).
//
// Kept in the score's text, on its `%% eui-score` line:
//
//   %% eui-score {"ks":{"0":{"keys":[[0,12],[7680,14]],"programs":[[0,40,0,2]],"map":"m1"}},
//                 "ksmaps":{"m1":{"name":"Violins","default":{"key":12},"rules":[{"mark":"pizz","key":17}]}},
//                 "ksopt":{"lead":20,"velocity":1}}
//
// - `ks`: { "<lane>": { keys, programs, map } }, the staff's lane as the
//   curves have it (automation.js), every voice of the staff on its channel;
//   - `keys`: keyswitches, [[tick, key]] — a note 0–127 sent shortly
//     before `tick` (score ticks, score-model.js WHOLE to a whole note);
//   - `programs`: program changes, [[tick, program, msb, lsb]] — 0–127,
//     the bank's MSB (CC 0) and LSB (CC 32) when given, else left out;
//   - `map`: the id of the articulation map the staff follows (`ksmaps`);
// - `ksmaps`: the score's articulation maps, { id: { name, default, rules } }
//   — a rule { mark, key, cc, value } sends `key` (a keyswitch) and/or CC
//   `cc` at `value` before each note that carries `mark`; `default` is sent
//   when a note carries none of the rules' marks again (arco, sustain);
// - `ksopt`: { lead, velocity } — how early a keyswitch or a program change
//   goes before its note, in ms (20), and a keyswitch's velocity (1).
//
// Sent: on Play to the MIDI device of "Sound to", and into Save as MIDI, on
// the staff's channel, in its track. Never to this browser's synthesizer —
// a keyswitch is a low note there, a program change another instrument: Play
// in the browser and Save the sound leave them out (studio-playback.js).
//
// No DOM here (the lane's events are sound-ui.js's): tests/js/sound.test.mjs.

const SEARCH = new URL(import.meta.url).search;
const M = await import(`./score-model.js${SEARCH}`);
const F = await import(`./feel.js${SEARCH}`);
const A = await import(`./automation.js${SEARCH}`);
const R = await import(`./piano-roll.js${SEARCH}`);
const { tr } = await import(`./words.js${SEARCH}`);

// A catalogue's names are data, and stay English until shown (automation.js).
const english = { tr: (text) => text };

/** How early a keyswitch goes before its note, in ms, when the score says nothing. */
export const LEAD_MS = 20;
export const LEAD_MAX = 500;
/** A keyswitch's velocity when the score says nothing: the softest a note-on can be. */
export const VELOCITY = 1;

/**
 * The marks an articulation map can follow: a note's articulations, its
 * tremolo, a trill, a slur over it (legato), and the playing techniques
 * written as words over the staff — pizz. until arco, sul pont. (or sul
 * tasto) until ord., con sord. until senza sord.
 */
export const MARKS = [
  { id: "staccato", name: english.tr("Staccato") },
  { id: "staccatissimo", name: english.tr("Staccatissimo") },
  { id: "tenuto", name: english.tr("Tenuto") },
  { id: "portato", name: english.tr("Portato") },
  { id: "accent", name: english.tr("Accent") },
  { id: "marcato", name: english.tr("Marcato") },
  { id: "tremolo", name: english.tr("Tremolo") },
  { id: "trill", name: english.tr("Trill") },
  { id: "legato", name: english.tr("Legato (under a slur)") },
  { id: "pizz", name: english.tr("pizz.") },
  { id: "arco", name: english.tr("arco") },
  { id: "sulpont", name: english.tr("sul ponticello") },
  { id: "sultasto", name: english.tr("sul tasto") },
  { id: "consord", name: english.tr("con sordino") },
  { id: "senzasord", name: english.tr("senza sordino") },
];
const MARK_IDS = new Set(MARKS.map((m) => m.id));
/** The articulations of score-model.js a mark is read from. */
const ART_MARKS = ["staccato", "staccatissimo", "tenuto", "portato", "accent", "marcato", "trill"];

/** A mark's name in the page's language. */
export function markName(id) {
  const mark = MARKS.find((m) => m.id === id);
  return mark ? tr(mark.name) : String(id);
}

// ---- Read and kept ----------------------------------------------------------------------

const isObject = (x) => x && typeof x === "object" && !Array.isArray(x);
/** A whole number in min…max, or null for anything else (no number, nothing). */
const whole = (v, min, max) => {
  if (v == null || v === "" || typeof v === "boolean") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const tickOf = (t) => whole(t, 0, Number.MAX_SAFE_INTEGER);

/** Keyswitches as kept: [[tick, key]], sorted, one a tick (the last given wins). */
export function normalizeKeys(list) {
  const byTick = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    if (!Array.isArray(item)) continue;
    const tick = tickOf(item[0]);
    const key = whole(item[1], 0, 127);
    if (tick == null || key == null) continue;
    byTick.set(tick, [tick, key]);
  }
  return [...byTick.values()].sort((a, b) => a[0] - b[0]);
}

/** Program changes as kept: [[tick, program, msb?, lsb?]], sorted, one a tick; an LSB without an MSB keeps a null MSB. */
export function normalizePrograms(list) {
  const byTick = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    if (!Array.isArray(item)) continue;
    const tick = tickOf(item[0]);
    const program = whole(item[1], 0, 127);
    if (tick == null || program == null) continue;
    const msb = whole(item[2], 0, 127);
    const lsb = whole(item[3], 0, 127);
    byTick.set(tick, lsb != null ? [tick, program, msb, lsb] : msb != null ? [tick, program, msb] : [tick, program]);
  }
  return [...byTick.values()].sort((a, b) => a[0] - b[0]);
}

const MAP_ID = /^[A-Za-z0-9_-]{1,40}$/;

/** A send as kept: { key, cc, value }, each there only when it is a number in range; null when it sends nothing. */
function sendOf(raw) {
  if (!isObject(raw)) return null;
  const key = whole(raw.key, 0, 127);
  const cc = whole(raw.cc, 0, 127);
  const value = whole(raw.value, 0, 127);
  const out = {};
  if (key != null) out.key = key;
  if (cc != null && value != null) Object.assign(out, { cc, value });
  return Object.keys(out).length ? out : null;
}

/** An articulation map as kept: { name, default?, rules: [{ mark, key?, cc?, value? }] }; a rule that sends nothing goes. */
export function normalizeMap(raw) {
  if (!isObject(raw)) return null;
  const name = String(raw.name ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60) || tr("Articulation map");
  const rules = [];
  for (const rule of Array.isArray(raw.rules) ? raw.rules.slice(0, 64) : []) {
    if (!isObject(rule) || !MARK_IDS.has(rule.mark)) continue;
    const send = sendOf(rule);
    if (send) rules.push({ mark: rule.mark, ...send });
  }
  const out = { name, rules };
  const fallback = sendOf(raw.default);
  if (fallback) out.default = fallback;
  return out;
}

/** The score's keyswitches, program changes and map choices: { lane: { keys, programs, map } }, as read from its text, cleaned. */
export function soundsOf(score) {
  const kept = score?.meta?.ks;
  if (!isObject(kept)) return {};
  const out = {};
  for (const [lane, sounds] of Object.entries(kept)) {
    if (!/^\d+$/.test(lane) || !isObject(sounds)) continue;
    const mine = {};
    const keys = normalizeKeys(sounds.keys);
    const programs = normalizePrograms(sounds.programs);
    if (keys.length) mine.keys = keys;
    if (programs.length) mine.programs = programs;
    if (typeof sounds.map === "string" && MAP_ID.test(sounds.map)) mine.map = sounds.map;
    if (Object.keys(mine).length) out[lane] = mine;
  }
  return out;
}

/** Lane `lane`'s sounds: { keys, programs, map } ([] and null when none). */
export function soundOf(score, lane) {
  const mine = soundsOf(score)[lane] ?? {};
  return { keys: mine.keys ?? [], programs: mine.programs ?? [], map: mine.map ?? null };
}

/** Lane `lane`'s sounds with `patch` ({ keys?, programs?, map? }) laid over them, kept in the score; emptied, gone. */
export function setSound(score, lane, patch) {
  if (!/^\d+$/.test(String(lane))) throw new Error(`No such lane: ${lane}`);
  const all = { ...soundsOf(score) };
  const was = soundOf(score, lane);
  const next = {
    keys: normalizeKeys(patch.keys ?? was.keys),
    programs: normalizePrograms(patch.programs ?? was.programs),
    map: "map" in patch ? patch.map : was.map,
  };
  const mine = {};
  if (next.keys.length) mine.keys = next.keys;
  if (next.programs.length) mine.programs = next.programs;
  if (typeof next.map === "string" && MAP_ID.test(next.map)) mine.map = next.map;
  if (Object.keys(mine).length) all[lane] = mine;
  else delete all[lane];
  score.meta = { ...(score.meta ?? {}) };
  if (Object.keys(all).length) score.meta.ks = all;
  else delete score.meta.ks;
  return soundOf(score, lane);
}

/** The score's articulation maps: { id: map }, cleaned. */
export function mapsOf(score) {
  const kept = score?.meta?.ksmaps;
  if (!isObject(kept)) return {};
  const out = {};
  for (const [id, raw] of Object.entries(kept)) {
    if (!MAP_ID.test(id)) continue;
    const map = normalizeMap(raw);
    if (map) out[id] = map;
  }
  return out;
}

/**
 * Map `id` kept in the score as `map` (cleaned); null takes it away, and
 * the staves that followed it follow none. Answers the map kept.
 */
export function setMap(score, id, map) {
  if (!MAP_ID.test(String(id))) throw new Error(`No such map: ${id}`);
  const all = { ...mapsOf(score) };
  const kept = map == null ? null : normalizeMap(map);
  if (kept) all[id] = kept;
  else delete all[id];
  score.meta = { ...(score.meta ?? {}) };
  if (Object.keys(all).length) score.meta.ksmaps = all;
  else delete score.meta.ksmaps;
  if (!kept) for (const [lane, sounds] of Object.entries(soundsOf(score))) if (sounds.map === id) setSound(score, lane, { map: null });
  return kept;
}

/** A new map's id: one the score does not use. */
export function newMapId(score, seed = Date.now()) {
  const taken = new Set(Object.keys(mapsOf(score)));
  let n = Math.abs(Math.round(Number(seed) || 0)) % 1e9;
  while (taken.has(`m${n.toString(36)}`)) n++;
  return `m${n.toString(36)}`;
}

/** How keyswitches are sent: { lead (ms), velocity }. */
export function optionsOf(score) {
  const kept = isObject(score?.meta?.ksopt) ? score.meta.ksopt : {};
  return { lead: whole(kept.lead, 0, LEAD_MAX) ?? LEAD_MS, velocity: whole(kept.velocity, 1, 127) ?? VELOCITY };
}

/** The options set (the defaults are not written). */
export function setOptions(score, { lead, velocity }) {
  const was = optionsOf(score);
  const next = { lead: whole(lead, 0, LEAD_MAX) ?? was.lead, velocity: whole(velocity, 1, 127) ?? was.velocity };
  const kept = {};
  if (next.lead !== LEAD_MS) kept.lead = next.lead;
  if (next.velocity !== VELOCITY) kept.velocity = next.velocity;
  score.meta = { ...(score.meta ?? {}) };
  if (Object.keys(kept).length) score.meta.ksopt = kept;
  else delete score.meta.ksopt;
  return next;
}

// ---- The starter map --------------------------------------------------------------------

/**
 * The one map offered ready-made: a template, its notes plainly arbitrary —
 * one after another from C0 (MIDI note 12, middle C being C4), the default
 * first. No library's real chart: a wrong one would mislead. Its
 * description says to match it to the library's own.
 */
export const TEMPLATE = {
  name: english.tr("Keyswitches from C0 (template)"),
  description: english.tr("An example to start from: its notes are arbitrary, one after another from C0 (MIDI note 12; middle C is C4). Match each one to your library's own keyswitch chart before you rely on it."),
  default: { key: 12 },
  rules: [
    { mark: "pizz", key: 13 },
    { mark: "tremolo", key: 14 },
    { mark: "trill", key: 15 },
    { mark: "sulpont", key: 16 },
    { mark: "consord", key: 17 },
    { mark: "marcato", key: 18 },
    { mark: "accent", key: 19 },
    { mark: "staccatissimo", key: 20 },
    { mark: "staccato", key: 21 },
    { mark: "tenuto", key: 22 },
    { mark: "legato", key: 23 },
  ],
};

/** The template as a map to keep, named in the page's language. */
export function templateMap() {
  return normalizeMap({ ...structuredClone(TEMPLATE), name: tr(TEMPLATE.name) });
}

// ---- The marks of a staff's notes -------------------------------------------------------

const WORDS = [
  { test: /\bpizz/, set: { bow: "pizz" } },
  { test: /\barco\b/, set: { bow: "arco" } },
  { test: /\bsul\s*pont/, set: { place: "sulpont" } },
  { test: /\bsul\s*tasto/, set: { place: "sultasto" } },
  { test: /(^|[\s(])(ord|ordin|ordinario|nat|naturale|norm|normale|modo\s+ordinario)\b\.?/, set: { place: null } },
  { test: /\bcon\s*sord/, set: { mute: "consord" } },
  { test: /\bsenza\s*sord/, set: { mute: "senzasord" } },
];

/** What words over a note change in how it is played: { bow?, place?, mute? }. */
export function techniqueOf(text) {
  const words = String(text ?? "").toLowerCase();
  const out = {};
  for (const w of WORDS) if (w.test.test(words)) Object.assign(out, w.set);
  return out;
}

/**
 * Lane `lane`'s staff's notes as struck, each with its marks: [{ tick,
 * voice, marks: Set }] in written order — a tied note's continuation is
 * not struck again; grace notes ride with their note. The words (pizz.,
 * arco…) count from where they are written, on any voice, a rest too.
 */
export function onsetsOf(score, lane) {
  const upper = M.upperOf(score, lane);
  const lanes = M.voiceLanes(score, upper).filter((l) => score.staves[l] && !score.staves[l].chords && !score.staves[l].padding);
  const changes = [];
  const notes = [];
  lanes.forEach((l, voice) => {
    const events = score.staves[l].events;
    const at = M.starts(score.staves[l]);
    let tied = false;
    let slur = false;
    events.forEach((ev, i) => {
      for (const t of ev.texts ?? []) {
        const change = techniqueOf(t.text);
        if (Object.keys(change).length) changes.push({ tick: at[i], change });
      }
      if (ev.rest) {
        tied = false;
        return;
      }
      const legato = slur || ev.slurStart;
      if (ev.slurStart) slur = true;
      if (ev.slurEnd) slur = false;
      if (!tied) {
        const marks = new Set((ev.arts ?? []).filter((a) => ART_MARKS.includes(a)));
        if (ev.tremolo) marks.add("tremolo");
        if (legato) marks.add("legato");
        notes.push({ tick: at[i], voice, marks });
      }
      tied = Boolean(ev.tie);
    });
  });
  changes.sort((a, b) => a.tick - b.tick);
  notes.sort((a, b) => a.tick - b.tick || a.voice - b.voice);
  const state = { bow: null, place: null, mute: null };
  let k = 0;
  for (const note of notes) {
    while (k < changes.length && changes[k].tick <= note.tick) Object.assign(state, changes[k++].change);
    for (const value of Object.values(state)) if (value) note.marks.add(value);
  }
  return notes;
}

/** The rule of `map` a note with `marks` follows: its index (the first rule whose mark it carries), −1 for the default. */
export function ruleFor(map, marks) {
  return map.rules.findIndex((r) => marks.has(r.mark));
}

/**
 * Where `map` asks for a change on lane `lane`'s staff, in written order:
 * [{ tick, rule }] — a note whose rule is not the one before it; the first
 * note always. Voices struck together: the first voice's rule.
 */
export function mapChanges(score, lane, map) {
  const out = [];
  let last;
  let tick = -1;
  for (const note of onsetsOf(score, lane)) {
    if (note.tick === tick) continue;
    tick = note.tick;
    const rule = ruleFor(map, note.marks);
    if (rule !== last) out.push({ tick, rule });
    last = rule;
  }
  return out;
}

/** What rule `rule` of `map` sends ({ key?, cc?, value? }), the default for −1; null for nothing. */
export function sendFor(map, rule) {
  const send = rule < 0 ? map.default : map.rules[rule];
  if (!send) return null;
  const out = {};
  if (send.key != null) out.key = send.key;
  if (send.cc != null) Object.assign(out, { cc: send.cc, value: send.value });
  return Object.keys(out).length ? out : null;
}

// ---- The events sent ------------------------------------------------------------------

/**
 * Everything the score sends besides its notes, in the order it is sent,
 * every repeat played out: [{ at, channel, lane, kind, … }] — `at` in the
 * score's ticks from the start as played (a fermata's hold counted, as
 * automation.js's curves); `kind` "program" ({ program, msb, lsb }), "cc"
 * ({ number, value }) or "key" ({ key }). At one tick: the program, then a
 * controller, then the keyswitch.
 *
 * A marker is sent on every pass through its bar. A map sends where its
 * rule changes; a keyswitch placed by hand wins at its tick, and holds
 * until the map's rule next changes. Where a repeat jumps, what the written
 * music has in effect there is sent again when it is not what was sent last.
 */
export function soundEvents(score, { passes = M.playback(score) } = {}) {
  const sounds = soundsOf(score);
  const lanes = Object.keys(sounds);
  if (!lanes.length) return [];
  const maps = mapsOf(score);
  const channelOf = new Map(M.channels(score).map((c) => [c.lane, c.channel]));
  const starts = [];
  let total = 0;
  for (const p of passes) {
    starts.push(total);
    total += M.passTicks(score, p);
  }
  const out = [];
  for (const laneText of lanes) {
    const lane = Number(laneText);
    const channel = channelOf.get(lane);
    if (channel == null) continue;
    const { keys = [], programs = [], map: mapId } = sounds[laneText];
    const map = mapId ? maps[mapId] : null;
    const changes = map ? mapChanges(score, lane, map) : [];
    const handKeys = new Set(keys.map(([t]) => t));
    // What the written music has in effect just before `from`: the last program, and the last keyswitch sent (by hand or by the map).
    const programBefore = (from) => programs.filter(([t]) => t < from).at(-1) ?? null;
    const keyBefore = (from) => {
      const hand = keys.filter(([t]) => t < from).at(-1);
      const change = changes.filter((c) => c.tick < from).at(-1);
      if (change && (!hand || change.tick > hand[0])) return { send: sendFor(map, change.rule), rule: change.rule };
      return hand ? { send: { key: hand[1] }, rule: change?.rule } : change ? { send: null, rule: change.rule } : null;
    };
    let lastProgram = null;
    let lastSend = null;
    let lastRule;
    const emit = (at, send) => {
      if (!send) return;
      if (send.cc != null) out.push({ at, channel, lane, kind: "cc", number: send.cc, value: send.value, order: 1 });
      if (send.key != null) out.push({ at, channel, lane, kind: "key", key: send.key, order: 2 });
      lastSend = JSON.stringify(send);
    };
    const sendProgram = (at, p) => {
      out.push({ at, channel, lane, kind: "program", program: p[1], msb: p[2] ?? null, lsb: p[3] ?? null, order: 0 });
      lastProgram = JSON.stringify(p.slice(1));
    };
    passes.forEach((p, k) => {
      const from = M.barStart(score, p.bar);
      const to = M.barStart(score, p.bar + 1);
      const place = (tick) => {
        const into = tick - from;
        const held = p.holds.filter((h) => h.at <= into).reduce((sum, h) => sum + h.ticks, 0);
        return starts[k] + into + held;
      };
      if (k > 0 && p.bar !== passes[k - 1].bar + 1) {
        // A jump: the state the written music has here, sent again when it is not what was sent last.
        const program = programBefore(from);
        if (program && !programs.some(([t]) => t === from) && JSON.stringify(program.slice(1)) !== lastProgram) sendProgram(place(from), program);
        const was = keyBefore(from);
        if (was) {
          lastRule = was.rule;
          if (was.send && !handKeys.has(from) && JSON.stringify(was.send) !== lastSend) emit(place(from), was.send);
        }
      }
      const ticks = new Set([...programs.map(([t]) => t), ...keys.map(([t]) => t), ...changes.map((c) => c.tick)].filter((t) => t >= from && t < to));
      for (const tick of [...ticks].sort((a, b) => a - b)) {
        const at = place(tick);
        const program = programs.find(([t]) => t === tick);
        if (program) sendProgram(at, program);
        const hand = keys.find(([t]) => t === tick);
        const change = changes.find((c) => c.tick === tick);
        if (hand) emit(at, { key: hand[1] });
        else if (change && change.rule !== lastRule) emit(at, sendFor(map, change.rule));
        if (change) lastRule = change.rule;
      }
    });
  }
  return out.sort((x, y) => x.at - y.at || x.channel - y.channel || x.order - y.order).map(({ order, ...e }) => e);
}

// ---- Into the MIDI file -----------------------------------------------------------------

/** The file's tempo as a clock: seconds at a tick, and the tick at a second. */
export function clockOf(smf) {
  const changes = smf.tracks
    .flat()
    .filter((e) => e.data[0] === 0xff && e.data[1] === 0x51)
    .map((e) => ({ tick: e.tick, us: (e.data[3] << 16) | (e.data[4] << 8) | e.data[5] }))
    .sort((a, b) => a.tick - b.tick);
  // From the start: 120 a quarter until the first tempo, as MIDI says.
  const steps = [{ tick: 0, us: 500000, sec: 0 }];
  for (const c of changes) {
    const last = steps.at(-1);
    const sec = last.sec + ((c.tick - last.tick) * last.us) / 1e6 / smf.division;
    if (c.tick === last.tick) last.us = c.us;
    else steps.push({ tick: c.tick, us: c.us, sec });
  }
  const secAt = (tick) => {
    const s = steps.findLast((x) => x.tick <= tick) ?? steps[0];
    return s.sec + ((tick - s.tick) * s.us) / 1e6 / smf.division;
  };
  const tickAt = (sec) => {
    if (sec <= 0) return 0;
    const s = steps.findLast((x) => x.sec <= sec) ?? steps[0];
    return s.tick + ((sec - s.sec) * 1e6 * smf.division) / s.us;
  };
  return { secAt, tickAt };
}

/**
 * `bytes` (the MIDI of `score` as it is heard: velocities, curves, feel and
 * practice applied) with the score's keyswitches and program changes in
 * it, each `lead` ms (ksopt) before its note — a copy, the same bytes when
 * there is nothing to send. `early` (ms): how early humanize may strike a
 * note (feel.js), so its keyswitch still comes first.
 *
 * A keyswitch is a note-on at the score's velocity (ksopt), let go when its
 * note starts; a program change its bank (CC 0, CC 32) first.
 */
export function applySound(score, bytes, { passes = null, early = 0 } = {}) {
  if (!score || !Object.keys(soundsOf(score)).length) return bytes;
  const events = soundEvents(score, { passes: passes?.length ? passes : M.playback(score) });
  if (!events.length) return bytes;
  const smf = F.readSmf(bytes);
  const { trackOf, ports } = A.channelTracks(smf);
  const ratio = M.WHOLE / 4 / smf.division;
  const clock = clockOf(smf);
  const { lead, velocity } = optionsOf(score);
  // Each channel's notes struck, by tick: where humanize may have moved one earlier.
  const struck = new Map();
  smf.tracks.forEach((track, k) => {
    for (const e of track) {
      if ((e.data[0] & 0xf0) !== 0x90 || !e.data[2]) continue;
      const channel = ports[k] + (e.data[0] & 15);
      if (!struck.has(channel)) struck.set(channel, []);
      struck.get(channel).push(e.tick);
    }
  });
  const added = new Map();
  const add = (channel, tick, data) => {
    if (!added.has(channel)) added.set(channel, []);
    added.get(channel).push({ tick, data });
  };
  for (const e of events) {
    const c = e.channel & 15;
    let at = e.at / ratio;
    // Humanized: the note it goes before may be struck up to `early` ms before its tick.
    if (early > 0) {
      const from = clock.tickAt(clock.secAt(at) - early / 1000);
      at = Math.min(at, ...(struck.get(e.channel) ?? []).filter((t) => t >= from && t <= at));
    }
    const on = Math.max(0, Math.min(at, Math.floor(clock.tickAt(clock.secAt(at) - lead / 1000))));
    if (e.kind === "program") {
      if (e.msb != null) add(e.channel, on, [0xb0 | c, 0, e.msb]);
      if (e.lsb != null) add(e.channel, on, [0xb0 | c, 32, e.lsb]);
      add(e.channel, on, [0xc0 | c, e.program]);
    } else if (e.kind === "cc") add(e.channel, on, [0xb0 | c, e.number, e.value]);
    else {
      add(e.channel, on, [0x90 | c, e.key, velocity]);
      add(e.channel, Math.max(on + 1, Math.round(at)), [0x80 | c, e.key, 0]);
    }
  }
  for (const list of added.values()) list.forEach((e, k) => (e.order = k));
  for (const list of added.values()) {
    list.sort((x, y) => x.tick - y.tick || x.order - y.order);
    for (const e of list) delete e.order;
  }
  return F.writeSmf(A.addToChannels(smf, trackOf, added));
}

// ---- The lane under the roll ------------------------------------------------------------

export const LANE_H = A.LANE_H;
/** The lane's rows: the keyswitches, the program changes, and (drawn only) what the map sends. */
export const ROWS = { keys: { top: 4, h: 24 }, programs: { top: 30, h: 24 }, map: { top: 56, h: 24 } };

/** The row under `y`: "keys", "programs", "map", or null. */
export function rowAt(y) {
  for (const [name, row] of Object.entries(ROWS)) if (y >= row.top && y < row.top + row.h) return name;
  return null;
}

/** The marker of `list` ([[tick, …]]) under `px`, within 7 px: its index, or −1. */
export function markerAt(geo, list, px) {
  let best = -1;
  let bestD = 7;
  list.forEach(([t], k) => {
    const d = Math.abs(geo.x(t) - px);
    if (d <= bestD) {
      bestD = d;
      best = k;
    }
  });
  return best;
}

/** A key as the lane names it: "C0 (12)". */
export function keyText(key) {
  return `${R.keyName(key)} (${key})`;
}

/** A program change as the lane names it: "P40", its bank after. */
export function programText([, program, msb, lsb]) {
  const bank = msb != null || lsb != null ? ` ${tr("bank {msb}/{lsb}", { msb: msb ?? "–", lsb: lsb ?? "–" })}` : "";
  return `P${program}${bank}`;
}

const escape = (text) => String(text).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

/** What a send says, short: "C0", "CC 21=64", both. */
function sendText(send) {
  if (!send) return "";
  return [send.key != null ? R.keyName(send.key) : "", send.cc != null ? `CC ${send.cc}=${send.value}` : ""].filter(Boolean).join(" ");
}

/**
 * The lane as SVG for the roll's layout `geo`: lane `lane`'s keyswitches
 * and program changes as flags on their rows (`chosen`: { row, index }
 * outlined), and on the third row, pale, what its map sends — drawn only.
 */
export function drawLane(score, geo, lane, { label = "", colour = "#2563c9", chosen = null, view = null } = {}) {
  const mine = view ?? soundOf(score, lane);
  const map = mine.map ? mapsOf(score)[mine.map] : null;
  const parts = [`<rect class="cc-bg" x="${geo.left}" y="0" width="${geo.width - geo.left}" height="${LANE_H}"/>`];
  for (const row of Object.values(ROWS)) parts.push(`<line class="cc-grid" x1="${geo.left}" x2="${geo.width}" y1="${row.top + row.h}" y2="${row.top + row.h}"/>`);
  for (let bar = 0; bar <= geo.bars; bar++) {
    const bx = geo.x(M.barStart(score, bar));
    parts.push(`<line class="cc-bar-line" x1="${bx}" x2="${bx}" y1="0" y2="${LANE_H}"/>`);
  }
  // The rows' names in the margin, cut to fit it (whole in their tip).
  const room = Math.max(4, Math.floor((geo.left - 8) / 6));
  const rowName = (row, name) => {
    const short = name.length > room ? `${name.slice(0, room - 1)}…` : name;
    return `<text class="ks-row-name" x="4" y="${ROWS[row].top + 16}"><title>${escape(name)}</title>${escape(short)}</text>`;
  };
  parts.push(rowName("keys", tr("Keyswitches")), rowName("programs", tr("Programs")), rowName("map", map ? map.name : tr("No map")));
  if (label) parts.push(`<title>${escape(label)}</title>`);
  const flag = (row, k, t, text, kind) => {
    const x = geo.x(t);
    const top = ROWS[row].top + 3;
    const on = chosen && chosen.row === row && chosen.index === k;
    return `<g class="ks-marker ks-${kind}${on ? " ks-chosen" : ""}" data-ks-row="${row}" data-ks-index="${k}"><line x1="${x}" x2="${x}" y1="${top}" y2="${top + 18}" stroke="${colour}"/><rect x="${x}" y="${top}" width="${Math.max(18, text.length * 6.2 + 6)}" height="14" rx="3" fill="${colour}"/><text x="${x + 3}" y="${top + 11}">${escape(text)}</text></g>`;
  };
  mine.keys.forEach(([t, key], k) => parts.push(flag("keys", k, t, R.keyName(key), "key")));
  mine.programs.forEach((p, k) => parts.push(flag("programs", k, p[0], programText(p), "program")));
  if (map) {
    for (const change of mapChanges(score, lane, map)) {
      const text = sendText(sendFor(map, change.rule));
      if (text) parts.push(`<g class="ks-mapped"><title>${escape(change.rule < 0 ? tr("Default") : markName(map.rules[change.rule].mark))}</title><text x="${geo.x(change.tick) + 2}" y="${ROWS.map.top + 16}">${escape(text)}</text></g>`);
    }
  }
  if (!mine.keys.length && !mine.programs.length && !map) parts.push(`<text class="cc-empty" x="${geo.left + 12}" y="${ROWS.keys.top + 16}">${tr("Click a row to place a keyswitch or a program change")}</text>`);
  const count = mine.keys.length + mine.programs.length;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="ks-strip" width="${geo.width}" height="${LANE_H}" viewBox="0 0 ${geo.width} ${LANE_H}" role="img" aria-label="${escape(tr("Sound: {count} markers", { count }))}">${parts.join("")}</svg>`;
}
