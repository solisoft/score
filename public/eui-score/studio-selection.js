// The studio's selection (studio.js), kept in times: the bars and the notes
// it covers, the note the tools act on — sounded as the person works.

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
    if (!st.sel) throw new Error("Select the bars — drag across them, or click the first and Shift+click the last");
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
    if (!P.preview(keys, M.programOf(sound), { drums, channel: laneChannel(t.s) }) && !P.isReady()) {
      say("Loading the sounds, to hear the notes… (38 MB, once)");
      P.prepare().then(() => say("The notes sound as you write them; Hear the notes turns it off.")).catch(() => {});
    }
  }

  /** The one event the tools act on: the selection's first, or the note just written. */
  function target() {
    if (st.input.on && st.input.last) {
      const staff = st.score.staves[st.input.last.staff];
      const i = M.eventAt(staff, st.input.last.t);
      if (i >= 0) return { s: st.input.last.staff, i, head: -1 };
    }
    const r = range();
    return r ? { s: r.s, i: r.a, head: st.sel.head } : null;
  }

  function need() {
    const t = target();
    if (!t) throw new Error("Select a note first — click it, or press N to write notes");
    return t;
  }

  /** The selection kept on the event that now starts at `t`. */
  function keepOn(s, t) {
    st.sel = { staff: s, t0: t, t1: t, head: st.sel?.head ?? -1 };
  }

  return { barNo, changeBar, staffOf, range, select, hear, target, need, keepOn, selectedBarsOrNull, selectedBars };
}
