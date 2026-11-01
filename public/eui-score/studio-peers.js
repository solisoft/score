// The studio in the app's room (studio.js): where this person works, told;
// where the others do, drawn; the comments' bubbles over the score.

// The editor's words in the page's language (#508).
const V = new URL(import.meta.url).search;
const { tr } = await import(`./words.js${V}`);

/** Answers where this person works and the others do, and the comments' bubbles. */
export function install(ctx) {
  const { options, overlay, st, M, R } = ctx;
  const { barNo, draw, drawRoll, placeOverlay } = ctx.call;

  // ---- Where the others work (the app's co-editing) ----------------------------------
  //
  // The embedder hears where this person works — `onPlace({ lane, bars })`,
  // or null — each time it changes, and hands back the others' places with
  // `peers([{ id, name, colour, lane, bars }])`: a band in their colour over
  // those bars of that staff, their name on it, in the score and the MIDI view.

  /** Where this person works: the staff and the bars of the selection or the cursor, or null. */
  function place() {
    if (!st.score) return null;
    const last = M.barsOf(st.score) - 1;
    const barOf = (t) => Math.max(0, Math.min(M.barAt(st.score, t), last));
    if (st.input.on) return { lane: st.input.staff, bars: [barOf(st.input.t), barOf(st.input.t)] };
    if (!st.sel) return null;
    const bars = st.sel.bars ?? [barOf(Math.min(st.sel.t0, st.sel.t1)), barOf(Math.max(st.sel.t0, st.sel.t1))];
    return { lane: st.sel.staff, bars: [bars[0], bars[1]] };
  }

  let told = "null";
  function tellPlace() {
    const now = JSON.stringify(place());
    if (now === told) return;
    told = now;
    options.onPlace?.(JSON.parse(now));
  }

  /** The others' places that fit this score. */
  function peersHere() {
    if (!st.score) return [];
    const bars = M.barsOf(st.score);
    return (st.peers ?? []).filter((p) => p.bars && st.score.staves[p.lane] && p.bars[0] < bars).map((p) => ({ ...p, bars: [p.bars[0], Math.min(p.bars[1], bars - 1)] }));
  }

  /** The others' bands over the engraving: one per bar, their name on the first of each line. */
  function placePeers(g, add) {
    const space = 8 * st.zoom;
    for (const peer of peersHere()) {
      const n = M.staffNumber(st.score, peer.lane);
      let line = null;
      for (let bar = peer.bars[0]; bar <= peer.bars[1]; bar++) {
        const box = st.view.bars?.find((b) => b.bar === bar);
        const top = box?.staves?.[n];
        if (top == null) continue;
        const el = add("studio-peer", box.box[0], top - space, box.box[2] + 3, top + 5 * space);
        el.style.setProperty("--peer", peer.colour);
        el.dataset.peer = peer.id;
        if (box.system !== line) {
          line = box.system;
          const label = Object.assign(document.createElement("span"), { className: "studio-peer-name", textContent: peer.name });
          el.appendChild(label);
        }
      }
    }
  }

  /** The others' bands over the MIDI view's roll, as SVG. */
  function rollPeers() {
    const peers = peersHere();
    if (!peers.length) return "";
    const geo = R.rollLayout(st.score, { layout: st.rollLayout, zoom: st.zoom, only: st.rollLayout === "keys" ? st.rollOnly : null });
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    return peers.map((peer) => {
      const track = geo.layout === "tracks" ? geo.tracks.find((t) => t.lane === peer.lane) : geo.tracks[0];
      if (!track) return "";
      const x0 = geo.x(M.barStart(st.score, peer.bars[0]));
      const x1 = geo.x(M.barStart(st.score, peer.bars[1] + 1));
      return `<g class="roll-peer" data-peer="${esc(peer.id)}"><rect x="${x0}" y="${track.y + 1}" width="${x1 - x0}" height="${track.h - 2}" rx="3" fill="${esc(peer.colour)}" fill-opacity="0.12" stroke="${esc(peer.colour)}" stroke-width="2" stroke-dasharray="5 3"/><text x="${x0 + 4}" y="${track.y + 12}" fill="${esc(peer.colour)}" font-size="11" font-weight="600">${esc(peer.name)}</text></g>`;
    }).join("");
  }

  // ---- Comments (the app's) ----------------------------------------------------------
  //
  // The embedder hands the comments' anchors over with `markers([{ id, lane,
  // bars, count, label }])`: a bubble over the first bar of each, on its
  // staff, which `onMarker(id)` hears clicked. `selectPlace` selects a
  // thread's bars; `placeLabel` names a place as the editor says it.

  /** The comments' bubbles over the engraving. */
  function placeMarkers(g, add) {
    if (!st.score) return;
    const bars = M.barsOf(st.score);
    const space = 8 * st.zoom;
    const seen = {};
    for (const marker of st.markers ?? []) {
      if (!st.score.staves[marker.lane] || marker.bars[0] >= bars) continue;
      const box = st.view.bars?.find((b) => b.bar === marker.bars[0]);
      const top = box?.staves?.[M.staffNumber(st.score, marker.lane)];
      if (top == null) continue;
      // Two threads on one bar of one staff: side by side.
      const at = `${marker.lane}:${marker.bars[0]}`;
      const nth = (seen[at] = (seen[at] ?? -1) + 1);
      const x = box.box[0] + space * (0.5 + 3.4 * nth);
      const el = add("studio-note-marker", x, top - 3.2 * space, x + 3 * space, top - 0.6 * space);
      el.innerHTML = `<button type="button" title="">💬${marker.count > 1 ? `<span>${Number(marker.count)}</span>` : ""}</button>`;
      // The thread's place as it was named when it was started (saved with it).
      const where = marker.label ?? placeLabel(marker);
      el.firstChild.title = marker.count === 1 ? tr("{where}: 1 message", { where }) : tr("{where}: {n} messages", { where, n: marker.count });
      el.dataset.thread = marker.id;
    }
  }

  overlay.addEventListener("click", (event) => {
    const marker = event.target.closest(".studio-note-marker");
    if (marker) options.onMarker?.(marker.dataset.thread);
  });

  function setMarkers(list) {
    st.markers = list ?? [];
    if (st.score) placeOverlay();
  }

  /** A place said: "Bars 3–5, Piano" — in English, as the thread started there keeps it (comments.js). */
  function placeLabel(where) {
    if (!where?.bars) return "";
    const [a, b] = where.bars;
    const bars = a === b ? `Bar ${barNo(a)}` : `Bars ${barNo(a)}–${barNo(b)}`;
    const lane = st.score ? R.laneNames(st.score)[where.lane] : null;
    return lane ? `${bars}, ${lane}` : `${bars}, staff ${where.lane + 1}`;
  }

  /** A thread's bars selected and shown; false when the score no longer has them. */
  function selectPlace(where) {
    if (!st.score || !where?.bars || !st.score.staves[where.lane]) return false;
    const bars = M.barsOf(st.score);
    if (where.bars[0] >= bars) return false;
    const to = Math.min(where.bars[1], bars - 1);
    const end = M.barStart(st.score, to + 1);
    const t0 = M.barStart(st.score, where.bars[0]);
    const inside = M.starts(st.score.staves[where.lane]).filter((t) => t >= t0 && t < end);
    st.input.on = false;
    st.sel = { staff: where.lane, t0, t1: inside.length ? Math.max(...inside) : t0, head: -1, bars: [where.bars[0], to], lanes: [where.lane] };
    draw().then(() => overlay.querySelector(".studio-bar-selected")?.scrollIntoView({ block: "center", behavior: "smooth" }));
    return true;
  }

  /** The others' places, as the embedder hears them: drawn at once. */
  function setPeers(list) {
    st.peers = list ?? [];
    if (!st.score) return;
    placeOverlay();
    drawRoll();
  }

  return { place, tellPlace, placePeers, rollPeers, placeMarkers, setMarkers, placeLabel, selectPlace, setPeers };
}
