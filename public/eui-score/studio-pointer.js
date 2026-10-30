// The studio's pointer on the score (studio.js): a note or bars selected, a
// note dragged up or down, a repeat's edge dragged to another bar line.

/** The score's pointer wired: notes and bars selected, notes and repeats dragged. */
export function install(ctx) {
  const { root, sheet, st, M } = ctx;
  const { writeText, snapshot, saveDraft, select, geometry, draw, say, ghostAt, writeAtGhost } = ctx.call;

  // ---- Pointer ------------------------------------------------------------------

  /** The drawing's point under the pointer. */
  function point(event) {
    const g = geometry();
    if (!g) return null;
    return { x: (event.clientX - g.rect.left) / g.scale, y: (event.clientY - g.rect.top) / g.scale + (st.view.y0 ?? 0), scale: g.scale };
  }

  /** The bar under a point of the drawing, and the staff it is nearest: { bar, staff } or null. */
  function barHit(p) {
    for (const b of st.view.bars ?? []) {
      const [x0, y0, x1, y1] = b.box;
      // Above and below the staves too, where the chord names and the words are.
      const pad = (y1 - y0) * 0.35;
      if (p.x < x0 - 2 || p.x > x1 + 4 || p.y < y0 - pad || p.y > y1 + pad) continue;
      const tops = b.staves;
      let staff = 0;
      tops.forEach((top, k) => {
        if (Math.abs(p.y - (top + 16)) < Math.abs(p.y - (tops[staff] + 16))) staff = k;
      });
      const lanes = M.staffLanes(st.score);
      return { bar: b.bar, staff: lanes[Math.min(staff, lanes.length - 1)] };
    }
    return null;
  }

  /** Bars `a`…`b` of staff `s` selected, all their notes. */
  function selectBars(s, a, b) {
    const staff = st.score.staves[s];
    const [from, to] = [Math.min(a, b), Math.max(a, b)];
    const at = M.starts(staff);
    const last = Math.max(...at.filter((t) => t < M.barStart(st.score, to + 1)));
    st.sel = { staff: s, t0: M.barStart(st.score, from), t1: last, head: -1, bars: [from, to] };
    say("");
    draw();
  }

  /** The bar line nearest x, as the bar that starts (`side` "start") or ends ("end") there. */
  function nearestBarLine(p, side) {
    let best = null;
    for (const b of st.view.bars ?? []) {
      const [x0, y0, x1, y1] = b.box;
      const x = side === "start" ? x0 : x1;
      const d = Math.hypot(p.x - x, p.y < y0 ? y0 - p.y : p.y > y1 ? p.y - y1 : 0);
      if (!best || d < best.d) best = { bar: b.bar, d };
    }
    return best?.bar ?? null;
  }

  /** The note under the pointer: the nearest notehead within a few pixels, else the nearest note or rest. */
  function hit(p) {
    const away = (b) => Math.hypot(Math.max(b[0] - p.x, 0, p.x - b[2]), Math.max(b[1] - p.y, 0, p.y - b[3]));
    const reach = 6 / p.scale;
    let best = null;
    for (const it of st.view.items) {
      for (const h of it.heads) {
        const d = away(h.box);
        if (d <= reach && (!best || d < best.d)) best = { item: it.item, head: h.index, d };
      }
    }
    if (best) return best;
    for (const it of st.view.items) {
      const d = away(it.box);
      if (d <= 2 * reach && (!best || d < best.d)) best = { item: it.item, head: -1, d };
    }
    return best;
  }

  /** The word drawn under a point — a chord diagram, a text, a chord symbol, a syllable — or null. */
  function wordHit(p) {
    const reach = 3 / p.scale;
    const inside = ([x0, y0, x1, y1]) => p.x >= x0 - reach && p.x <= x1 + reach && p.y >= y0 - reach && p.y <= y1 + reach;
    return (st.view?.words ?? []).find((w) => inside(w.box)) ?? null;
  }

  /**
   * The word under a point opened where it is drawn, with its value (#434) —
   * or, on a line of chord names, the chord there typed again. Whether one opened.
   */
  function openWordUnder(p) {
    const word = wordHit(p);
    if (!word) {
      const found = hit(p);
      const on = found && st.items[found.item];
      if (!on || !M.isChords(st.score, on.staff)) return false;
      ctx.call.openWordAt(on.staff, on.index, "chord");
      return true;
    }
    const at = st.items[word.item];
    const kind = at && M.wordKind(word, st.score.staves[at.staff].events[at.index]);
    if (!kind) return false;
    ctx.call.openWordAt(at.staff, at.index, kind, word.index + 1);
    return true;
  }

  // A double press, told apart here: the first press draws the score again, and
  // a browser sends no dblclick once the drawing under the pointer is replaced (#438).
  // Caught on the way down, before the note's palette, drawn over the word once
  // the first press selected its note, keeps the second to itself.
  let lastPress = null;
  let swallowClick = false;
  const DOUBLE_PRESS_MS = 500;
  sheet.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".studio-words, .studio-fret-grid, .studio-note-marker, .studio-comment-here")) return;
    swallowClick = false;
    const press = { x: event.clientX, y: event.clientY, at: event.timeStamp };
    const again = lastPress && press.at - lastPress.at < DOUBLE_PRESS_MS && Math.hypot(press.x - lastPress.x, press.y - lastPress.y) < 6;
    lastPress = again ? null : press;
    if (!again || !st.score || !st.view || st.input.on) return;
    const p = point(event);
    if (!p || !openWordUnder(p)) return;
    // Nor the press nor the click it ends in is a press on the palette's button under it.
    event.preventDefault();
    event.stopPropagation();
    swallowClick = true;
  }, true);
  sheet.addEventListener("click", (event) => {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  sheet.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".studio-words, .studio-fret-grid")) return;
    // A comment's bubble, or the selection's 💬: a click of their own, not a press on the score.
    if (event.target.closest(".studio-note-marker, .studio-comment-here")) return;
    sheet.focus({ preventScroll: true });
    if (!st.score || !st.view) return;
    const p = point(event);
    // A repeat's edge, taken to be moved.
    const grip = event.target.closest(".studio-grip");
    if (grip) {
      st.grip = { i: Number(grip.dataset.repeat), edge: grip.dataset.edge, base: snapshot(), moved: false };
      sheet.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    // Note input: a click writes the ghost's note there (studio-ghost.js); Shift+click moves the cursor, as a click did before.
    // With Add to the chord ticked, or Alt held, the click adds its pitch to the note there (#422).
    const spot = st.input.on && !event.shiftKey ? ghostAt(event) : null;
    if (spot) {
      event.preventDefault();
      return writeAtGhost(spot, event.altKey || Boolean(root.querySelector("[data-chord-mode]")?.checked));
    }
    // A chord diagram drawn on the score: a click opens it large, its grid to click on (#436).
    const diagram = p && !st.input.on ? wordHit(p) : null;
    const on = diagram && st.items[diagram.item];
    if (on && M.wordKind(diagram, st.score.staves[on.staff].events[on.index]) === "fret") {
      event.preventDefault();
      ctx.call.openWordAt(on.staff, on.index, "fret");
      return;
    }
    const found = p && hit(p);
    if (!found) {
      // The empty part of a bar: it is selected, and a drag selects the bars it crosses.
      const on = p && !st.input.on ? barHit(p) : null;
      if (on) {
        // A drag selects the bars it crosses; a click selects its bar, or —
        // something selected already — takes the selection away.
        const keep = event.shiftKey && st.sel?.bars && st.sel.staff === on.staff;
        const from = keep ? st.sel.bars[0] : on.bar;
        st.barDrag = { s: on.staff, a: from, at: on.bar, moved: Boolean(keep), deselect: !keep && Boolean(st.sel) };
        if (keep) selectBars(on.staff, from, on.bar);
        sheet.setPointerCapture(event.pointerId);
        return;
      }
      if (!st.input.on) {
        st.sel = null;
        draw();
      }
      return;
    }
    const { staff: s, index: i } = st.items[found.item] ?? {};
    if (s == null) return;
    const ev = st.score.staves[s].events[i];
    if (st.input.on) {
      st.input.staff = s;
      st.input.t = M.starts(st.score.staves[s])[i];
      st.input.last = null;
      return draw();
    }
    const chord = ev.pitches.length > 1;
    select(s, i, chord ? found.head : -1, event.shiftKey);
    if (!ev.rest && !event.shiftKey) {
      const head = found.head >= 0 ? found.head : 0;
      st.drag = { x: event.clientX, y: event.clientY, at: p, scale: p.scale, s, t: M.starts(st.score.staves[s])[i], head: chord ? head : -1, by: 0, chromatic: event.shiftKey, base: snapshot() };
      sheet.setPointerCapture(event.pointerId);
    }
  });

  sheet.addEventListener("pointermove", (event) => {
    if (st.barDrag) {
      const on = point(event) && barHit(point(event));
      if (!on || (!st.barDrag.moved && on.bar === st.barDrag.at)) return;
      st.barDrag.moved = true;
      if (on.bar !== st.sel?.bars?.[1] || !st.sel?.bars) selectBars(st.barDrag.s, st.barDrag.a, on.bar);
      return;
    }
    if (st.grip) return moveGrip(event);
    if (!st.drag) return;
    // Sideways from a note, not up or down: the drag selects bars instead.
    const across = Math.abs(event.clientX - st.drag.x);
    if (st.drag.by === 0 && across > 14 && across > 2 * Math.abs(event.clientY - st.drag.y)) {
      const on = barHit(st.drag.at);
      if (on) {
        st.drag = null;
        st.barDrag = { s: on.staff, a: on.bar };
        const now = barHit(point(event)) ?? on;
        return selectBars(on.staff, on.bar, now.bar);
      }
    }
    const half = 4 * st.zoom * st.drag.scale;
    const by = Math.round((st.drag.y - event.clientY) / half);
    if (by === st.drag.by) return;
    // Each step a fresh copy of the score as it was at the press.
    const from = JSON.parse(st.drag.base).score;
    const i = M.eventAt(from.staves[st.drag.s], st.drag.t);
    try {
      for (let k = 0; k < Math.abs(by); k++) M.move(from, st.drag.s, i, event.shiftKey ? "semitone" : "step", Math.sign(by), st.drag.head);
    } catch (error) {
      return;
    }
    st.drag.by = by;
    st.score = from;
    writeText();
    sheet.classList.add("studio-dragging");
    draw();
  });

  /** A repeat's edge dragged to the bar line nearest the pointer — a preview, kept on release. */
  function moveGrip(event) {
    const p = point(event);
    if (!p) return;
    const { i, edge, base } = st.grip;
    const score = JSON.parse(base).score;
    const r = score.repeats[i];
    const bar = nearestBarLine(p, edge === "from" ? "start" : "end");
    if (bar == null) return;
    const next = {};
    if (edge === "from") next.from = bar;
    else if (edge === "to") next.to = bar;
    else {
      const k = Number(edge.split(":")[1]);
      const start = r.to + 1 + r.endings.slice(0, k).reduce((x, y) => x + y, 0);
      next.endings = r.endings.map((n, j) => (j === k ? bar - start + 1 : n));
    }
    try {
      M.setRepeat(score, i, next);
    } catch (error) {
      return say(error.message, true);
    }
    st.grip.moved = true;
    st.score = score;
    writeText();
    say("");
    draw();
  }

  const endDrag = () => {
    if (st.barDrag) {
      const drag = st.barDrag;
      st.barDrag = null;
      if (drag.moved) return;
      if (!drag.deselect) return selectBars(drag.s, drag.a, drag.a);
      st.sel = null;
      say("");
      return draw();
    }
    if (st.grip) {
      const grip = st.grip;
      st.grip = null;
      if (grip.moved) {
        st.past.push(grip.base);
        st.future = [];
        saveDraft();
        draw();
      }
      return;
    }
    const drag = st.drag;
    st.drag = null;
    sheet.classList.remove("studio-dragging");
    if (drag && drag.by !== 0) {
      st.past.push(drag.base);
      st.future = [];
      saveDraft();
      draw();
    }
  };
  sheet.addEventListener("pointerup", endDrag);
  sheet.addEventListener("pointercancel", endDrag);
}
