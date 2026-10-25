// Two people editing one score: a three-way merge of its text, by bar.
//
// `base` is the text this editor last had in common with the server, `mine`
// what it holds now, `theirs` what another editor saved since. Each is read
// into the model (score-model.js) and cut into cells:
//
// - each bar of each lane (a staff's voice): its notes and rests, with all
//   that rides on them — lyrics, chord names, dynamics, words — and, on a
//   staff's first voice, the clefs that change in that bar;
// - each bar's changes at its start (key, metre, tempo, mark, jump, double
//   bar), its keys changing inside it and the line or page break after it;
// - each staff's settings, one per field (name, instrument, clef…);
// - the score's own fields, one each (key, metre, tempo, pickup, groups,
//   repeats…), the header's one per field (title, composer…);
// - the `%% eui-score` line, key by key, and inside an object key by key
//   (the mixer per lane and setting, each note's velocity, each curve),
//   each side's first moved to the merged score's lanes and bars: what is
//   keyed by lane or by tick follows its staff and its bar (`layMeta`).
//
// A cell changed on one side only takes that side; changed the same way on
// both, fine; changed differently on both, it is a conflict. Bars inserted
// or taken away, or staves added or removed, on one side only are lined up
// with the other side's (a longest common run of bars, or of staves); both
// sides changing that structure, or a side's text holding what the model
// does not keep (a comment, a construct it does not read), is a conflict
// over the whole score: nothing is merged, so nothing is lost.
//
// Pure: `parse` is eui-score's `score_json`, handed in.

// Served immutable: this module's version goes to the model it loads.
const M = await import(`./score-model.js${new URL(import.meta.url).search}`);

const SIDES = ["mine", "theirs"];
const ABSENT = "∅";

/** The names the meta line's keys are shown under. */
const META_NAMES = { mixer: "Mixer", velocity: "Note velocities", swing: "Swing", humanize: "Humanize", cc: "Automation curves", synth: "Synthesizer", soundfont: "Own SoundFont" };

/** The names the score's fields are shown under. */
const SCORE_NAMES = { key: "Key", mode: "Key", time: "Time signature", tempo: "Tempo", pickup: "Pickup", group: "Staff groups", groups: "Staff groups", repeats: "Repeats", paper: "Page layout", compress: "Bars of rest", timeParts: "Time signature" };

/** `text` read into the model, its meta line on it; null when the model cannot hold it. */
function read(text, parse) {
  try {
    const { score } = M.fromParsed(JSON.parse(parse(text)), text);
    if (!score) return null;
    score.meta = M.readMeta(text);
    return score;
  } catch {
    return null;
  }
}

/** The text the editor writes for `score`: what a text it wrote reads back as. */
function written(score) {
  return M.toLilyPond({ ...score, meta: Object.keys(score.meta ?? {}).length ? score.meta : null }).source;
}

/** An event as compared: no id; its tuplet numbered within the bar. */
function plain(events) {
  const tuplets = new Map();
  return events.map((ev) => {
    const { id, ...rest } = ev;
    if (ev.tuplet) {
      if (!tuplets.has(ev.tuplet.id)) tuplets.set(ev.tuplet.id, tuplets.size);
      rest.tuplet = { ...ev.tuplet, id: tuplets.get(ev.tuplet.id) };
      // The tuplet around it, numbered the same way.
      if (ev.tuplet.outer) {
        if (!tuplets.has(ev.tuplet.outer.id)) tuplets.set(ev.tuplet.outer.id, tuplets.size);
        rest.tuplet.outer = { ...ev.tuplet.outer, id: tuplets.get(ev.tuplet.outer.id) };
      }
    }
    return rest;
  });
}

/** The score's changes inside bars, each cut by bar with the bar's head. */
const MID_LISTS = ["midKeys", "midTempos", "midMarks"];

const key = (value) => (value === undefined ? ABSENT : JSON.stringify(value));

/**
 * The score cut into cells: `{ score, header, bars, heads, staves }`, each
 * cell `{ key, value }` (`key` compares, `value` is put back).
 */
