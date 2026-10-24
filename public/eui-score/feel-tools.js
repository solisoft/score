// The dialogs of Edit ▸ Quantize… and Play ▸ Swing and humanize… (#379).
// Quantize rewrites the selected notes (score-model.js quantizeLane), as one
// undoable edit; swing and humanize are how the score is played, kept in its
// meta line (`swing`, `humanize`) and put into the MIDI by feel.js — or, for
// swing, written into the notes (writeSwing). Built here, so the page's
// template only lists the menu items.
//
// studio.js calls `install(studio)` once, then `open(name)` from its actions.

const GRID_NAMES = {
  quarter: "Quarters",
  eighth: "Eighths",
  "eighth-triplet": "Triplet eighths",
  sixteenth: "Sixteenths",
  "sixteenth-triplet": "Triplet sixteenths",
  "thirty-second": "Thirty-seconds",
};
const UNIT_NAMES = { 8: "Eighths", 16: "Sixteenths" };

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

function dialog(root, kind, title) {
  const box = el("dialog", { className: `studio-keys studio-pattern studio-${kind}` });
  box.dataset[kind] = "";
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

const field = (label, input) => el("label", { className: "tool-field" }, `${label} `, input);

const choice = (name, choices, value) => {
  const menu = el("select");
  menu.dataset[name] = "";
  for (const [key, text] of Object.entries(choices)) menu.append(new Option(text, key));
  menu.value = String(value);
  return menu;
};

/** A slider with its value said beside it. */
const slider = (name, min, max, step, value, unit) => {
  const input = el("input", { type: "range", min, max, step, value });
  input.dataset[name] = "";
  const shown = el("output", { textContent: `${value} ${unit}` });
  input.addEventListener("input", () => (shown.textContent = `${input.value} ${unit}`));
  return { input, row: el("span", { className: "studio-feel-slider" }, input, shown) };
};

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function install(studio) {
  const { root, st, M } = studio;

  /** What the tools act on: the selected lanes and their span in ticks, or every lane of the whole score. */
  function scope() {
    const all = M.staffLanes(st.score).flatMap((s) => M.voiceLanes(st.score, s));
    const end = M.barStart(st.score, M.barsOf(st.score));
    if (!st.sel) return { lanes: all, from: 0, to: end, words: "the whole score" };
    if (st.sel.bars) {
      const [a, b] = st.sel.bars;
      const lanes = st.sel.lanes?.length ? st.sel.lanes : all;
      return { lanes, from: M.barStart(st.score, a), to: M.barStart(st.score, b + 1), words: `bars ${studio.barNo(a)}–${studio.barNo(b)}` };
    }
    const r = studio.range();
    if (!r) return { lanes: all, from: 0, to: end, words: "the whole score" };
    const at = M.starts(r.staff);
    return { lanes: [r.s], from: at[r.a], to: at[r.b] + M.ticksOf(r.staff.events[r.b]), words: "the selected notes" };
  }

  // ---- Quantize -------------------------------------------------------------------

  const quantizeBox = dialog(root, "quantize", "Quantize");
  const quantizeScope = el("p", { className: "muted studio-pattern-note" });
  const strength = slider("quantizeStrength", 0, 100, 5, 100, "%");
  const ends = choice("quantizeEnds", { starts: "Starts only: each note keeps its length", both: "Starts and ends: lengths fitted to the grid too" }, "starts");
  quantizeBox.append(
    el("p", {
      className: "muted studio-pattern-note",
      textContent:
        "A score is notation: its notes already sit on a grid, often a fine one — a recording fitted to thirty-seconds, swing written out. Quantizing moves each note's start to the nearest step of a coarser grid, counted from its bar line, or part of the way there. Notes landing together make a chord; a note reaching the next one's start stops there. Articulations, dynamics and words go with their notes; a triplet grid, or a tuplet in the way, rewrites the notes as a recording is written: pitches and rhythm kept, what was written on them not.",
    }),
    quantizeScope,
    field("Grid", choice("quantizeGrid", GRID_NAMES, "eighth")),
    field("Strength", strength.row),
    field("What moves", ends),
    el("div", { className: "tool-row studio-new-actions" }, el("button", { type: "button", className: "tool tool-wide tool-primary", textContent: "Quantize" })),
  );
  quantizeBox.querySelector(".tool-primary").dataset.quantizeApply = "";
  let quantizing = null;

  function openQuantize() {
    if (!st.score) return studio.say("Quantize needs the score tools: this piece is edited in its text.", true);
    quantizing = scope();
    quantizeScope.textContent = `What moves: ${quantizing.words}${quantizing.lanes.length > 1 ? `, on ${quantizing.lanes.length} staves and voices` : ""}.`;
    quantizeBox.showModal();
  }

  quantizeBox.querySelector("[data-quantize-apply]").addEventListener("click", () => {
    const value = (name) => quantizeBox.querySelector(`[data-${name}]`).value;
    const grid = value("quantize-grid");
    const options = { grid: M.RECORDING_GRIDS[grid], strength: Number(value("quantize-strength")) / 100, ends: value("quantize-ends") === "both" };
    const { lanes, from, to } = quantizing;
    let count = 0;
    const done = studio.edit((score) => {
      for (const s of lanes) count += M.quantizeLane(score, s, from, to, options);
    });
    if (!done) return;
    quantizeBox.close();
    studio.say(count ? `${plural(count, "note")} moved to ${GRID_NAMES[grid].toLowerCase()}${options.strength < 1 ? `, ${Math.round(options.strength * 100)} % of the way` : ""}. Undo takes it back.` : `Every note already sits on ${GRID_NAMES[grid].toLowerCase()}: nothing moved.`);
  });

  // ---- Swing and humanize ---------------------------------------------------------

  const feelBox = dialog(root, "feel", "Swing and humanize");
  const swing = slider("swingAmount", 50, 75, 1, 50, "%");
  const swingUnit = choice("swingUnit", UNIT_NAMES, 8);
  const timing = slider("humanizeTime", 0, 60, 1, 0, "ms");
  const loudness = slider("humanizeVelocity", 0, 30, 1, 0, "%");
  const writeScope = el("p", { className: "muted studio-pattern-note" });
  const button = (text, name, title) => {
    const b = el("button", { type: "button", className: "tool", textContent: text, title });
    b.dataset.feelAct = name;
    return b;
  };
  feelBox.append(
    el("h3", { textContent: "Swing" }),
    el("p", {
      className: "muted studio-pattern-note",
      textContent: "Played, not written: the first of each pair of eighths (or sixteenths) is held longer — 50 % even, 67 % a triplet feel, 75 % dotted. Play, Save the sound and Save as MIDI swing; the score stays as it is.",
    }),
    field("Swing", swing.row),
    field("Of", swingUnit),
    el("p", { className: "muted studio-pattern-note", textContent: "Or written into the notes: each even pair on the beat becomes a long and a short one." }),
    writeScope,
    el("div", { className: "tool-row" }, button("Write as triplets", "write-triplet", "Each pair a triplet of a long note and a short one"), button("Write dotted", "write-dotted", "Each pair a dotted note and a short one")),
    el("h3", { textContent: "Humanize" }),
    el("p", {
      className: "muted studio-pattern-note",
      textContent: "Each note struck a little early or late, a little softer or harder — the same each time it plays, until New take. On top of the dynamics: the score is not changed.",
    }),
    field("Timing, ±", timing.row),
    field("Velocity, ±", loudness.row),
    el("div", { className: "tool-row studio-new-actions" }, button("New take", "seed", "Other small differences, the same settings"), el("button", { type: "button", className: "tool tool-wide tool-primary", textContent: "Keep" })),
  );
  feelBox.querySelector(".tool-primary").dataset.feelApply = "";

  function openFeel() {
    if (!st.score) return studio.say("Swing and humanize need the score tools: this piece is edited in its text.", true);
    const meta = st.score.meta ?? {};
    const set = (s, value) => {
      s.input.value = String(value);
      s.input.dispatchEvent(new Event("input"));
    };
    set(swing, meta.swing?.amount ?? 50);
    swingUnit.value = String(meta.swing?.unit ?? 8);
    set(timing, meta.humanize?.time ?? 0);
    set(loudness, meta.humanize?.velocity ?? 0);
    writeScope.textContent = `Written over ${scope().words}.`;
    feelBox.showModal();
  }

  /** The dialog's settings into the score's meta line, as one undoable edit. */
  function keep(seed = null) {
    const amount = Number(swing.input.value);
    const time = Number(timing.input.value);
    const velocity = Number(loudness.input.value);
    const was = st.score.meta?.humanize;
    const patch = {
      swing: amount > 50 ? { amount, unit: Number(swingUnit.value) } : null,
      humanize: time || velocity ? { time, velocity, seed: seed ?? was?.seed ?? 1 } : null,
    };
    const done = studio.edit((score) => {
      const meta = { ...(score.meta ?? {}) };
      for (const [key, value] of Object.entries(patch)) {
        if (value == null) delete meta[key];
        else meta[key] = value;
      }
      score.meta = meta;
    });
    if (!done) return;
    const said = [patch.swing ? `swing ${amount} % on ${UNIT_NAMES[patch.swing.unit].toLowerCase()}` : "no swing", patch.humanize ? `humanized ±${time} ms, ±${velocity} %` : "not humanized"];
    studio.say(`Played with ${said.join(", ")}. Undo takes it back.`);
  }

  feelBox.querySelector("[data-feel-apply]").addEventListener("click", () => {
    keep();
    feelBox.close();
  });

  feelBox.addEventListener("click", (event) => {
    const act = event.target.closest("[data-feel-act]")?.dataset.feelAct;
    if (!act) return;
    if (act === "seed") return keep(((st.score.meta?.humanize?.seed ?? 1) % 100000) + 1);
    const feel = act === "write-dotted" ? "dotted" : "triplet";
    const unit = Number(swingUnit.value);
    const { lanes, from, to } = scope();
    let count = 0;
    const done = studio.edit((score) => {
      for (const s of lanes) count += M.writeSwing(score, s, from, to, { unit, feel });
    });
    if (!done) return;
    feelBox.close();
    studio.say(count ? `${plural(count, "pair")} of ${UNIT_NAMES[unit].toLowerCase()} written ${feel === "dotted" ? "dotted" : "as triplets"}. Undo takes it back.` : `No even pair of ${UNIT_NAMES[unit].toLowerCase()} on the beat there.`);
  });

  return {
    open(name) {
      if (name === "quantize") return openQuantize();
      if (name === "swing") return openFeel();
    },
  };
}
