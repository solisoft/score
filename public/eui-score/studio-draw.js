// The studio's drawing (studio.js): the score engraved as it now is, the
// selection and the cursor lit; over it, the palette, the selected bars, the
// repeats' grips and the playhead; and the copy printed.

const COLOURS = { selection: "#b4373a", head: "#e0662a", cursor: "#2563c9", playing: "#0f9d47" };

/** Answers the drawing: the score engraved, and what goes over it. */
export function install(ctx) {
  const { root, options, sheet, svgHost, overlay, palette, playhead, st, loaded, M, editor_view_lit } = ctx;
  const { range, showInText, placeWords, wordsOpen, tellPlace, placePeers, placeMarkers, placeGhost, drawRoll, showState, refuse } = ctx.call;

  // ---- Drawing ------------------------------------------------------------------

  function lit() {
    const items = {};
    const heads = [];
    // A part's note drawn once for both parts (\\partCombine): lit through the note drawn.
    const itemOf = (s, i) => M.drawnItem(st.items, st.items.findIndex((it) => it.staff === s && it.index === i));
    const r = range();
    if (r && !st.input.on) {
      for (let i = r.a; i <= r.b; i++) items[itemOf(r.s, i)] = COLOURS.selection;
      if (st.sel.head >= 0 && r.a === r.b) heads.push([itemOf(r.s, r.a), st.sel.head, COLOURS.head]);
    }
    if (st.input.on && st.score) {
      const staff = st.score.staves[st.input.staff];
      const i = M.starts(staff).findLastIndex((t) => t <= st.input.t);
      if (i >= 0) items[itemOf(st.input.staff, i)] = COLOURS.cursor;
    }
    if (st.playing?.now) for (const k of st.playing.now) items[k] = COLOURS.playing;
    return JSON.stringify({ items, heads });
  }

  async function draw() {
    await loaded();
    // Drawn: the text, with the other voices' bars opened where the page writes in them.
    let shown = st.text;
    if (st.score) {
      const { source, items } = M.toLilyPond(st.score, { open: openBars(), written: st.written });
      st.items = items;
      shown = source;
    }
    const width = Math.max(320, Math.floor(sheet.clientWidth - 2));
    const space = 8 * st.zoom;
    try {
      st.view = JSON.parse(editor_view_lit(shown, width, space, st.score ? lit() : "{}"));
      svgHost.innerHTML = st.view.svg;
      sheet.classList.remove("studio-sheet-refused");
    } catch (error) {
      st.view = null;
      svgHost.innerHTML = "";
      sheet.classList.add("studio-sheet-refused");
      refuse(error, shown);
    }
    placeWords();
    placeOverlay();
    placePlayhead();
    drawRoll();
    showState();
    if (!st.playing) showInText(false);
    tellPlace();
  }

  /** Where the drawing is: its origin in the sheet's pixels, and its scale. */
  function geometry() {
    const svg = svgHost.querySelector("svg");
    if (!svg || !st.view) return null;
    const rect = svg.getBoundingClientRect();
    const frame = sheet.getBoundingClientRect();
    const scale = rect.width / st.view.width;
    const y0 = st.view.y0 ?? 0;
    return {
      scale,
      rect,
      // A point of the drawing, in the sheet's pixels.
      at: (x, y) => ({ x: rect.left - frame.left + sheet.scrollLeft + x * scale, y: rect.top - frame.top + sheet.scrollTop + (y - y0) * scale }),
    };
  }

  /** The bars of another voice (2 to 4) the cursor or the selection is in: written even while they are rests. */
  function openBars() {
    const s = st.input.on ? st.input.staff : st.sel?.staff;
    if (s == null || !M.isLower(st.score, s)) return [];
    const [t0, t1] = st.input.on ? [st.input.t, st.input.t] : [Math.min(st.sel.t0, st.sel.t1), Math.max(st.sel.t0, st.sel.t1)];
    const last = M.barsOf(st.score) - 1;
    const out = [];
    for (let bar = Math.min(M.barAt(st.score, t0), last); bar <= Math.min(M.barAt(st.score, t1), last); bar++) out.push({ staff: s, bar });
    return out;
  }

  /** The note palette, beside the selection: above it, kept inside the sheet;
   *  below it where chord symbols stand over the staff (its own, or a line of
   *  chord names), so it never hides them. Past the note's own words on that
   *  side too — its diagram, its "dolce" — to be clicked on (#438). Hidden
   *  while words are typed. */
  function placePalette() {
    const g = geometry();
    const sel = st.sel;
    const hide = () => {
      palette.hidden = true;
    };
    if (!g || !st.score || st.input.on || st.playing || !sel || sel.bars || sel.t0 !== sel.t1 || wordsOpen()) return hide();
    const starts = M.starts(st.score.staves[sel.staff]);
    const k = M.drawnItem(st.items, st.items.findIndex((it) => it.staff === sel.staff && starts[it.index] === sel.t0));
    const item = st.view?.items.find((it) => it.item === k);
    if (!item) return hide();
    const below = M.chordsOver(st.score, sel.staff);
    const middle = (item.box[1] + item.box[3]) / 2;
    const words = (st.view.words ?? []).filter((w) => w.item === k).map((w) => w.box);
    const edge = below
      ? Math.max(item.box[3], ...words.filter((b) => b[1] >= middle).map((b) => b[3]))
      : Math.min(item.box[1], ...words.filter((b) => b[3] <= middle).map((b) => b[1]));
    const corner = g.at(item.box[0], edge);
    palette.hidden = false;
    palette.dataset.side = below ? "below" : "above";
    palette.style.left = `${Math.max(4, corner.x - 10)}px`;
    palette.style.top = below ? `${corner.y + 10}px` : `${Math.max(4, corner.y - 48)}px`;
  }

  function placeOverlay() {
    placePalette();
    overlay.innerHTML = "";
    const g = geometry();
    if (!g || !st.score) return;
    const boxOf = (bar) => st.view.bars?.find((b) => b.bar === bar)?.box;
    const add = (className, x0, y0, x1, y1, props = {}) => {
      const a = g.at(x0, y0);
      const b = g.at(x1, y1);
      const el = Object.assign(document.createElement("div"), { className, ...props });
      Object.assign(el.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${Math.max(2, b.x - a.x)}px`, height: `${b.y - a.y}px` });
      overlay.appendChild(el);
      return el;
    };
    placePeers(g, add);
    placeMarkers(g, add);
    placeGhost();
    if (st.input.on) return;
    if (st.sel?.bars) {
      for (let bar = st.sel.bars[0]; bar <= st.sel.bars[1]; bar++) {
        const box = boxOf(bar);
        if (box) add("studio-bar-selected", box[0], box[1], box[2] + 3, box[3]);
      }
      // The selected bars' own way to comment on them (the app's).
      const box = boxOf(st.sel.bars[1]);
      if (box && options.onComment && !st.playing) {
        const here = add("studio-comment-here", box[2] - 4 / g.scale, box[1], box[2] + 3, box[1] + 1 / g.scale);
        here.innerHTML = `<button type="button" data-act="comment" title="Comment on the selection (Ctrl+Alt+M)">💬 Comment</button>`;
      }
    }
    (st.score.repeats ?? []).forEach((r, i) => {
      const grip = (bar, side, edge, label) => {
        const box = boxOf(bar);
        if (!box) return;
        const x = side === "start" ? box[0] : box[2] + 2;
        const el = add("studio-grip", x - 5 / g.scale, box[1], x + 5 / g.scale, box[3], { title: `${label} — drag to another bar line` });
        el.dataset.repeat = String(i);
        el.dataset.edge = edge;
        el.innerHTML = `<span>${label}</span>`;
      };
      grip(r.from, "start", "from", "𝄆");
      grip(r.to, "end", "to", r.endings.length ? "𝄇 1." : "𝄇");
      let end = r.to;
      r.endings.forEach((n, k) => {
        end += n;
        grip(end, "end", `ending:${k}`, `${k + 1}.`);
      });
    });
  }

  /** The band over what is sounding: as wide as its notes, as tall as its system. */
  function placePlayhead() {
    const now = st.playing?.now;
    if (!now?.length || !st.view) {
      playhead.hidden = true;
      return;
    }
    const boxes = st.view.items.filter((it) => now.includes(it.item)).map((it) => it.box);
    if (!boxes.length) {
      playhead.hidden = true;
      return;
    }
    // The line the notes are on: its bars' boxes, every staff of it, and
    // nothing of the line above or below — the notes' own boxes too, for
    // those drawn above or below the staves.
    const x0 = Math.min(...boxes.map((b) => b[0]));
    const x1 = Math.max(...boxes.map((b) => b[2]));
    let y0 = Math.min(...boxes.map((b) => b[1]));
    let y1 = Math.max(...boxes.map((b) => b[3]));
    const { staff, index } = st.items[now[0]] ?? {};
    const bar = st.score && staff != null ? M.barAt(st.score, M.starts(st.score.staves[staff])[index]) : -1;
    const system = st.view.bars?.find((b) => b.bar === bar)?.system;
    for (const b of st.view.bars ?? []) {
      if (system == null || b.system !== system) continue;
      y0 = Math.min(y0, b.box[1]);
      y1 = Math.max(y1, b.box[3]);
    }
    const g = geometry();
    if (!g) return;
    const a = g.at(x0 - 4, y0 - 10);
    const b = g.at(x1 + 4, y1 + 10);
    Object.assign(playhead.style, { left: `${a.x}px`, width: `${b.x - a.x}px`, top: `${a.y}px`, height: `${b.y - a.y}px` });
    playhead.hidden = false;
  }

  /** Keeps the note being played in sight. */
  function followPlaying() {
    const lit = playhead.hidden ? null : playhead;
    if (!lit) return;
    const box = lit.getBoundingClientRect();
    const frame = sheet.getBoundingClientRect();
    const top = Math.max(frame.top, 120);
    if (box.top < top || box.bottom > Math.min(frame.bottom, innerHeight)) lit.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // ---- Printing (Ctrl/Cmd+P) --------------------------------------------------------
  //
  // The page prints the score alone (application.css, @media print): drawn
  // again without the selection's colours, one picture per system, so a page
  // ends between two systems, never across one. The read page does the same
  // with the server's engraving (public/js/score.js, printCopy).

  /** The score as printed: one SVG per system, in a box the print stylesheet shows instead of the sheet. */
  function printCopy() {
    if (!root.isConnected) return stopPrinting();
    root.querySelector(".studio-print")?.remove();
    const shown = st.score ? M.toLilyPond(st.score, { written: st.written }).source : st.text;
    let view;
    try {
      view = JSON.parse(editor_view_lit(shown, Math.max(320, Math.floor(sheet.clientWidth - 2)), 8, "{}"));
    } catch {
      return; // A refused text: the sheet prints as it is.
    }
    // Where a page may turn: halfway between one system's bottom and the next one's top.
    const systems = [];
    for (const bar of view.bars ?? []) {
      const [, top, , bottom] = bar.box;
      const s = (systems[bar.system] ??= { top, bottom });
      s.top = Math.min(s.top, top);
      s.bottom = Math.max(s.bottom, bottom);
    }
    const cuts = [];
    for (let k = 1; k < systems.length; k++) if (systems[k] && systems[k - 1]) cuts.push((systems[k - 1].bottom + systems[k].top) / 2);
    const box = Object.assign(document.createElement("div"), { className: "studio-print" });
    box.setAttribute("aria-hidden", "true");
    box.innerHTML = M.printBands(view.svg, cuts).join("");
    sheet.after(box);
  }

  function dropPrintCopy() {
    root.querySelector(".studio-print")?.remove();
  }

  // The listeners go with the editor: a page swapped out by instant navigation stops printing it.
  function stopPrinting() {
    window.removeEventListener("beforeprint", printCopy);
    window.removeEventListener("afterprint", dropPrintCopy);
  }
  window.addEventListener("beforeprint", printCopy, { signal: ctx.signal });
  window.addEventListener("afterprint", dropPrintCopy, { signal: ctx.signal });

  const sheetSize = new ResizeObserver(() => draw());
  sheetSize.observe(sheet);
  ctx.observers.push(sheetSize);

  return { geometry, draw, placeOverlay, followPlaying };
}
