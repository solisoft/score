// The studio's MIDI view (studio.js, piano-roll.js): the roll drawn, its
// sections selected, its loop set on the ruler, its notes dragged.

// The editor's words in the page's language (#508).
const V = new URL(import.meta.url).search;
const { tr } = await import(`./words.js${V}`);

/** The MIDI view's pointer wired; answers its drawing and its sections. */
export function install(ctx) {
  const { sheet, rollHost, rollScroll, st, quantizeBox, M, R, Vel } = ctx;
  const {
    barNo, writeText, snapshot, restore, saveDraft, select, hear, draw, rollPeers, velocityStrip, say, setLoop
  } = ctx.call;

  // ---- The MIDI view --------------------------------------------------------------

  /** The roll, drawn when the MIDI view is on: the notes being played lit, the cursor at the first of them. */
  function drawRoll() {
    const on = st.mode === "midi" && Boolean(st.score);
    sheet.hidden = on;
    rollHost.hidden = !on;
    if (!on) return;
    const lit = new Set();
    let cursor = null;
    for (const k of st.playing?.now ?? []) {
      const it = st.items[k];
      if (!it || it.kept) continue;
      lit.add(`${it.staff}:${it.index}`);
      const t = M.starts(st.score.staves[it.staff])[it.index];
      cursor = cursor == null ? t : Math.min(cursor, t);
    }
    const left = rollScroll.scrollLeft;
    // The others' bands go over the roll's notes, inside its picture.
    const roll = R.drawRoll(st.score, { layout: st.rollLayout, zoom: st.zoom, sel: st.sel, lit, cursor, loop: st.loopBars, only: st.rollLayout === "keys" ? st.rollOnly : null });
    const end = roll.indexOf("</svg>");
    const peers = rollPeers();
    // The audio tracks' waveforms under the staves (#390), then the velocities and the automation.
    rollScroll.innerHTML = (end >= 0 && peers ? roll.slice(0, end) + peers + roll.slice(end) : roll) + (st.audio?.html() ?? "") + velocityStrip() + (st.automation?.html() ?? "");
    const only = rollHost.querySelector("[data-roll-only]");
    only.hidden = !(st.rollLayout === "keys" && st.rollOnly != null);
    if (!only.hidden) only.textContent = tr("{track} only", { track: R.laneNames(st.score)[st.rollOnly] ?? "" });
    rollScroll.scrollLeft = left;
    for (const button of rollHost.querySelectorAll("[data-layout]")) button.setAttribute("aria-pressed", String(button.dataset.layout === st.rollLayout));
  }

  /** The roll's point under the pointer, and what is there: `{ bar, lane, note }`. */
  function rollPoint(event) {
    const svg = rollScroll.querySelector("svg");
    if (!svg) return null;
    const box = svg.getBoundingClientRect();
    const geo = R.rollLayout(st.score, { layout: st.rollLayout, zoom: st.zoom, only: st.rollOnly });
    return R.rollHit(st.score, geo, event.clientX - box.left, event.clientY - box.top, event.target.closest("[data-lane]"));
  }

  /**
   * Bars `a`…`b` of the lanes from `l0` to `l1` selected, all their notes: a
   * section. Without lanes (the keyboard layout), every lane.
   */
  function selectSection(a, b, l0, l1) {
    const all = st.score.staves.map((_, s) => s);
    const lanes = l0 == null || l1 == null ? all : all.filter((s) => s >= Math.min(l0, l1) && s <= Math.max(l0, l1));
    const [from, to] = [Math.min(a, b), Math.max(a, b)];
    const staff = st.score.staves[lanes[0]];
    const at = M.starts(staff);
    const last = Math.max(...at.filter((t) => t < M.barStart(st.score, to + 1)));
    st.sel = { staff: lanes[0], t0: M.barStart(st.score, from), t1: last, head: -1, bars: [from, to], lanes };
    draw();
  }

  /** The selection, said: its bars and its tracks. */
  function sayRange() {
    if (!st.sel?.bars) return;
    const [a, b] = st.sel.bars;
    const n = st.sel.lanes?.length ?? 1;
    const bars = a === b ? tr("Bar {n}", { n: barNo(a) }) : tr("Bars {a}–{b}", { a: barNo(a), b: barNo(b) });
    say(n === 1 ? tr("{bars}, one track: Ctrl+C copies them.", { bars }) : tr("{bars}, {n} tracks: Ctrl+C copies them.", { bars, n }));
  }

  rollHost.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".studio-roll-bar, .studio-velocity-bar, .vel-strip, .studio-cc-bar, .cc-strip, .ks-strip") || !st.score) return;
    rollHost.focus({ preventScroll: true });
    const p = rollPoint(event);
    if (!p) return;
    // On the keyboard, a note is dragged: its body moves it (up, down, along),
    // its right edge makes it longer or shorter, on the Quantize grid.
    if (p.note && st.rollLayout === "keys" && !event.shiftKey) {
      const rect = event.target.closest("[data-lane]").getBoundingClientRect();
      select(p.note.lane, p.note.index, -1, false);
      const staff = st.score.staves[p.note.lane];
      const [a, b] = M.tiedNotes(staff, p.note.index);
      const at = M.starts(staff);
      const geo = R.rollLayout(st.score, { layout: "keys", zoom: st.zoom, only: st.rollOnly });
      st.noteDrag = {
        lane: p.note.lane,
        index: p.note.index,
        key: p.note.key,
        x: event.clientX,
        y: event.clientY,
        resize: event.clientX > rect.right - 7,
        perTick: geo.perTick,
        row: geo.tracks[0].row,
        length: at[b] + M.ticksOf(staff.events[b]) - at[a],
        base: snapshot(),
        change: null,
      };
      rollHost.setPointerCapture?.(event.pointerId);
      return;
    }
    if (p.note) return select(p.note.lane, p.note.index, -1, event.shiftKey);
    // The ruler: the loop's.
    if (p.ruler && p.bar != null) {
      st.loopDrag = { a: p.bar, bar: p.bar, moved: false };
      rollHost.setPointerCapture?.(event.pointerId);
      return;
    }
    if (p.bar == null) {
      if (st.sel) {
        st.sel = null;
        draw();
      }
      return;
    }
    // A drag selects bars and tracks; a click selects its bar, or —
    // something selected already — takes the selection away.
    const keep = event.shiftKey && st.sel?.bars;
    st.rollDrag = { a: keep ? st.sel.bars[0] : p.bar, lane: keep ? (st.sel.lanes?.[0] ?? p.lane) : p.lane, bar: p.bar, to: p.lane, moved: Boolean(keep), deselect: !keep && Boolean(st.sel) };
    if (keep) selectSection(st.rollDrag.a, p.bar, st.rollDrag.lane, p.lane);
    rollHost.setPointerCapture?.(event.pointerId);
  });

  rollHost.addEventListener("pointermove", (event) => {
    if (st.noteDrag) return dragNote(event);
    // On the keyboard, the pointer tells a note's body (moved) from its right edge (resized).
    if (!st.rollDrag && !st.loopDrag) {
      const note = st.rollLayout === "keys" && event.target.closest?.(".roll-note");
      rollScroll.style.cursor = note ? (event.clientX > note.getBoundingClientRect().right - 7 ? "ew-resize" : "grab") : "";
    }
    const p = (st.rollDrag || st.loopDrag) && rollPoint(event);
    if (!p || p.bar == null) return;
    if (st.loopDrag) {
      if (p.bar === st.loopDrag.bar) return;
      Object.assign(st.loopDrag, { bar: p.bar, moved: true });
      st.loopBars = [Math.min(st.loopDrag.a, p.bar), Math.max(st.loopDrag.a, p.bar)];
      return draw();
    }
    const lane = p.lane ?? st.rollDrag.to;
    if (p.bar === st.rollDrag.bar && lane === st.rollDrag.to) return;
    Object.assign(st.rollDrag, { bar: p.bar, to: lane, moved: true });
    selectSection(st.rollDrag.a, p.bar, st.rollDrag.lane, lane);
  });

  // A double click on a track's name: that track alone, on the keyboard.
  rollHost.addEventListener("dblclick", (event) => {
    if (st.rollLayout !== "tracks" || !st.score) return;
    const p = rollPoint(event);
    if (!p || p.bar != null || p.lane == null) return;
    st.rollLayout = "keys";
    st.rollOnly = p.lane;
    if (st.sel?.lanes) st.sel = null;
    say(tr("{track} on the keyboard: Tracks or Keyboard shows them all again.", { track: R.laneNames(st.score)[p.lane] }));
    draw();
  });

  /** The note being dragged, as far as the pointer: a preview, on a copy of the score as it was at the press. */
  function dragNote(event) {
    const d = st.noteDrag;
    const grid = M.RECORDING_GRIDS[quantizeBox?.value] ?? M.RECORDING_GRIDS.sixteenth;
    const dx = Math.round((event.clientX - d.x) / d.perTick / grid) * grid;
    const change = d.resize
      ? { length: Math.max(grid, Math.round((d.length + dx) / grid) * grid) }
      : { key: d.key, shift: dx, semitones: Math.round((d.y - event.clientY) / d.row) };
    if (JSON.stringify(change) === JSON.stringify(d.change)) return;
    const from = JSON.parse(d.base).score;
    let i;
    const was = M.starts(from.staves[d.lane])[d.index];
    try {
      i = M.moveNote(from, d.lane, d.index, change);
    } catch (error) {
      return;
    }
    // Its velocity goes with it.
    if (from.meta?.velocity) Vel.remap(from, d.lane, was, M.starts(from.staves[d.lane])[i], (k) => (change.semitones && k === d.key ? k + change.semitones : k));
    d.change = change;
    st.score = from;
    const t = M.starts(from.staves[d.lane])[i];
    st.sel = { staff: d.lane, t0: t, t1: t, head: -1 };
    rollScroll.style.cursor = d.resize ? "ew-resize" : "grabbing";
    writeText();
    draw();
  }

  /** The drag let go: kept, one Undo away; or, back where it began, nothing done. */
  function endNoteDrag() {
    const d = st.noteDrag;
    st.noteDrag = null;
    if (!d.change) return;
    const still = d.resize ? d.change.length === d.length : d.change.shift === 0 && d.change.semitones === 0;
    if (still) {
      restore(d.base);
      return draw();
    }
    st.past.push(d.base);
    st.future = [];
    saveDraft();
    draw();
    hear();
    say(d.resize ? tr("Note made longer or shorter — Ctrl+Z puts it back.") : tr("Note moved — Ctrl+Z puts it back."));
  }

  const endRollDrag = () => {
    if (st.noteDrag) return endNoteDrag();
    if (st.loopDrag) {
      const drag = st.loopDrag;
      st.loopDrag = null;
      // A click: on the loop, it goes; elsewhere, the loop is that bar.
      if (drag.moved) return setLoop(st.loopBars);
      const on = st.loopBars && drag.a >= st.loopBars[0] && drag.a <= st.loopBars[1];
      return setLoop(on ? null : [drag.a, drag.a]);
    }
    if (!st.rollDrag) return;
    const drag = st.rollDrag;
    st.rollDrag = null;
    if (!drag.moved) {
      if (drag.deselect) {
        st.sel = null;
        say("");
        return draw();
      }
      selectSection(drag.a, drag.a, drag.lane, drag.lane);
    }
    sayRange();
  };
  rollHost.addEventListener("pointerup", endRollDrag);
  rollHost.addEventListener("pointercancel", endRollDrag);

  return { drawRoll };
}