function cells(score) {
  const bars = M.barsOf(score);
  const fields = {};
  for (const [name, value] of Object.entries(score)) {
    if (!["header", "staves", "changes", "breaks", ...MID_LISTS, "meta"].includes(name)) fields[name] = value;
  }
  const heads = Array.from({ length: bars }, (_, b) => {
    const change = (score.changes ?? []).find((c) => c.bar === b);
    const head = {};
    if (change) {
      const { bar, ...rest } = change;
      head.change = rest;
    }
    if ((score.breaks ?? {})[b]) head.break = score.breaks[b];
    // What changes inside the bar: keys, tempos, marks.
    for (const name of MID_LISTS) {
      const mids = (score[name] ?? []).filter((m) => m.bar === b).map(({ bar, ...rest }) => rest);
      if (mids.length) head[name] = mids;
    }
    return { key: key(head), value: head };
  });
  const staves = M.staffLanes(score).map((u) => {
    const staff = score.staves[u];
    const props = {};
    for (const [name, value] of Object.entries(staff)) {
      if (!["events", "clefs", "midClefs", "voice"].includes(name)) props[name] = value;
    }
    const voices = {};
    for (const lane of M.voiceLanes(score, u)) {
      const v = M.voiceOf(score, lane);
      const at = M.starts(score.staves[lane]);
      const perBar = Array.from({ length: bars }, () => []);
      score.staves[lane].events.forEach((ev, i) => perBar[Math.min(bars - 1, M.barAt(score, at[i]))].push(ev));
      voices[v] = perBar.map((events, b) => {
        const value = { events };
        if (v === 1) {
          const clefs = (staff.clefs ?? []).filter((c) => c.bar === b).map(({ bar, ...rest }) => rest);
          const mids = (staff.midClefs ?? []).filter((c) => c.bar === b).map(({ bar, ...rest }) => rest);
          if (clefs.length) value.clefs = clefs;
          if (mids.length) value.midClefs = mids;
        }
        return { key: key({ ...value, events: plain(events) }), value };
      });
    }
    return { props, voices, lane: u };
  });
  return { score, fields, header: score.header ?? {}, bars, heads, staves, meta: score.meta ?? {} };
}

/** A bar's whole column (its head, and every lane of every staff in it), as compared. */
function barSignature(c, b) {
  return [c.heads[b].key, ...c.staves.flatMap((st) => Object.keys(st.voices).sort().map((v) => `${v}:${st.voices[v][b].key}`))].join("\n");
}

/** A staff's settings and all its bars, as compared. */
function staffSignature(st) {
  return [key(st.props), ...Object.keys(st.voices).sort().map((v) => `${v}:${st.voices[v].map((x) => x.key).join("|")}`)].join("\n");
}

/**
 * Base's items lined up with a side's: a list of `{ base, side }` (indices,
 * null for one inserted or taken away), a run replaced by as many items
 * paired up as changed in place. `same(i, j)` compares.
 */
function align(n, m, same) {
  const lcs = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = same(i, j) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const out = [];
  let i = 0;
  let j = 0;
  let gapI = [];
  let gapJ = [];
  const flush = () => {
    if (gapI.length === gapJ.length) gapI.forEach((b, k) => out.push({ base: b, side: gapJ[k], changed: true }));
    else {
      gapI.forEach((b) => out.push({ base: b, side: null }));
      gapJ.forEach((s) => out.push({ base: null, side: s }));
    }
    gapI = [];
    gapJ = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && same(i, j)) {
      flush();
      out.push({ base: i++, side: j++ });
    } else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) gapJ.push(j++);
    else gapI.push(i++);
  }
  flush();
  return out;
}

/** Three cells, or values with their keys: which side's to keep, or "conflict". */
function pick(b, x, y) {
  if (x === y) return "mine";
  if (x === b) return "theirs";
  if (y === b) return "mine";
  return "conflict";
}

