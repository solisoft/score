// The studio's drawing (studio.js): the score engraved as it now is, the
// selection and the cursor lit; over it, the palette, the selected bars, the
// repeats' grips and the playhead; and the copy printed.

// The editor's words in the page's language (#508).
const V = new URL(import.meta.url).search;
const { tr } = await import(`./words.js${V}`);

const COLOURS = { selection: "#b4373a", head: "#e0662a", cursor: "#2563c9", playing: "#0f9d47" };

/** Answers the drawing: the score engraved, and what goes over it. */
export function install(ctx) {
  const { root, options, sheet, svgHost, overlay, palette, playhead, st, loaded, M, editor_view_lit } = ctx;
  const { range, showInText, placeWords, wordsOpen, tellPlace, placePeers, placeMarkers, placeGhost, drawRoll, showState, refuse } = ctx.call;

  // ---- Drawing ------------------------------------------------------------------

  /** The colours over the drawing: the selection and the cursor (the notes playing go over it: see paintPlaying). */
  function lit(drawnItems = st.items) {
    const items = {};
    const heads = [];
    // A part's note drawn once for both parts (\\partCombine): lit through the note drawn.
    // Each note's item looked up, not searched for among every item for each note selected (#689).
    let numbers = null;
    const itemOf = (s, i) => {
      if (!numbers) {
        numbers = new Map();
        drawnItems.forEach((it, k) => {
          const key = `${it.staff}:${it.index}`;
          if (!numbers.has(key)) numbers.set(key, k);
        });
      }
      return M.drawnItem(drawnItems, numbers.get(`${s}:${i}`) ?? -1);
    };
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
    return JSON.stringify({ items, heads });
  }

  /** The engraving an edit checked its text with: drawn as it is when nothing has changed since. */
  let checked = null;

  /**
   * The score engraved as it is to be drawn: the text shown (with the other
   * voices' bars opened where the page writes in them), its width, spacing
   * and colours, and the engraver's answer — `view`, or the `error` it
   * refused the text with. An edit checks its text with this very engraving
   * (`check`): the drawing that follows is then that one, or — the selection
   * moved meanwhile — the same layout, which the engraver keeps, in other
   * colours. A long score is laid out once an edit, not twice (#689).
   */
  function engraving({ check = false } = {}) {
    let shown = st.text;
    let items = st.items;
    if (st.score) ({ source: shown, items } = M.toLilyPond(st.score, { open: openBars(), written: st.written }));
    const width = Math.max(320, Math.floor(sheet.clientWidth - 2));
    const space = 8 * st.zoom;
    const colours = st.score ? lit(items) : "{}";
    const same = checked && checked.shown === shown && checked.width === width && checked.space === space && checked.colours === colours;
    const drawing = same ? checked : { shown, items, width, space, colours };
    checked = check ? drawing : null;
    if (same) return drawing;
    // How many times the score was engraved: for a console, or a test.
    st.engravings = (st.engravings ?? 0) + 1;
    try {
      drawing.view = JSON.parse(editor_view_lit(shown, width, space, colours));
    } catch (error) {
      drawing.error = error;
    }
    return drawing;
  }

  async function draw() {
    await loaded();
    drawn(engraving());
  }

  /** `drawing` (an `engraving()`) on the page, and what goes over it. */
  function drawn(drawing) {
    st.items = drawing.items;
    if (drawing.view) {
      st.view = drawing.view;
      svgHost.innerHTML = st.view.svg;
      sheet.classList.remove("studio-sheet-refused");
    } else {
      st.view = null;
      svgHost.innerHTML = "";
      sheet.classList.add("studio-sheet-refused");
      refuse(drawing.error, drawing.shown);
    }
    shownAs = drawing;
    paintPlaying();
    placeWords();
    placeOverlay();
    placePlayhead();
    drawRoll();
    showState();
    if (!st.playing) showInText(false);
    tellPlace();
  }

  // ---- The notes playing --------------------------------------------------------
  //
  // Lit as the music reaches them, many times a second: their coloured copies
  // put over the drawing as it stands — never the score written and engraved
  // again, its whole picture replaced, for each note (#689). The copies come
  // from one engraving of the same text with each note in a colour of its own
  // (the engraver keeps the layout it has just made: only the colours are
  // drawn), sorted out by that colour.

  /** What was last drawn (an `engraving()`). */
  let shownAs = null;
  /** The notes' copies for a drawing: { shown, width, space, of: Map item → SVG }. */
  let copies = null;

  /** Each item's copy, in the colour of the notes playing, for the drawing as it now is; null without one. */
  function playingCopies() {
    const now = shownAs;
    if (!now?.view) return null;
    if (copies && copies.shown === now.shown && copies.width === now.width && copies.space === now.space) return copies.of;
    const items = {};
    for (const it of now.view.items) items[it.item] = `#${(it.item + 1).toString(16).padStart(6, "0")}`;
    const of = new Map();
    try {
      const { svg } = JSON.parse(editor_view_lit(now.shown, now.width, now.space, JSON.stringify({ items, heads: [] })));
      // The drawing itself is in currentColor: what has a colour of its own is an item's copy.
      for (const [element, colour] of svg.matchAll(/<[a-z]+\b[^<>]*?\bfill="#([0-9a-f]{6})"[^<>]*\/>/g)) {
        const item = parseInt(colour, 16) - 1;
        of.set(item, (of.get(item) ?? "") + element.replace(`fill="#${colour}"`, `fill="${COLOURS.playing}"`));
      }
    } catch {
      return null;
    }
    copies = { shown: now.shown, width: now.width, space: now.space, of };
    return of;
  }

  /** The notes playing now (`st.playing.now`) lit over the drawing, those lit before no longer. */
  function paintPlaying() {
    const svg = svgHost.querySelector("svg");
    svg?.querySelector(":scope > .studio-playing")?.remove();
    const now = st.playing?.now;
    if (!svg || !now?.length) return;
    const lit = now.map((item) => playingCopies()?.get(item) ?? "").join("");
    if (lit) svg.insertAdjacentHTML("beforeend", `<g class="studio-playing">${lit}</g>`);
  }

  /** The notes playing changed: lit, the band over them (and the MIDI view's notes) moved, kept in sight. */
  function showPlaying() {
    paintPlaying();
    placePlayhead();
    if (st.mode === "midi") drawRoll();
    followPlaying();
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
    // Kept inside the sheet's visible width: on a phone it wraps, and a note
    // near the right edge no longer leaves most of it cut off (#443).
    palette.style.left = `${sheet.scrollLeft}px`; // measured at its full width, not squeezed by the last place
    const right = sheet.scrollLeft + sheet.clientWidth - 4 - palette.offsetWidth;
    palette.style.left = `${Math.max(sheet.scrollLeft + 4, Math.min(corner.x - 10, right))}px`;
    palette.style.top = below ? `${corner.y + 10}px` : `${Math.max(4, corner.y - palette.offsetHeight - 8)}px`;
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
        here.innerHTML = `<button type="button" data-act="comment" title="${tr("Comment on the selection (Ctrl+Alt+M)")}">💬 ${tr("Comment")}</button>`;
      }
    }
    (st.score.repeats ?? []).forEach((r, i) => {
      const grip = (bar, side, edge, label) => {
        const box = boxOf(bar);
        if (!box) return;
        const x = side === "start" ? box[0] : box[2] + 2;
        const el = add("studio-grip", x - 5 / g.scale, box[1], x + 5 / g.scale, box[3], { title: tr("{grip} — drag to another bar line", { grip: label }) });
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

  return { geometry, draw, engraving, placeOverlay, followPlaying, showPlaying, playingCopies };
}
