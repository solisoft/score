// The dialogs of Edit ▸ Drum grid…, Arpeggiate…, Chord track… and
// Accompaniment…: they ask
// what to write, and patterns.js writes it, as one undoable edit of the
// studio's (`studio.edit`). Built here, so the page's template only lists
// the menu items.
//
// studio.js calls `install(studio)` once, then `open(name)` from its actions.

const V = new URL(import.meta.url).search;
const G = await import(`./patterns.js${V}`);
const D = await import(`./drums.js${V}`);
const A = await import(`./accompaniments.js${V}`);
const R = await import(`./riffs.js${V}`);

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

/** A menu of `items` ({ id, name, group }) in groups, as the catalogues have them. */
const grouped = (field, items, value) => {
  const menu = el("select");
  menu.dataset[field] = "";
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.group)) groups.set(item.group, el("optgroup", { label: item.group }));
    groups.get(item.group).append(new Option(`${item.name} · ${item.time}`, item.id));
  }
  menu.append(...groups.values());
  menu.value = value;
  return menu;
};

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

  const grid = { lane: 0, bar: 0, data: null, loopBefore: null, bars: null };
  const grooveMenu = grouped("groove", D.GROOVES, "rock");
  const gridBox = dialog(root, "drum-grid", "Drum grid");
  const gridHead = el("p", { className: "muted studio-pattern-note" });
  const gridTable = el("div", { className: "studio-grid" });
  gridTable.dataset.grid = "";
  const button = (text, act, title = "") => {
    const b = el("button", { type: "button", className: "tool", textContent: text, title });
    b.dataset.gridAct = act;
    return b;
  };
  const grooveSpread = button("Every selected bar", "groove-spread", "The groove in each selected bar, its break in the last of each four");
  gridBox.append(
    gridHead,
    gridTable,
    el("div", { className: "tool-row studio-grid-actions" }, button("◀ Bar", "previous", "The bar before"), button("Play ▶", "play", "Play the bar over and over"), button("Bar ▶", "next", "The bar after"), button("Clear", "clear", "Every cell silent")),
    el("div", { className: "tool-row studio-grid-groove" },
      el("label", { className: "tool-field" }, "Groove ", grooveMenu),
      button("Basic bar", "groove-main", "The groove's basic bar in this bar"),
      button("Break", "groove-break", "The groove's break in this bar"),
      grooveSpread,
    ),
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
    // The drums struck that have no row, a groove's cowbell or ride bell: kept, and named.
    const others = [...new Set(data.others.flat())].map((name) => M.DRUMS.find((d) => d.name === name)?.label ?? name);
    const also = others.length ? ` Also struck, kept as they are: ${others.join(", ").toLowerCase()}.` : "";
    gridHead.textContent = `Bar ${studio.barNo(grid.bar)}, ${data.steps} steps of a sixteenth.${data.fits ? "" : " Some strokes here fall between the steps: a change writes them on the steps."}${also}`;
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
    const bars = st.sel ? studio.selectedBarsOrNull() : null;
    Object.assign(grid, where, { loopBefore: st.loopBars, bars: bars && bars[1] > bars[0] ? bars : null });
    grooveSpread.hidden = !grid.bars;
    if (grid.bars) grooveSpread.textContent = `Bars ${studio.barNo(grid.bars[0])}–${studio.barNo(grid.bars[1])}`;
    // A groove in the bar's metre, first.
    const time = M.timeAt(st.score, grid.bar).join("/");
    if (D.grooveOf(grooveMenu.value)?.time !== time) grooveMenu.value = D.GROOVES.find((g) => g.time === time)?.id ?? grooveMenu.value;
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
    if (act.startsWith("groove-")) {
      const groove = D.grooveOf(grooveMenu.value);
      if (act === "groove-spread") {
        const [a, b] = grid.bars;
        if (studio.edit((score) => G.writeGroove(score, grid.lane, a, b, groove))) studio.say(`${groove.name} in bars ${studio.barNo(a)}–${studio.barNo(b)}, a break every four. Undo takes it back.`);
        return drawGrid();
      }
      try {
        grid.data = G.grooveGrid(st.score, grid.bar, act === "groove-break" ? D.breakOf(groove) : groove.main, groove.time);
      } catch (error) {
        return studio.say(error.message, true);
      }
      if (groove.bpm && !st.playing) studio.say(`${groove.name}: about ${groove.bpm} to the beat${groove.swing ? ", swung" : ""}.`);
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

  // ---- The accompaniment (#441) ---------------------------------------------------

  const bandBox = dialog(root, "accompaniment", "Accompaniment");
  const bandStyle = grouped("bandStyle", A.STYLES, "pop");
  const bandAbout = el("p", { className: "muted studio-pattern-note" });
  // The guitar's part: the style's strumming, or a riff (#458).
  const bandRiff = grouped("bandRiff", R.RIFFS, "");
  bandRiff.prepend(new Option("Its strumming, as the style has it", ""));
  bandRiff.value = "";
  const bandScope = el("p", { className: "muted studio-pattern-note" });
  const check = (field, text, checked = true) => {
    const box = el("input", { type: "checkbox", checked });
    box.dataset[field] = "";
    return el("label", { className: "studio-band-check" }, box, ` ${text}`);
  };
  const bandParts = el("fieldset", { className: "studio-band-parts" }, el("legend", { textContent: "Instruments" }),
    ...A.PARTS.map((part) => {
      const label = check("bandPart", A.PART_NAMES[part]);
      label.querySelector("input").value = part;
      return label;
    }));
  const bandButton = (text, act, title) => {
    const b = el("button", { type: "button", className: `tool${act === "write" ? " tool-wide tool-primary" : ""}`, textContent: text, title });
    b.dataset.bandAct = act;
    return b;
  };
  bandBox.append(
    el("p", { className: "muted studio-pattern-note", textContent: "Guitar, piano, bass and drums played from the chord symbols, each on a staff of its own, added when the score has none. Written again in another style, on the same staves." }),
    el("label", { className: "tool-field" }, "Style ", bandStyle),
    bandAbout,
    el("label", { className: "tool-field" }, "Guitar plays ", bandRiff),
    bandParts,
    el("div", { className: "studio-band-options" }, check("bandDiagrams", "Guitar diagrams over the chords"), check("bandBreaks", "A drum break every four bars"), check("bandFeel", "The style's swing")),
    bandScope,
    el("div", { className: "tool-row studio-new-actions" }, bandButton("Listen ▶", "listen", "Write it and play four bars: Write keeps it, closing takes it back"), bandButton("Write", "write", "Write the accompaniment")),
  );
  // What Listen wrote: taken back when the dialog closes without Write, or before Listen again.
  let trial = null;
  let bandBars = null;

  function aboutStyle() {
    const style = A.styleOf(bandStyle.value);
    const groove = D.grooveOf(style.groove);
    bandAbout.textContent = `${style.time}, about ${style.bpm} to the beat${style.swing ? ", swung" : ""}. Drums: ${groove?.name ?? "—"}.`;
  }
  bandStyle.addEventListener("change", aboutStyle);

  function bandOptions() {
    const on = (field) => bandBox.querySelector(`[data-${field}]`).checked;
    return {
      parts: [...bandBox.querySelectorAll("[data-band-part]")].filter((box) => box.checked).map((box) => box.value),
      diagrams: on("band-diagrams"),
      breaks: on("band-breaks"),
      feel: on("band-feel"),
      ...(bandRiff.value ? { riff: bandRiff.value } : {}),
      ...(bandBars ? { a: bandBars[0], b: bandBars[1] } : {}),
    };
  }

  function takeBack() {
    if (!trial) return;
    if (st.playing) studio.stopPlay();
    // Taken back only when nothing was done after it.
    if (st.past.length === trial.depth) studio.undo();
    studio.setLoop(trial.loop);
    trial = null;
  }

  function writeBand(listen) {
    takeBack();
    const style = A.styleOf(bandStyle.value);
    const options = bandOptions();
    let done = null;
    const loop = st.loopBars;
    if (!studio.edit((score) => (done = A.arrange(score, style.id, options)))) return;
    const added = done.added.length ? ` Staves added: ${done.added.join(", ")}.` : "";
    if (!listen) {
      bandBox.close();
      return studio.say(`${style.name}: ${done.bars} bar${done.bars === 1 ? "" : "s"} written over ${done.chords} chord${done.chords === 1 ? "" : "s"}.${added} Undo takes it back.`);
    }
    trial = { depth: st.past.length, loop };
    const a = options.a ?? 0;
    studio.setLoop([a, Math.min(a + 3, (options.b ?? M.barsOf(st.score) - 1))]);
    // Said once the loop has started: its own message would cover this one.
    Promise.resolve(st.playing ? null : studio.togglePlay()).then(() => studio.say(`${style.name}, heard over four bars. Write keeps it; closing takes it back.`));
  }

  bandBox.addEventListener("click", (event) => {
    const act = event.target.closest("[data-band-act]")?.dataset.bandAct;
    if (act === "listen") return writeBand(true);
    if (act === "write") {
      // What was heard is what is kept.
      if (trial) {
        if (st.playing) studio.stopPlay();
        studio.setLoop(trial.loop);
        trial = null;
        bandBox.close();
        return studio.say(`${A.styleOf(bandStyle.value).name} written. Undo takes it back.`);
      }
      return writeBand(false);
    }
  });
  // Any change after Listen is heard again only on Listen: what Write keeps is what was heard.
  bandBox.addEventListener("change", () => {
    if (trial) takeBack();
  });
  bandBox.addEventListener("close", takeBack);

  function openAccompaniment() {
    if (!st.score) return studio.say("The accompaniment needs the score tools: this piece is edited in its text.", true);
    if (!G.chordSymbols(st.score).length) return studio.say("No chord symbols yet: add some with Insert ▸ Chord symbol (Ctrl+K), or ask the AI to suggest chords.", true);
    bandBars = st.sel ? studio.selectedBarsOrNull() : null;
    if (bandBars && bandBars[0] === bandBars[1] && !st.sel.bars) bandBars = null;
    bandScope.textContent = bandBars ? `Bars ${studio.barNo(bandBars[0])}–${studio.barNo(bandBars[1])}, the selection.` : "The whole score.";
    // A style in the score's metre, first.
    const time = M.timeAt(st.score, bandBars?.[0] ?? 0).join("/");
    if (A.styleOf(bandStyle.value)?.time !== time) bandStyle.value = A.STYLES.find((style) => style.time === time)?.id ?? bandStyle.value;
    aboutStyle();
    trial = null;
    bandBox.showModal();
  }

  return {
    open(name) {
      if (name === "drum-grid") return openGrid();
      if (name === "arpeggiate") return openArpeggiator();
      if (name === "chord-track") return openChordTrack();
      if (name === "accompaniment") return openAccompaniment();
    },
  };
}