/** Merges the meta line's objects key by key, into `out`; conflicts named by their path. */
function mergeMeta(b, x, y, path, conflicts, prefer) {
  const isObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);
  const names = new Set([...Object.keys(b ?? {}), ...Object.keys(x ?? {}), ...Object.keys(y ?? {})]);
  const out = {};
  for (const name of names) {
    const [bv, xv, yv] = [b?.[name], x?.[name], y?.[name]];
    const side = pick(key(bv), key(xv), key(yv));
    let value;
    if (side === "mine") value = xv;
    else if (side === "theirs") value = yv;
    else if ([xv, yv].every(isObject) && (bv === undefined || isObject(bv))) value = mergeMeta(bv ?? {}, xv, yv, [...path, name], conflicts, prefer);
    else {
      const [top, ...rest] = [...path, name];
      conflicts.push({ area: "meta", label: `${META_NAMES[top] ?? top}${rest.length ? ` (${rest.join(" › ")})` : ""}` });
      value = prefer === "theirs" ? yv : xv;
    }
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/** A staff's name as the merge says it: its own, or its place in a piano's brace. */
function staffLabel(score, staff, number) {
  const st = score.staves[staff];
  if (st?.name) return st.name;
  const lanes = M.staffLanes(score);
  const brace = (score.groups ?? []).find((g) => g.kind === "brace" && g.first <= number && number <= g.last && g.last - g.first === 1);
  const group = brace ?? (score.group === "brace" && lanes.length === 2 ? { first: 0, name: "" } : null);
  if (group) return `${group.name || "Piano"} ${number === group.first ? "right hand" : "left hand"}`;
  if (lanes.length === 1) return "the staff";
  return st?.instrument ? `${st.instrument} (staff ${number + 1})` : `Staff ${number + 1}`;
}

const whole = (reason) => ({ text: null, conflicts: [{ area: "score", label: reason }], whole: true });

/**
 * The three-way merge. Answers `{ text, conflicts, whole }`: `text` the
 * merged LilyPond when nothing conflicts (or when `prefer` — "mine" or
 * "theirs" — settles each conflict its way), else null; `conflicts` the
 * cells changed both ways (`{ area, label, lane?, bar? }`); `whole` when
 * the score could not be merged by bar at all.
 */
export function mergeScores(base, mine, theirs, { parse, prefer = null } = {}) {
  if (mine === theirs || theirs === base) return { text: mine, conflicts: [], whole: false };
  if (mine === base) return { text: theirs, conflicts: [], whole: false };
  const models = { base: read(base, parse), mine: read(mine, parse), theirs: read(theirs, parse) };
  if (!models.base || !models.mine || !models.theirs) return whole("The score's text, which the editor cannot merge by bar");
  // A side's text that is not what the editor writes for its own model holds
  // something the model does not keep: merging it by bar would drop it.
  for (const side of SIDES) if (written(models[side]) !== (side === "mine" ? mine : theirs)) return whole("The score's text, which holds what cannot be merged by bar");
  const c = { base: cells(models.base), mine: cells(models.mine), theirs: cells(models.theirs) };
  const conflicts = [];
  const choose = (side, label, extra = {}) => {
    if (side !== "conflict") return side;
    conflicts.push({ label, ...extra });
    return prefer === "theirs" ? "theirs" : "mine";
  };

  // What changed shape: bars or staves added or taken away.
  const reshaped = (side) => ({ bars: c[side].bars !== c.base.bars, staves: c[side].staves.length !== c.base.staves.length });
  const shape = { mine: reshaped("mine"), theirs: reshaped("theirs") };
  const changers = SIDES.filter((side) => shape[side].bars || shape[side].staves);
  if (changers.length === 2) return whole("Bars or staves added or taken away on both sides");
  const S = changers[0] ?? null;
  if (S && shape[S].bars && shape[S].staves) return whole("Bars and staves added or taken away at once");
  const N = S === "mine" ? "theirs" : "mine";

  // The output's staves and bars, each with its index on every side.
  const identity = (n) => Array.from({ length: n }, (_, k) => ({ base: k, mine: k, theirs: k }));
  let staffMap = identity(c.base.staves.length);
  let barMap = identity(c.base.bars);
  const changedBar = (side, b) => barSignature(c[side], b) !== barSignature(c.base, b);
  const changedStaff = (side, s) => staffSignature(c[side].staves[s]) !== staffSignature(c.base.staves[s]);
  if (S && shape[S].bars) {
    const lined = align(c.base.bars, c[S].bars, (i, j) => barSignature(c.base, i) === barSignature(c[S], j));
    for (const x of lined) {
      if (x.side === null && changedBar(N, x.base)) return whole(`Bar ${M.barNumber(models.base, x.base)}, taken away on one side and changed on the other`);
    }
    barMap = lined.filter((x) => x.side !== null).map((x) => ({ base: x.base, [S]: x.side, [N]: x.base }));
    // Bars numbered by the base: the repeats of a side that kept its bars no longer line up.
    if (key(c[N].fields.repeats) !== key(c.base.fields.repeats)) return whole("Repeats changed while bars were added or taken away");
  }
  if (S && shape[S].staves) {
    const lined = align(c.base.staves.length, c[S].staves.length, (i, j) => staffSignature(c.base.staves[i]) === staffSignature(c[S].staves[j]));
    for (const x of lined) {
      if (x.side === null && changedStaff(N, x.base)) return whole(`${staffLabel(models.base, c.base.staves[x.base].lane, x.base)}, taken away on one side and changed on the other`);
    }
    staffMap = lined.filter((x) => x.side !== null).map((x) => ({ base: x.base, [S]: x.side, [N]: x.base }));
  }

  // The score's fields and its header, one cell each.
  const fromCells = (get, label, extra) => {
    const values = { base: get("base"), mine: get("mine"), theirs: get("theirs") };
    const side = choose(pick(key(values.base), key(values.mine), key(values.theirs)), label, extra);
    return values[side];
  };
  const out = { header: {}, staves: [], changes: [], breaks: {}, ...Object.fromEntries(MID_LISTS.map((name) => [name, []])) };
  const names = (part) => new Set(["base", "mine", "theirs"].flatMap((side) => Object.keys(c[side][part])));
  for (const name of names("fields")) {
    const value = fromCells((side) => c[side].fields[name], SCORE_NAMES[name] ?? name, { area: "score" });
    if (value !== undefined) out[name] = value;
  }
  for (const name of names("header")) {
    const value = fromCells((side) => c[side].header[name], name === "title" ? "Title" : name === "composer" ? "Composer" : `Header (${name})`, { area: "header" });
    if (value !== undefined) out.header[name] = value;
  }

  // Each bar's head: its changes, its keys inside it, the break after it.
  const shown = models.mine;
  const barLabel = (k) => {
    const b = barMap[k].mine;
    return b == null ? `New bar ${k + 1}` : `Bar ${M.barNumber(shown, b)}`;
  };
  const cellOf = (side, k, get) => {
    const b = barMap[k][side];
    return b == null ? undefined : get(c[side], b);
  };
  barMap.forEach((x, k) => {
    const heads = Object.fromEntries(["base", "mine", "theirs"].map((side) => [side, cellOf(side, k, (cs, b) => cs.heads[b])]));
    const side = heads.base === undefined ? S : choose(pick(heads.base.key, heads.mine.key, heads.theirs.key), `${barLabel(k)}: its key, time, tempo or marks`, { area: "bar", bar: k });
    const head = heads[side].value;
    if (head.change) out.changes.push({ bar: k, ...head.change });
    if (head.break) out.breaks[k] = head.break;
    for (const name of MID_LISTS) for (const m of head[name] ?? []) out[name].push({ bar: k, ...m });
  });
  for (const name of MID_LISTS) if (!out[name].length) delete out[name];

  // Each staff: its settings field by field, each voice bar by bar.
  const chosen = [];
  staffMap.forEach((x) => {
    const staffOf = (side) => (x[side] == null ? undefined : c[side].staves[x[side]]);
    const st = { base: staffOf("base"), mine: staffOf("mine"), theirs: staffOf("theirs") };
    const number = x.mine ?? x.theirs;
    const label = staffLabel(x.mine != null ? models.mine : models[S], (x.mine != null ? st.mine : st[S]).lane, number);
    const props = {};
    if (!st.base) Object.assign(props, st[S].props);
    else {
      const fields = new Set([...Object.keys(st.base.props), ...Object.keys(st.mine.props), ...Object.keys(st.theirs.props)]);
      for (const name of fields) {
        const value = fromCells((side) => st[side].props[name], `${label}: its ${name === "short" ? "short name" : name}`, { area: "staff" });
        if (value !== undefined) props[name] = value;
      }
    }
    const voices = new Set(["base", "mine", "theirs"].flatMap((side) => Object.keys(st[side]?.voices ?? {}).map(Number)));
    const lanes = {};
    for (const v of [...voices].sort()) {
      const laneLabel = v > 1 ? `${label}, voice ${v}` : label;
      lanes[v] = barMap.map((bx, k) => {
        const cell = (side) => {
          const b = bx[side];
          if (b == null || !st[side]) return undefined;
          return st[side].voices[v]?.[b] ?? { key: ABSENT, value: null };
        };
        const three = { base: cell("base"), mine: cell("mine"), theirs: cell("theirs") };
        // A bar or a staff only one side has: that side's.
        if (!three.base) return (three[S] ?? { value: null }).value;
        const side = choose(pick(three.base.key, three.mine.key, three.theirs.key), `${barLabel(k)}, ${laneLabel}`, { area: "lane", bar: k, staff: number, voice: v });
        return three[side].value;
      });
    }
    chosen.push({ props, lanes });
  });

  // Put back together; a voice silent in a bar another side wrote it in gets rests there.
  const bars = barMap.length;
  // Each output staff's lanes, by voice: where the meta line's lanes go.
  const laneAt = [];
  for (const { props, lanes } of chosen) {
    const upper = { ...props, events: [] };
    const clefs = [];
    const midClefs = [];
    (lanes[1] ?? []).forEach((bar, k) => {
      for (const clef of bar?.clefs ?? []) clefs.push({ bar: k, ...clef });
      for (const clef of bar?.midClefs ?? []) midClefs.push({ bar: k, ...clef });
    });
    if (clefs.length) upper.clefs = clefs;
    if (midClefs.length) upper.midClefs = midClefs;
    out.staves.push(upper);
    const voicesAt = { 1: out.staves.length - 1 };
    laneAt.push(voicesAt);
    for (const v of Object.keys(lanes).map(Number).sort()) {
      const lane = v === 1 ? upper : { voice: v, events: [] };
      if (lanes[v].every((bar) => bar == null) && v > 1) continue;
      if (v > 1) {
        out.staves.push(lane);
        voicesAt[v] = out.staves.length - 1;
      }
      lanes[v].forEach((bar, k) => {
        if (bar) lane.events.push(...bar.events);
        else lane.events.push(...restsFor(out, k));
      });
    }
  }

  // The meta line, key by key, each side's first laid out as the merged
  // score is: its lanes and its ticks moved with the staves and the bars
  // they belong to. What sat in a bar or a staff taken away on one side
  // goes with it, unless the other side changed it.
  const laid = Object.fromEntries(["base", "mine", "theirs"].map((side) => [side, layMeta(models[side], c[side].meta, side, staffMap, barMap, laneAt, out)]));
  if (S && key(laid[N].dropped) !== key(laid.base.dropped)) return whole("Velocities or curves in a bar or staff taken away on one side, changed on the other");
  const meta = mergeMeta(laid.base.meta, laid.mine.meta, laid.theirs.meta, [], conflicts, prefer);
  if (conflicts.length && !prefer) return { text: null, conflicts, whole: false };
  out.meta = meta;
  // Every lane's bars still last their bars.
  for (const lane of out.staves) {
    const at = M.starts(lane);
    const total = M.lengthOf(lane);
    if (Math.abs(total - M.barStart(out, bars)) > 1e-6) return whole("The bars no longer line up once merged");
    for (let k = 0; k < bars; k++) {
      const begin = M.barStart(out, k);
      if (lane.events.length && !at.some((t) => Math.abs(t - begin) < 1e-6)) return whole("The bars no longer line up once merged");
    }
  }
  const text = written(out);
  if (!read(text, parse)) return whole("The merged score, which the engraver does not read");
  return { text, conflicts, whole: false };
}

/**
 * Side `side`'s meta line (`meta`, of its model `score`) laid out as the
 * merged score `out` is: a lane goes to its staff's (by `staffMap`) same
 * voice there, a tick to the same place in its bar's (by `barMap`). The
 * velocities (`"lane:tick:key"`), the curves (`{ lane: { controller:
 * [[tick, value]] } }`), the mixer's tracks, the synthesizers and the own
 * SoundFonts' presets (by lane) move; the rest
 * stays. Answers `{ meta, dropped }`: `dropped` what found no place, named
 * by staff, voice, bar and offset (the same on two sides of one shape).
 */
function layMeta(score, meta, side, staffMap, barMap, laneAt, out) {
  const dropped = [];
  const bars = M.barsOf(score);
  const staffOut = new Map(staffMap.map((x, k) => [x[side], k]));
  const barOut = new Map(barMap.map((x, k) => [x[side], k]));
  const lanes = M.staffLanes(score);
  /** `{ lane, staff, voice }`: the output lane (or null), and where it was. */
  const laneOf = (lane) => {
    const n = Number(lane);
    if (!Number.isInteger(n) || !score.staves[n]) return { lane: null, where: `lane ${lane}` };
    const staff = lanes.indexOf(M.upperOf(score, n));
    const voice = M.voiceOf(score, n);
    const k = staffOut.get(staff);
    return { lane: k == null ? null : laneAt[k]?.[voice] ?? null, where: `${staff}/${voice}` };
  };
  /** `{ tick, where }`: the output tick (or null), and its bar and offset here. */
  const tickOf = (tick) => {
    const t = Number(tick);
    const b = Math.min(M.barAt(score, t), bars);
    const offset = t - M.barStart(score, b);
    const k = b >= bars ? barMap.length : barOut.get(b);
    return { tick: k == null ? null : M.barStart(out, k) + offset, where: `${b}+${offset}` };
  };
  const laidOut = { ...meta };
  if (meta.velocity && typeof meta.velocity === "object") {
    laidOut.velocity = {};
    for (const [id, value] of Object.entries(meta.velocity)) {
      const [lane, tick, ...rest] = id.split(":");
      const l = laneOf(lane);
      const t = tickOf(tick);
      if (l.lane == null || t.tick == null) dropped.push(`velocity ${l.where} ${t.where} ${rest.join(":")}=${value}`);
      else laidOut.velocity[[l.lane, t.tick, ...rest].join(":")] = value;
    }
  }
  if (meta.cc && typeof meta.cc === "object") {
    laidOut.cc = {};
    for (const [lane, curves] of Object.entries(meta.cc)) {
      const l = laneOf(lane);
      const kept = {};
      for (const [controller, points] of Object.entries(curves ?? {})) {
        const moved = [];
        for (const point of Array.isArray(points) ? points : []) {
          const t = tickOf(point[0]);
          if (l.lane == null || t.tick == null) dropped.push(`cc ${l.where} ${controller} ${t.where}=${point[1]}`);
          else moved.push([t.tick, ...point.slice(1)]);
        }
        if (moved.length) kept[controller] = moved;
      }
      if (l.lane != null && Object.keys(kept).length) laidOut.cc[l.lane] = kept;
    }
  }
  if (meta.mixer?.tracks && typeof meta.mixer.tracks === "object") {
    const tracks = {};
    for (const [lane, settings] of Object.entries(meta.mixer.tracks)) {
      // An audio track's (#390, "audio-1") is not a staff's: it stays as it is.
      if (!/^\d+$/.test(lane)) {
        tracks[lane] = settings;
        continue;
      }
      const l = laneOf(lane);
      if (l.lane == null) dropped.push(`mixer ${l.where} ${JSON.stringify(settings)}`);
      else tracks[l.lane] = settings;
    }
    laidOut.mixer = { ...meta.mixer, tracks };
    if (!Object.keys(tracks).length) delete laidOut.mixer.tracks;
    if (!Object.keys(laidOut.mixer).length) delete laidOut.mixer;
  }
  // A staff's synthesizer and its own SoundFont's preset (#391): by lane, as the mixer's tracks.
  for (const name of ["synth", "soundfont"]) {
    if (!meta[name] || typeof meta[name] !== "object") continue;
    laidOut[name] = {};
    for (const [lane, settings] of Object.entries(meta[name])) {
      // Only a staff plays one: an audio track's name ("audio-1", #390) is no lane of theirs, and goes.
      if (!/^\d+$/.test(lane)) continue;
      const l = laneOf(lane);
      if (l.lane == null) dropped.push(`${name} ${l.where} ${JSON.stringify(settings)}`);
      else laidOut[name][l.lane] = settings;
    }
  }
  // Emptied by what went: gone, as the editor leaves them.
  for (const name of ["velocity", "cc", "synth", "soundfont"]) {
    if (laidOut[name] && !Object.keys(laidOut[name]).length && Object.keys(meta[name]).length) delete laidOut[name];
  }
  return { meta: laidOut, dropped: dropped.sort() };
}

/** Rests filling bar `k` of `score`. */
function restsFor(score, k) {
  return M.spellDuration(M.barLength(score, k)).map((v) => M.makeEvent({ base: v.base, dots: v.dots }));
}

/**
 * The conflicts said briefly, a line each: the bars of a lane next to one
 * another gathered ("Bars 3–5, Violin").
 */
export function conflictLines(conflicts) {
  const lines = [];
  const lanes = new Map();
  for (const x of conflicts) {
    if (x.area !== "lane") {
      lines.push(x.label);
      continue;
    }
    const id = `${x.staff}:${x.voice}`;
    if (!lanes.has(id)) lanes.set(id, []);
    lanes.get(id).push(x);
  }
  for (const list of lanes.values()) {
    let run = [list[0]];
    const say = () => {
      const [first, last] = [run[0], run[run.length - 1]];
      const where = first.label.replace(/^(New bar|Bar) [^,]*, /, "");
      const from = first.label.match(/^(?:New bar|Bar) ([^,]*),/)?.[1];
      const to = last.label.match(/^(?:New bar|Bar) ([^,]*),/)?.[1];
      lines.push(run.length > 1 ? `Bars ${from}–${to}, ${where}` : first.label);
    };
    for (const x of list.slice(1)) {
      if (x.bar === run[run.length - 1].bar + 1) run.push(x);
      else {
        say();
        run = [x];
      }
    }
    say();
  }
  return lines;
}

// ---- Where comments go when bars or staves move (#392) ----------------------
//
// A comment thread is anchored to a lane and some bars (comments.js). When a
// save turns the text the server has (`base`) into a new one, the editor
// sends with it where each of base's bars and lanes went, and the server
// moves the threads in the same request (ScoreThread.follow): bars put in or
// taken away, staves or voices added or removed, by this editor, by an Undo,
// by a merge with someone else's changes — whatever happened between the two
// texts. The two texts are lined up as the merge lines them up (a longest
// common run of staves, then of bars); the bar operations this editor knows
// it did since `base` (`ops`, from studio.js's `onBars`) decide first when
// they account for the new bar count, since bars that read the same (a
// pattern repeated, empty bars) cannot be told apart by their content.

/** The texts last read for `anchorMap`: each save's new text is the next one's base. */
const lastRead = new Map();
function readKept(text, parse) {
  if (!lastRead.has(text)) {
    if (lastRead.size >= 2) lastRead.delete(lastRead.keys().next().value);
    lastRead.set(text, read(text, parse));
  }
  return lastRead.get(text);
}

/** `ops` ({ at, removed, added }, in order) on `n` bars: each new bar's old one (null when new), or null. */
export function barsByOps(n, ops) {
  if (!Array.isArray(ops) || !ops.length) return null;
  const bars = Array.from({ length: n }, (_, k) => k);
  for (const op of ops) {
    if (!op || !(op.at >= 0) || op.at > bars.length) return null;
    bars.splice(op.at, op.removed ?? 0, ...Array.from({ length: op.added ?? 0 }, () => null));
  }
  return bars;
}

/** Old index to new, as runs `[from, to, length]`: what the server reads (an index in no run is gone). */
export function runsOf(pairs) {
  const runs = [];
  for (const [from, to] of pairs) {
    const last = runs[runs.length - 1];
    if (last && last[0] + last[2] === from && last[1] + last[2] === to) last[2]++;
    else runs.push([from, to, 1]);
  }
  return runs;
}

/**
 * The staves of `ca` lined up with `cb`'s: `[{ base, side }]`, both set. By
 * their settings and all their bars first (bars in the same count); the
 * staves left over between two pairs, by their settings alone — a staff
 * changed in the same save as another was added keeps its comments.
 */
function alignStaves(ca, cb, sameCount) {
  const strict = align(ca.staves.length, cb.staves.length, (i, j) => key(ca.staves[i].props) === key(cb.staves[j].props) && (!sameCount || staffSignature(ca.staves[i]) === staffSignature(cb.staves[j])));
  const pairs = [];
  let gapA = [];
  let gapB = [];
  const flush = () => {
    const loose = align(gapA.length, gapB.length, (i, j) => key(ca.staves[gapA[i]].props) === key(cb.staves[gapB[j]].props));
    for (const x of loose) if (x.base != null && x.side != null) pairs.push({ base: gapA[x.base], side: gapB[x.side] });
    gapA = [];
    gapB = [];
  };
  for (const x of strict) {
    if (x.base != null && x.side != null) {
      flush();
      pairs.push({ base: x.base, side: x.side });
    } else if (x.base != null) gapA.push(x.base);
    else gapB.push(x.side);
  }
  flush();
  return pairs.sort((x, y) => x.base - y.base);
}

/**
 * Where `base`'s bars and lanes are in `next`: `{ from, to, bars, lanes }`
 * — `from` and `to` the bar counts, `bars` runs `[old, new, length]` (a bar
 * in none was taken away), `lanes` each old lane's new one (−1: gone). Null
 * when nothing moved, or when either text cannot be read into the model.
 */
export function anchorMap(base, next, { parse, ops = [] } = {}) {
  if (base == null || next == null || base === next) return null;
  const a = readKept(base, parse);
  const b = readKept(next, parse);
  if (!a || !b) return null;
  const ca = cells(a);
  const cb = cells(b);

  // The staves, by their settings — and their bars too while those keep their count.
  const sameCount = ca.bars === cb.bars;
  const pairs = alignStaves(ca, cb, sameCount);
  const lanes = Array.from({ length: a.staves.length }, () => -1);
  for (const { base: i, side: j } of pairs) {
    for (const lane of M.voiceLanes(a, ca.staves[i].lane)) {
      const voice = M.voiceOf(a, lane);
      lanes[lane] = M.laneOfVoice(b, cb.staves[j].lane, voice);
    }
  }

  // The bars: by the operations, when they account for the new count; else by content, on the staves both have.
  let barPairs;
  const byOps = barsByOps(ca.bars, ops);
  if (byOps && byOps.length === cb.bars) barPairs = byOps.map((old, k) => [old, k]).filter(([old]) => old != null);
  else {
    const column = (c, b, side) => [c.heads[b].key, ...pairs.flatMap((p) => Object.keys(c.staves[p[side]].voices).sort().map((v) => `${v}:${c.staves[p[side]].voices[v][b].key}`))].join("\n");
    const lined = align(ca.bars, cb.bars, (i, j) => column(ca, i, "base") === column(cb, j, "side"));
    barPairs = lined.filter((x) => x.base != null && x.side != null).map((x) => [x.base, x.side]);
  }
  const bars = runsOf(barPairs);
  const still = sameCount && bars.length === 1 && bars[0][0] === 0 && bars[0][1] === 0 && bars[0][2] === ca.bars && lanes.every((lane, k) => lane === k) && a.staves.length === b.staves.length;
  return still ? null : { from: ca.bars, to: cb.bars, bars, lanes };
}
