// The studio's selection (studio.js), kept in times: the bars and the notes
// it covers, the note the tools act on — sounded as the person works.

// The editor's words in the page's language (#508).
const V = new URL(import.meta.url).search;
const { tr } = await import(`./words.js${V}`);
// A selection over several staves (#1024).
const T = await import(`./score-tools.js${V}`);

/** Answers the selection, the note the tools act on, and hearing it. */
export function install(ctx) {
  const { root, st, M, P } = ctx;
  const { showInText, draw, say, laneChannel } = ctx.call;

  /** Bar `b`'s number as the score shows it: after a pickup, the pickup is bar 0. */
  function barNo(b) {
    return st.score ? M.barNumber(st.score, b) : b + 1;
  }

  // ---- Selection, in times -------------------------------------------------------

  /** The bar the changes section acts on: the cursor's, or the selection's first; null when none. */
  function changeBar() {
    if (!st.score) return null;
    if (st.input.on) return Math.min(M.barAt(st.score, st.input.t), M.barsOf(st.score) - 1);
    if (!st.sel) return null;
    return st.sel.bars?.[0] ?? M.barAt(st.score, Math.min(st.sel.t0, st.sel.t1));
  }

  function staffOf() {
    return st.input.on ? st.input.staff : st.sel?.staff ?? 0;
  }

  /** The selected events' indices, first and last, or null. */
  function range() {
    if (!st.sel || !st.score) return null;
    const staff = st.score.staves[st.sel.staff];
    if (!staff) return null;
    const at = M.starts(staff);
    const indexAt = (t) => {
      let found = -1;
      at.forEach((start, i) => {
        if (start <= t) found = i;
      });
      return found;
    };
    const a = indexAt(st.sel.t0);
    const b = indexAt(st.sel.t1);
    return a < 0 ? null : { s: st.sel.staff, a: Math.min(a, b), b: Math.max(a, b), staff };
  }

  /** Whether the selection spans several lanes: bars of several staves (or voices), or notes of them drawn round (#1038). */
  function multiLane() {
    return Boolean(st.sel?.lanes?.length > 1);
  }

  /** The selected events, lane by lane: [{ s, a, b, staff }], one for a selection on one staff; [] for none. */
  function ranges() {
    if (!st.sel || !st.score) return [];
    if (!multiLane()) {
      const r = range();
      return r ? [r] : [];
    }
    const found = st.sel.bars ? T.barRanges(st.score, st.sel.lanes, ...st.sel.bars) : T.spanRanges(st.score, st.sel.lanes, st.sel.t0, st.sel.t1);
    return found.map((r) => ({ ...r, staff: st.score.staves[r.s] }));
  }

  /**
   * Bars `a`…`b` of the staves from lane `l0`'s to lane `l1`'s selected,
   * every voice of each (#1024): from a Shift+click or a Shift+drag across
   * staves. On one lane, its bars alone. `l0` and bar `a` stay the anchor a
   * further Shift+click extends from.
   */
  function selectStaves(l0, l1, a, b) {
    const lanes = l0 === l1 ? [l0] : T.lanesBetween(st.score, l0, l1);
    const [from, to] = [Math.min(a, b), Math.max(a, b)];
    const at = M.starts(st.score.staves[lanes[0]]);
    const last = Math.max(...at.filter((t) => t < M.barStart(st.score, to + 1)));
    st.sel = { staff: lanes[0], t0: M.barStart(st.score, from), t1: last, head: -1, bars: [from, to], anchor: { lane: l0, bar: a } };
    if (lanes.length > 1) {
      st.sel.lanes = lanes;
      const staves = new Set(lanes.map((s) => M.upperOf(st.score, s))).size;
      const bars = from === to ? tr("Bar {n}", { n: barNo(from) }) : tr("Bars {a}–{b}", { a: barNo(from), b: barNo(to) });
      say(staves === 1
        ? tr("{bars}, every voice: Delete, the arrows, Transpose, articulations, dynamics and Ctrl+C act on them all.", { bars })
        : tr("{bars} of {n} staves: Delete, the arrows, Transpose, articulations, dynamics and Ctrl+C act on them all.", { bars, n: staves }));
    } else say("");
    draw();
  }

  /**
   * The events of `lanes` that start from `t0` to `t1` selected (#1038):
   * what a rectangle drawn over the score takes, even from the middle of a
   * bar to the middle of another. When they fill their bars whole, those
   * bars are selected, as a drag across them selects them.
   */
  function selectSpan(lanes, t0, t1) {
    const [from, to] = [Math.min(t0, t1), Math.max(t0, t1)];
    const bars = T.wholeBars(st.score, lanes, from, to);
    if (bars && lanes.length === 1) {
      st.sel = { staff: lanes[0], t0: from, t1: to, head: -1, bars };
      say("");
      return draw();
    }
    if (bars) return selectStavesOf(lanes, bars[0], bars[1]);
    st.sel = { staff: lanes[0], t0: from, t1: to, head: -1 };
    if (lanes.length > 1) {
      st.sel.lanes = lanes;
      const staves = new Set(lanes.map((s) => M.upperOf(st.score, s))).size;
      const notes = T.spanRanges(st.score, lanes, from, to).reduce((n, r) => n + r.b - r.a + 1, 0);
      say(staves === 1
        ? tr("{n} notes and rests, every voice: Delete, the arrows, Transpose, articulations, dynamics and Ctrl+C act on them all.", { n: notes })
        : tr("{n} notes and rests of {staves} staves: Delete, the arrows, Transpose, articulations, dynamics and Ctrl+C act on them all.", { n: notes, staves }));
    } else say("");
    draw();
  }

  /** Bars `a`…`b` of exactly `lanes` selected (several), said as selectStaves says them. */
  function selectStavesOf(lanes, a, b) {
    selectStaves(lanes[0], lanes.at(-1), a, b);
    st.sel.lanes = lanes;
    delete st.sel.anchor;
    if (lanes.length === 1) delete st.sel.lanes;
  }

  /** Where a Shift+click across staves extends the selection from: its anchor, or its first lane and bar. */
  function anchorOf() {
    if (!st.sel || !st.score) return null;
    return st.sel.anchor ?? { lane: st.sel.staff, bar: st.sel.bars?.[0] ?? M.barAt(st.score, Math.min(st.sel.t0, st.sel.t1)) };
  }

  function select(s, index, head = -1, extend = false) {
    const staff = st.score?.staves[s];
    if (!staff) {
      st.sel = null;
      return draw();
    }
    const t = M.starts(staff)[index];
    if (extend && st.sel && st.sel.staff === s) st.sel = { ...st.sel, t1: t, head: -1 };
    else st.sel = { staff: s, t0: t, t1: t, head };
    say("");
    draw();
    showInText(true);
    if (!extend) hear();
  }

  /** The selected bars, or null when nothing is selected. */
  function selectedBarsOrNull() {
    try {
      return selectedBars();
    } catch (error) {
      return null;
    }
  }

  /** The bars the selection (or the input cursor) spans, first and last. */
  function selectedBars() {
    if (st.input.on) {
      const b = M.barAt(st.score, st.input.t);
      return [b, b];
    }
    if (!st.sel) throw new Error(tr("Select the bars — drag across them, or click the first and Shift+click the last"));
    if (st.sel.bars) return st.sel.bars;
    const a = M.barAt(st.score, Math.min(st.sel.t0, st.sel.t1));
    const b = M.barAt(st.score, Math.max(st.sel.t0, st.sel.t1));
    return [a, b];
  }

  // ---- Hearing the notes ----------------------------------------------------------

  const HEAR = "eui-score-studio-hear";
  const hearBox = root.querySelector("[data-hear]");
  try {
    if (hearBox && localStorage.getItem(HEAR) === "off") hearBox.checked = false;
  } catch (error) {}
  hearBox?.addEventListener("change", () => {
    try {
      localStorage.setItem(HEAR, hearBox.checked ? "on" : "off");
    } catch (error) {}
  });

  /** Sounds the note the tools act on — its selected head, or the whole chord — with its staff's instrument. */
  function hear() {
    if (!hearBox?.checked || st.playing || !st.score) return;
    const t = target();
    const ev = t && st.score.staves[t.s]?.events[t.i];
    if (!ev || ev.rest || !ev.pitches.length) return;
    const heads = t.head >= 0 && ev.pitches[t.head] ? [ev.pitches[t.head]] : ev.pitches;
    const sound = st.score.staves[M.upperOf(st.score, t.s)]?.instrument;
    const drums = M.isDrums(st.score, t.s);
    const keys = heads.map((p) => (drums ? M.drumKey(p.drum) : M.midiKey(p.d, p.alter)));
    // Its built-in instrument (#1040) once a Play has loaded it, else its General MIDI sound.
    const builtIn = drums ? null : st.instruments?.patchFor(t.s);
    if (!P.preview(keys, builtIn?.program ?? M.programOf(sound), { drums, channel: laneChannel(t.s), bank: builtIn?.bank ?? 0 }) && !P.isReady()) {
      say(tr("Loading the sounds, to hear the notes… (38 MB, once)"));
      P.prepare().then(() => say(tr("The notes sound as you write them; Hear the notes turns it off."))).catch(() => {});
    }
  }

  /** The event the note-input cursor stands on, as a target, or null past the end. */
  function atCursor() {
    const staff = st.score.staves[st.input.staff];
    const i = staff ? M.starts(staff).findLastIndex((start) => start <= st.input.t) : -1;
    return i >= 0 ? { s: st.input.staff, i, head: -1 } : null;
  }

  /** The one event the tools act on: in note input the note just written, or the one at the cursor; else the selection's first. */
  function target() {
    if (st.input.on && st.input.last) {
      const staff = st.score.staves[st.input.last.staff];
      const i = M.eventAt(staff, st.input.last.t);
      if (i >= 0) return { s: st.input.last.staff, i, head: -1 };
    }
    // In note input with nothing just written (← → moved the cursor, a staff
    // was added), the note at the cursor, not a selection left from before (#426, #429).
    if (st.input.on && st.score) {
      const here = atCursor();
      if (here) return here;
    }
    const r = range();
    return r ? { s: r.s, i: r.a, head: st.sel.head } : null;
  }

  function need() {
    const t = target();
    if (!t) throw new Error(tr("Select a note first — click it, or press N to write notes"));
    return t;
  }

  /** The selection kept on the event that now starts at `t`. */
  function keepOn(s, t) {
    st.sel = { staff: s, t0: t, t1: t, head: st.sel?.head ?? -1 };
  }

  return { barNo, changeBar, staffOf, range, ranges, multiLane, selectStaves, selectSpan, anchorOf, select, hear, target, need, keepOn, selectedBarsOrNull, selectedBars };
}
