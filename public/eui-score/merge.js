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
const META_NAMES = { mixer: "Mixer", velocity: "Note velocities", swing: "Swing", humanize: "Humanize", cc: "Automation curves" };

/** The names the score's fields are shown under. */
const SCORE_NAMES = { key: "Key", mode: "Key", time: "Time signature", tempo: "Tempo", pickup: "Pickup", group: "Staff groups", groups: "Staff groups", repeats: "Repeats", paper: "Page layout", compress: "Bars of rest", timeParts: "Time signature" };

/** `text` read into the model, its meta line on it; null when the model cannot hold it. */
function read(text, parse) {
  try {
    const { score } = M.fromParsed(JSON.parse(parse(text)));
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
    }
    return rest;
  });
}

const key = (value) => (value === undefined ? ABSENT : JSON.stringify(value));

/**
 * The score cut into cells: `{ score, header, bars, heads, staves }`, each
 * cell `{ key, value }` (`key` compares, `value` is put back).
 */
function cells(score) {
  const bars = M.barsOf(score);
  const fields = {};
  for (const [name, value] of Object.entries(score)) {
    if (!["header", "staves", "changes", "breaks", "midKeys", "meta"].includes(name)) fields[name] = value;
  }
  const heads = Array.from({ length: bars }, (_, b) => {
    const change = (score.changes ?? []).find((c) => c.bar === b);
    const head = {};
    if (change) {
      const { bar, ...rest } = change;
      head.change = rest;
    }
    if ((score.breaks ?? {})[b]) head.break = score.breaks[b];
    const mids = (score.midKeys ?? []).filter((m) => m.bar === b).map(({ bar, ...rest }) => rest);
    if (mids.length) head.midKeys = mids;
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
  const out = { header: {}, staves: [], changes: [], breaks: {}, midKeys: [] };
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
    for (const m of head.midKeys ?? []) out.midKeys.push({ bar: k, ...m });
  });
  if (!out.midKeys.length) delete out.midKeys;

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
 * [[tick, value]] } }`) and the mixer's tracks (by lane) move; the rest
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
      const l = laneOf(lane);
      if (l.lane == null) dropped.push(`mixer ${l.where} ${JSON.stringify(settings)}`);
      else tracks[l.lane] = settings;
    }
    laidOut.mixer = { ...meta.mixer, tracks };
    if (!Object.keys(tracks).length) delete laidOut.mixer.tracks;
    if (!Object.keys(laidOut.mixer).length) delete laidOut.mixer;
  }
  // Emptied by what went: gone, as the editor leaves them.
  for (const name of ["velocity", "cc"]) {
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
