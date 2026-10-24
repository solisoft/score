// The dialogs of Edit ▸ Drum grid…, Arpeggiate… and Chord track…: they ask
// what to write, and patterns.js writes it, as one undoable edit of the
// studio's (`studio.edit`). Built here, so the page's template only lists
// the menu items.
//
// studio.js calls `install(studio)` once, then `open(name)` from its actions.

const V = new URL(import.meta.url).search;
const G = await import(`./patterns.js${V}`);

const LABELS = {
  cymc: "Crash", cymr: "Ride", hho: "Open hi-hat", hh: "Hi-hat", tomh: "High tom", tommh: "Mid tom", tomfh: "Floor tom", sn: "Snare", bd: "Kick",
};
const ARP_NAMES = { up: "Up", down: "Down", "up-down": "Up and down", random: "Random" };
const STEP_NAMES = { 8: "Eighths", 16: "Sixteenths", "8t": "Triplet eighths" };
const STYLE_NAMES = { block: "Block chords", arpeggio: "Arpeggiated", "bass-chord": "Bass, then the chord" };

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

function dialog(root, kind, title) {
  const box = el("dialog", { className: `studio-keys studio-pattern studio-${kind}` });
  box.dataset[kind.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = "";
  const close = el("button", { type: "button", className: "studio-menu", textContent: "×", title: "Close" });
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", () => box.close());
  box.append(el("div", { className: "studio-keys-head" }, el("h2", { textContent: title }), close));
  box.addEventListener("click", (event) => {
    if (event.target === box) box.close();
  });
  root.append(box);
  return box;
}

const select = (label, field, choices, value) => {
  const menu = el("select");
  menu.dataset[field] = "";
  for (const [key, name] of Object.entries(choices)) menu.append(new Option(name, key));
  menu.value = String(value);
  return el("label", { className: "tool-field" }, `${label} `, menu);
};

export function install(studio) {
  const { root, st, M } = studio;

  // ---- The drum grid -------------------------------------------------------------

  const grid = { lane: 0, bar: 0, data: null, loopBefore: null };
  const gridBox = dialog(root, "drum-grid", "Drum grid");
  const gridHead = el("p", { className: "muted studio-pattern-note" });
  const gridTable = el("div", { className: "studio-grid" });
  gridTable.dataset.grid = "";
  const button = (text, act, title = "") => {
    const b = el("button", { type: "button", className: "tool", textContent: text, title });
    b.dataset.gridAct = act;
    return b;
  };
  gridBox.append(
    gridHead,
    gridTable,
    el("div", { className: "tool-row studio-grid-actions" }, button("◀ Bar", "previous", "The bar before"), button("Play ▶", "play", "Play the bar over and over"), button("Bar ▶", "next", "The bar after"), button("Clear", "clear", "Every cell silent")),
    el("p", { className: "muted studio-pattern-note", textContent: "A click strikes a step, a second accents it, a third silences it; the wheel over a cell does the same up and down. An accent is the stroke's: every drum of the step. Each change is written into the staff, and Undo takes it back." }),
  );

  function laneAndBar() {
    const lanes = M.staffLanes(st.score).flatMap((s) => M.voiceLanes(st.score, s));
    const s = st.input.on ? st.input.staff : st.sel?.lanes?.[0] ?? st.sel?.staff;
    const t = st.input.on ? st.input.t : st.sel ? Math.min(st.sel.t0, st.sel.t1) : 0;
    if (s != null && M.isDrums(st.score, s)) return { lane: s, bar: st.sel?.bars?.[0] ?? Math.min(M.barAt(st.score, t), M.barsOf(st.score) - 1) };
    // Nothing of a drum staff selected: the first drum staff's first bar, when there is one.
    if (s == null) {
      const first = lanes.find((lane) => M.isDrums(st.score, lane));
      if (first != null) return { lane: first, bar: 0 };
    }
    return null;
  }

  function drawGrid() {
    const data = (grid.data = G.drumGrid(st.score, grid.lane, grid.bar));
    const beat = G.beatTicks(st.score, grid.bar) / G.GRID_STEP;
    gridHead.textContent = `Bar ${studio.barNo(grid.bar)}, ${data.steps} steps of a sixteenth.${data.fits ? "" : " Some strokes here fall between the steps: a change writes them on the steps."}`;
    gridTable.style.setProperty("--steps", data.steps);
    gridTable.replaceChildren(
      ...G.GRID_DRUMS.flatMap((name) => [
        el("span", { className: "studio-grid-name", textContent: LABELS[name] }),
        ...data.rows[name].map((value, k) => {
          const cell = el("button", { type: "button", className: `studio-grid-cell${k % beat === 0 ? " beat" : ""}` });
          cell.dataset.cell = `${name}:${k}`;
          cell.dataset.value = String(value);
          cell.setAttribute("aria-label", `${LABELS[name]}, step ${k + 1}: ${["silent", "struck", "accented"][value]}`);
          cell.setAttribute("aria-pressed", String(value > 0));
          return cell;
        }),
      ]),
    );
  }

  function openGrid() {
    if (!st.score) return studio.say("The drum grid needs the score tools: this piece is edited in its text.", true);
    const where = laneAndBar();
    if (!where) return studio.say("Select a bar of a drum staff first: the grid writes its strokes. Add one with + Staff, Drum kit.", true);
    Object.assign(grid, where, { loopBefore: st.loopBars });
    drawGrid();
    gridBox.showModal();
    loopBar();
  }

  /** The bar edited, played over and over: the studio's loop. */
  function loopBar() {
    const wasPlaying = Boolean(st.playing);
    studio.setLoop([grid.bar, grid.bar]);
    if (wasPlaying) studio.togglePlay();
  }

  gridBox.addEventListener("close", () => {
    if (st.playing) studio.stopPlay();
    const before = grid.loopBefore;
    if (JSON.stringify(st.loopBars) !== JSON.stringify(before)) studio.setLoop(before);
  });

  let replay = 0;
  function writeGrid(sound = null) {
    const done = studio.edit((score) => G.writeDrumGrid(score, grid.lane, grid.data));
    drawGrid();
    if (!done) return;
    if (st.playing) {
      // The loop heard as it is now: played again, from the bar's start.
      clearTimeout(replay);
      replay = setTimeout(() => {
        if (!st.playing) return;
        studio.stopPlay();
        studio.togglePlay();
      }, 250);
    } else if (sound) studio.P.preview([M.drumKey(sound)], 0, { drums: true });
  }

  function setCell(cell, value) {
    const [name, k] = cell.dataset.cell.split(":");
    const row = grid.data.rows[name];
    if (row[Number(k)] === value) return;
    row[Number(k)] = value;
    writeGrid(value > 0 ? name : null);
  }

  gridTable.addEventListener("click", (event) => {
    const cell = event.target.closest("[data-cell]");
    if (cell) setCell(cell, G.nextCell(Number(cell.dataset.value)));
  });
  gridTable.addEventListener("wheel", (event) => {
    const cell = event.target.closest("[data-cell]");
    if (!cell) return;
    event.preventDefault();
    const value = Number(cell.dataset.value);
    setCell(cell, Math.max(0, Math.min(2, value + (event.deltaY < 0 ? 1 : -1))));
  }, { passive: false });
  gridBox.addEventListener("click", (event) => {
    const act = event.target.closest("[data-grid-act]")?.dataset.gridAct;
    if (!act) return;
    if (act === "play") return studio.togglePlay();
    if (act === "clear") {
      for (const row of Object.values(grid.data.rows)) row.fill(0);
      return writeGrid();
    }
    const bar = grid.bar + (act === "next" ? 1 : -1);
    if (bar < 0) return;
    // Past the last bar, a bar more: a groove goes on.
    if (bar >= M.barsOf(st.score) && !studio.edit((score) => M.addBars(score, 1))) return;
    grid.bar = bar;
    drawGrid();
    loopBar();
  });

  // ---- The arpeggiator ---------------------------------------------------------------

  const arpBox = dialog(root, "arpeggiator", "Arpeggiate");
  arpBox.append(
    el("p", { className: "muted studio-pattern-note", textContent: "The selected chords broken into runs of their notes, each over the time it held." }),
    select("Pattern", "arpPattern", ARP_NAMES, "up"),
    select("Step", "arpStep", STEP_NAMES, "16"),
    select("Range", "arpOctaves", { 1: "One octave", 2: "Two octaves", 3: "Three octaves" }, 1),
    el("div", { className: "tool-row studio-new-actions" }, el("button", { type: "button", className: "tool tool-wide tool-primary", textContent: "Arpeggiate" })),
  );
  arpBox.querySelector(".tool-primary").dataset.arpApply = "";
  arpBox.querySelector("[data-arp-apply]").addEventListener("click", () => {
    const r = studio.range();
    if (!r) return studio.say("Select the chords to break first.", true);
    const value = (field) => arpBox.querySelector(`[data-${field}]`).value;
    const options = { pattern: value("arp-pattern"), step: value("arp-step"), octaves: Number(value("arp-octaves")) };
    let count = 0;
    if (studio.edit((score) => (count = G.arpeggiate(score, r.s, r.a, r.b, options)))) {
      arpBox.close();
      studio.say(`${count} chord${count === 1 ? "" : "s"} broken, ${ARP_NAMES[options.pattern].toLowerCase()}, in ${STEP_NAMES[options.step].toLowerCase()}. Undo takes it back.`);
    }
  });

  function openArpeggiator() {
    if (!st.score) return studio.say("The arpeggiator needs the score tools: this piece is edited in its text.", true);
    if (!studio.range()) return studio.say("Select the chords to break first: click the first, Shift+click the last.", true);
    arpBox.showModal();
  }

  // ---- The chord track ---------------------------------------------------------------

  const chordBox = dialog(root, "chord-track", "Chord track");
  const staffMenu = el("select");
  staffMenu.dataset.chordStaff = "";
  const scopeNote = el("p", { className: "muted studio-pattern-note" });
  chordBox.append(
    el("p", { className: "muted studio-pattern-note", textContent: "An accompaniment from the chord symbols, each chord held until the next and struck again each bar. What the staff held there is written over." }),
    el("label", { className: "tool-field" }, "Staff ", staffMenu),
    select("Style", "chordStyle", STYLE_NAMES, "block"),
    scopeNote,
    el("div", { className: "tool-row studio-new-actions" }, el("button", { type: "button", className: "tool tool-wide tool-primary", textContent: "Write the chords" })),
  );
  chordBox.querySelector(".tool-primary").dataset.chordApply = "";
  let chordBars = null;

  function openChordTrack() {
    if (!st.score) return studio.say("The chord track needs the score tools: this piece is edited in its text.", true);
    if (!G.chordSymbols(st.score).length) return studio.say("No chord symbols yet: add some with Insert ▸ Chord symbol (Ctrl+K), or ask the AI to suggest chords.", true);
    const lanes = M.staffLanes(st.score).filter((s) => !M.isDrums(st.score, s));
    if (!lanes.length) return studio.say("The chord track writes on a staff of notes: add one with + Staff.", true);
    staffMenu.replaceChildren(...lanes.map((s, n) => {
      const staff = st.score.staves[s];
      return new Option(staff.name || M.INSTRUMENTS[M.instrumentOf(st.score, s)]?.name || `Staff ${n + 1}`, String(s));
    }));
    // The selected staff, unless it holds the chord symbols (the melody, most often); else the
    // lowest staff without them: where an accompaniment usually goes.
    const marked = new Set(G.chordSymbols(st.score).map((c) => c.lane));
    const free = lanes.filter((s) => !marked.has(s));
    const chosen = free.includes(st.sel?.staff) ? st.sel.staff : free.at(-1) ?? lanes.at(-1);
    staffMenu.value = String(chosen);
    chordBars = st.sel ? studio.selectedBarsOrNull() : null;
    if (chordBars && chordBars[0] === chordBars[1] && !st.sel.bars) chordBars = null;
    scopeNote.textContent = chordBars ? `Bars ${studio.barNo(chordBars[0])}–${studio.barNo(chordBars[1])}, the selection.` : "The whole score.";
    chordBox.showModal();
  }

  chordBox.querySelector("[data-chord-apply]").addEventListener("click", () => {
    const s = Number(staffMenu.value);
    const style = chordBox.querySelector("[data-chord-style]").value;
    const scope = chordBars ? { a: chordBars[0], b: chordBars[1] } : {};
    let count = 0;
    if (studio.edit((score) => (count = G.chordTrack(score, s, { style, ...scope })))) {
      chordBox.close();
      studio.say(`${count} chord${count === 1 ? "" : "s"} written, ${STYLE_NAMES[style].toLowerCase()}. Undo takes it back.`);
    }
  });

  return {
    open(name) {
      if (name === "drum-grid") return openGrid();
      if (name === "arpeggiate") return openArpeggiator();
      if (name === "chord-track") return openChordTrack();
    },
  };
}
