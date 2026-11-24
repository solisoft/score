// The studio's pointer on the score (studio.js): a note or bars selected, a
// note dragged up or down, a repeat's edge dragged to another bar line, a
// rectangle drawn round the notes to select (#1038).

// A selection over several staves, a rectangle's notes (#1024, #1038).
const V = new URL(import.meta.url).search;
const T = await import(`./score-tools.js${V}`);

/** The score's pointer wired: notes and bars selected, notes and repeats dragged. */
export function install(ctx) {
  const { root, sheet, st, M } = ctx;
  const { writeText, snapshot, saveDraft, select, geometry, draw, say, ghostAt, writeAtGhost, selectStaves, selectSpan, anchorOf } = ctx.call;

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

  // ---- The rectangle (#1038) --------------------------------------------------------
  //
  // A press on the score that does not take a note to move, a sign or a
  // repeat's edge, then a drag: a rectangle follows the pointer, and the notes
  // and rests whose heads are in it are selected as it grows — from the middle
  // of a bar if that is where they are, on every staff it crosses. With Shift,
  // added to what was selected; Escape puts back what was. A drag whose
  // rectangle takes no note selects the bars it crosses, as before. A mouse's
  // or a pen's: a finger scrolls the score (#454).

  /** The rectangle drawn: an element of the sheet's, over the drawing, in its pixels. */
  const band = Object.assign(document.createElement("div"), { className: "studio-marquee", hidden: true });
  band.setAttribute("aria-hidden", "true");
  sheet.appendChild(band);
  /** How far (in pixels) a press moves before it is a drag rather than a click. */
  const MARQUEE_SLOP = 4;

  /** The selection as it is, a copy to put back. */
  const selCopy = () => (st.sel ? structuredClone(st.sel) : null);

  /** A rectangle begun at a press: shown once the pointer moves away. `before`, what was selected before the press. */
  function startMarquee(event, p, before) {
    if (!p || event.pointerType === "touch" || st.input.on || event.button !== 0) return;
    st.marquee = { from: p, to: p, x: event.clientX, y: event.clientY, before, pressed: selCopy(), shift: event.shiftKey, shown: false, took: false, key: null };
  }

  /** The rectangle placed over the drawing, from its first corner to its second. */
  function placeMarquee() {
    const m = st.marquee;
    const g = m?.shown && geometry();
    if (!g) {
      band.hidden = true;
      return;
    }
    const a = g.at(Math.min(m.from.x, m.to.x), Math.min(m.from.y, m.to.y));
    const b = g.at(Math.max(m.from.x, m.to.x), Math.max(m.from.y, m.to.y));
    Object.assign(band.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${Math.max(1, b.x - a.x)}px`, height: `${Math.max(1, b.y - a.y)}px` });
    band.hidden = false;
  }

  /** The rectangle followed to `event`'s point; whether it is shown (the pointer has moved off the press). */
  function moveMarquee(event) {
    const m = st.marquee;
    const p = point(event);
    if (!m || !p) return false;
    if (!m.shown && Math.hypot(event.clientX - m.x, event.clientY - m.y) < MARQUEE_SLOP) return false;
    m.shown = true;
    m.to = p;
    m.last = { clientX: event.clientX, clientY: event.clientY };
    placeMarquee();
    const caught = T.caughtIn(st.score, [m.from.x, m.from.y, p.x, p.y], st.view.items, st.items);
    if (!caught) {
      if (m.took) {
        // Nothing in it any more: what the press had selected, until the bars it crosses (below) take over.
        m.took = false;
        m.key = null;
        st.sel = m.pressed ? structuredClone(m.pressed) : null;
        if (st.barDrag) Object.assign(st.barDrag, { moved: false, last: null });
        draw();
      }
      return true;
    }
    let { lanes, t0, t1 } = caught;
    // Shift: what was selected before, and the notes in the rectangle, together.
    const base = m.shift ? m.before : null;
    if (base && st.score.staves[base.staff]) {
      lanes = [...new Set([...lanes, ...(base.lanes ?? [base.staff])])].sort((x, y) => x - y);
      t0 = Math.min(t0, base.t0, base.t1);
      t1 = Math.max(t1, base.t0, base.t1);
    }
    m.took = true;
    const key = `${lanes.join(",")}:${t0}:${t1}`;
    if (key === m.key) return true;
    m.key = key;
    selectSpan(lanes, t0, t1);
    return true;
  }

  /** The rectangle put away; `back`, what was selected before the press put back (Escape). */
  function dropMarquee(back = false) {
    const m = st.marquee;
    st.marquee = null;
    band.hidden = true;
    if (!m || !back) return;
    st.barDrag = null;
    st.drag = null;
    sheet.classList.remove("studio-dragging");
    st.sel = m.before;
    say("");
    draw();
  }

  // Escape while the rectangle is drawn: it is put away, and the selection as it was.
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !st.marquee) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dropMarquee(true);
  }, true);
  // The sheet or the page scrolled under a still pointer (a wheel, the keys): the rectangle's corner stays under it.
  const followScroll = () => {
    if (st.marquee?.shown && st.marquee.last) moveMarquee(st.marquee.last);
  };
  sheet.addEventListener("scroll", followScroll);
  window.addEventListener("scroll", followScroll, { passive: true, signal: ctx.signal });
  // A double press, told apart here: the first press draws the score again, and
  // a browser sends no dblclick once the drawing under the pointer is replaced (#438).
  // Caught on the way down, before the note's palette, drawn over the word once
  // the first press selected its note, keeps the second to itself.
  let lastPress = null;
  let swallowClick = false;
  const DOUBLE_PRESS_MS = 500;
  sheet.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".studio-words, .studio-fret-grid, .studio-note-marker, .studio-comment-here, .studio-sign-back")) return;
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
    if (event.target.closest(".studio-note-marker, .studio-comment-here, .studio-sign-back")) return;
    sheet.focus({ preventScroll: true });
    if (!st.score || !st.view) return;
    const p = point(event);
    const before = selCopy();
    dropMarquee();
    // A repeat's edge, taken to be moved.
    const grip = event.target.closest(".studio-grip");
    if (grip) {
      st.grip = { i: Number(grip.dataset.repeat), edge: grip.dataset.edge, base: snapshot(), moved: false };
      sheet.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    // Note input: a click writes the ghost's note there (studio-ghost.js); Shift+click moves the cursor, as a click did before.
    // A click on a note adds its pitch to it, a chord; on a rest or past the end it writes a note.
    // Alt+click writes over the note instead (#422, #702).
    const spot = st.input.on && !event.shiftKey ? ghostAt(event) : null;
    if (spot) {
      event.preventDefault();
      return writeAtGhost(spot, !event.altKey);
    }
    // A sign — a dynamic, a slur, words — taken to be moved, or a handle of the one selected (#1020).
    if (p && !st.input.on && ctx.call.signPress(event, p)) return;
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
        // Shift on another staff than the selection's: the bars of every staff between (#1024).
        const anchor = event.shiftKey ? anchorOf() : null;
        if (anchor && (st.sel.lanes || M.upperOf(st.score, anchor.lane) !== on.staff)) {
          selectStaves(anchor.lane, on.staff, anchor.bar, on.bar);
          st.barDrag = { s: anchor.lane, a: anchor.bar, at: on.bar, moved: true, deselect: false, across: true };
          startMarquee(event, p, before);
          sheet.setPointerCapture(event.pointerId);
          return;
        }
        // A drag selects the bars it crosses; a click selects its bar, or —
        // something selected already — takes the selection away. With Shift,
        // the drag goes down or up across the staves too.
        const keep = event.shiftKey && st.sel?.bars && st.sel.staff === on.staff;
        const from = keep ? st.sel.bars[0] : on.bar;
        st.barDrag = { s: on.staff, a: from, at: on.bar, moved: Boolean(keep), deselect: !keep && Boolean(st.sel), across: event.shiftKey };
        if (keep) selectBars(on.staff, from, on.bar);
        startMarquee(event, p, before);
        sheet.setPointerCapture(event.pointerId);
        return;
      }
      // Between the systems, in the margins: a click takes the selection away
      // (not with Shift), a drag draws the rectangle from there.
      if (!st.input.on) {
        if (!event.shiftKey) {
          st.sel = null;
          draw();
        }
        startMarquee(event, p, before);
        if (st.marquee) sheet.setPointerCapture(event.pointerId);
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
    // Shift+click on a note of another staff (or voice): the bars between, on every staff between (#1024).
    const anchor = event.shiftKey ? anchorOf() : null;
    if (anchor && (st.sel.lanes || anchor.lane !== s)) {
      return selectStaves(anchor.lane, s, anchor.bar, M.barAt(st.score, M.starts(st.score.staves[s])[i]));
    }
    const chord = ev.pitches.length > 1;
    select(s, i, chord ? found.head : -1, event.shiftKey);
    if (!ev.rest && !event.shiftKey) {
      const head = found.head >= 0 ? found.head : 0;
      st.drag = { x: event.clientX, y: event.clientY, at: p, scale: p.scale, s, t: M.starts(st.score.staves[s])[i], head: chord ? head : -1, by: 0, chromatic: event.shiftKey, base: snapshot(), before, pointerType: event.pointerType };
      sheet.setPointerCapture(event.pointerId);
      return;
    }
    // A rest, or a note with Shift: nothing to move up or down, a drag draws the rectangle from there.
    startMarquee(event, p, before);
    if (st.marquee) sheet.setPointerCapture(event.pointerId);
  });

  sheet.addEventListener("pointermove", (event) => {
    if (st.signDrag) return ctx.call.signMove(event);
    // The rectangle: the notes in it selected; until it holds one, the bars it crosses, below.
    if (st.marquee) {
      if (!moveMarquee(event) || st.marquee.took) return;
    }
    if (st.barDrag) {
      const on = point(event) && barHit(point(event));
      if (!on) return;
      // Shift held, from the press or now: the staves the pointer crosses as well as the bars (#1024).
      if (st.barDrag.across || event.shiftKey) {
        const same = on.bar === st.barDrag.at && M.upperOf(st.score, on.staff) === M.upperOf(st.score, st.barDrag.s);
        if (!st.barDrag.moved && same) return;
        const key = `${on.bar}:${on.staff}`;
        Object.assign(st.barDrag, { across: true, moved: true });
        if (key !== st.barDrag.last) {
          st.barDrag.last = key;
          selectStaves(st.barDrag.s, on.staff, st.barDrag.a, on.bar);
        }
        return;
      }
      if (!st.barDrag.moved && on.bar === st.barDrag.at) return;
      st.barDrag.moved = true;
      if (on.bar !== st.sel?.bars?.[1] || !st.sel?.bars) selectBars(st.barDrag.s, st.barDrag.a, on.bar);
      return;
    }
    if (st.grip) return moveGrip(event);
    if (!st.drag) return;
    // Sideways from a note, not up or down: the drag draws the rectangle from the press instead (#1038).
    const across = Math.abs(event.clientX - st.drag.x);
    if (st.drag.by === 0 && across > 14 && across > 2 * Math.abs(event.clientY - st.drag.y)) {
      const drag = st.drag;
      // A finger (where the score does not scroll under it): the bars it crosses, as before.
      if (drag.pointerType === "touch") {
        const on = barHit(drag.at);
        if (!on) return;
        st.drag = null;
        st.barDrag = { s: on.staff, a: on.bar };
        const now = barHit(point(event)) ?? on;
        return selectBars(on.staff, on.bar, now.bar);
      }
      st.drag = null;
      st.marquee = { from: drag.at, to: drag.at, x: drag.x, y: drag.y, before: drag.before, pressed: selCopy(), shift: false, shown: false, took: false, key: null };
      const on = barHit(drag.at);
      if (on) st.barDrag = { s: on.staff, a: on.bar, at: on.bar, moved: false, deselect: false };
      if (moveMarquee(event) && !st.marquee.took && st.barDrag) {
        const now = barHit(point(event)) ?? on;
        st.barDrag.moved = true;
        selectBars(on.staff, on.bar, now.bar);
      }
      return;
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
    if (st.signDrag) return ctx.call.signEnd();
    const marquee = st.marquee;
    dropMarquee();
    // The rectangle took notes: they are the selection, nothing else to do.
    if (marquee?.took) {
      st.barDrag = null;
      return;
    }
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
  // The browser took the gesture over (a finger scrolling the score, #454): what
  // was begun is left, never ended as a click would be — no bar selected by a scroll.
  sheet.addEventListener("pointercancel", () => {
    if (st.signDrag) return ctx.call.signEnd({ cancelled: true });
    if (st.marquee) dropMarquee(st.marquee.shown);
    if (st.barDrag && !st.barDrag.moved) st.barDrag = null;
    endDrag();
  });

  // Drawn again (the zoom, an edit from someone else): the rectangle over the drawing as it now is.
  return { placeMarquee };
}
