// The score editor of the playground: a menu bar, a toolbox, the score, and
// its LilyPond source under it.
//
// The score is a model (score-model.js); every edit changes the model, the
// model writes the LilyPond, eui-score (WebAssembly) engraves it and says
// where each note is drawn. A source the model cannot hold — repeats, two
// voices on a staff… — is still engraved and its text can be edited; the
// notice says what it uses, and the score tools wait.
//
// The page's markup (app/views/playground/show.html.slv) carries the
// controls: `data-act` on what does something, `data-field` on what holds a
// setting. Nothing here is set up twice: `startStudio` runs from the page's
// inline module script, once per visit.

// Served immutable: this module's version goes to the ones it loads.
const V = new URL(import.meta.url).search;
const { loaded, toMidi, toPdf, download, engine } = await import(`./eui-score.js${V}`);
const M = await import(`./score-model.js${V}`);
const P = await import(`./player.js${V}`);
const R = await import(`./piano-roll.js${V}`);
const { editor_view_lit, score_json, source_spans } = engine;

/** The MusicXML reader and writer, loaded the first time a file needs it. */
const musicXml = () => import(`./musicxml.js${V}`);
const isMusicXmlName = (name) => /\.(musicxml|mxl|xml)$/i.test(name ?? "");

const COLOURS = { selection: "#b4373a", head: "#e0662a", cursor: "#2563c9", playing: "#0f9d47" };
const DRAFT = "eui-score-studio-draft";
const KEY_DURATIONS = { 2: 32, 3: 16, 4: 8, 5: 4, 6: 2, 7: 1 };
const LETTERS = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };
// The palette over the selected note: the changes made to a note most.
const PALETTE = [
  ["move", { how: "step", by: "1" }, "↑", "A step up (↑)"],
  ["move", { how: "step", by: "-1" }, "↓", "A step down (↓)"],
  ["alter", { alter: "-1" }, "♭", "Flat (−)"],
  ["alter", { alter: "0" }, "♮", "Natural (=)"],
  ["alter", { alter: "1" }, "♯", "Sharp (+)"],
  ["dot", {}, "•", "Dotted (.)"],
  ["tie", {}, "⁀", "Tie to the next note (T)"],
  ["art", { name: "staccato" }, "·", "Staccato"],
  ["art", { name: "accent" }, ">", "Accent"],
  ["rest", {}, "𝄽", "A rest instead (0)"],
];

/**
 * Starts the score editor in `root` (the markup of app/views/shared/_studio).
 *
 * options:
 * - `source`: the LilyPond to open. Given, it is what opens — no draft, no
 *   shared link (#s=) is read: the app opens the score it was asked for.
 * - `draft`: the localStorage key the draft is kept under, or false for none.
 * - `onChange(text)`: called with the source after every change.
 * - `onOpen(text, message)`: File › New, Open a file and Open an example
 *   hand it their source instead of loading it over the score: the app
 *   makes a new score of it, leaving the open one as it is.
 * - `greeting`: the first status line.
 * - `examples`: where the gallery's sources are served.
 * - `shareUrl`: where Share goes (the app's sharing page) instead of
 *   copying a link that holds the score.
 *
 * Answers `{ state, ready, source(), load(text, message) }`: `ready` settles
 * once the first score is drawn.
 */
export function startStudio(root, options = {}) {
  const $ = (selector) => root.querySelector(selector);
  const fixed = typeof options.source === "string";
  const draftKey = options.draft === false || (fixed && options.draft == null) ? null : (options.draft ?? DRAFT);
  const sheet = $("[data-sheet]");
  const sourceBox = $("[data-source]");
  const status = $("[data-status]");
  const state = $("[data-state]");
  const notice = $("[data-notice]");
  // The engraving goes in its own box: redrawing it leaves the words being
  // typed — absolutely placed beside it — where they are, focused.
  const svgHost = document.createElement("div");
  svgHost.className = "studio-svg";
  svgHost.append(...sheet.childNodes);
  sheet.appendChild(svgHost);
  // Over the drawing: the selected bars, and the edges of each repeat to drag.
  const overlay = document.createElement("div");
  overlay.className = "studio-overlay";
  sheet.appendChild(overlay);

  // Over the selected note, a palette of what is done to a note most.
  const palette = Object.assign(document.createElement("div"), { className: "studio-palette", hidden: true });
  palette.setAttribute("role", "toolbar");
  palette.setAttribute("aria-label", "The selected note");
  for (const [act, data, sign, title] of PALETTE) {
    const button = Object.assign(document.createElement("button"), { type: "button", textContent: sign, title });
    button.setAttribute("aria-label", title.replace(/\s*\(.*\)\s*$/, ""));
    Object.assign(button.dataset, { act, ...data });
    palette.appendChild(button);
  }
  // A press on it is not a press on the score under it.
  palette.addEventListener("pointerdown", (event) => event.stopPropagation());
  sheet.appendChild(palette);

  // The MIDI view, in place of the engraving when it is on: its layout's
  // switch, and the roll, which scrolls sideways.
  const rollHost = Object.assign(document.createElement("div"), { className: "studio-roll", hidden: true, tabIndex: 0 });
  rollHost.innerHTML = `<div class="studio-roll-bar"><span class="studio-roll-layouts" role="group" aria-label="MIDI view layout"><button type="button" class="studio-menu" data-act="roll-layout" data-layout="tracks" aria-pressed="true">Tracks</button><button type="button" class="studio-menu" data-act="roll-layout" data-layout="keys" aria-pressed="false">Keyboard</button></span><span class="studio-roll-only" data-roll-only hidden></span><span class="studio-roll-hint">Drag across bars and tracks to select a section; a click elsewhere lets it go. Drag on the bar numbers to set a loop; a click on it takes it away. On the keyboard, drag a note to move it, its right edge to change its length.</span></div><div class="studio-roll-scroll" data-roll-scroll></div>`;
  sheet.after(rollHost);
  const rollScroll = rollHost.querySelector("[data-roll-scroll]");

  // The playhead: a band over the column being played, every staff of it.
  const playhead = document.createElement("div");
  playhead.className = "studio-playhead";
  playhead.hidden = true;
  sheet.appendChild(playhead);

  const st = {
    score: null, // the model, or null when the text is all there is
    text: sourceBox.value,
    unsupported: [],
    items: [], // item number → { staff, index }
    view: null,
    sel: null, // { staff, t0, t1, head } — times, so an edit that merges rests keeps it
    input: { on: false, t: 0, staff: 0, base: 4, dots: 0, last: null },
    past: [],
    future: [],
    clip: null,
    zoom: 1,
    playing: null,
    drag: null,
    written: false, // transposing instruments shown as written, for reading only
    mode: "score", // or "midi": the MIDI view in place of the engraving
    rollLayout: "tracks", // the MIDI view's: a strip per track, or "keys", one keyboard
    rollOnly: null, // on the keyboard, one lane only (a double click on its track's name)
    rollDrag: null,
    recording: null, // { lane, bar, program, down, played } while keys are recorded
    loopBars: null, // [a, b]: the bars played over and over, set apart from the selection
  };
  // For a console or a test: the studio's state, on its element.
  root.studio = st;

  // A button drawn with a sign (𝅘𝅥, ♭, ↑, 3) tells a screen reader what it
  // does: its title, without the key in brackets.
  for (const button of root.querySelectorAll("button[title]")) {
    if (!button.hasAttribute("aria-label") && !/\p{L}{2}/u.test(button.textContent)) button.setAttribute("aria-label", button.title.replace(/\s*\(.*\)\s*$/, ""));
  }

  // The toolbox's sections fold, and stay as the person left them.
  const FOLDED = "eui-score-studio-folded";
  let folded = {};
  try {
    folded = JSON.parse(localStorage.getItem(FOLDED) || "{}");
  } catch (error) {}
  for (const section of root.querySelectorAll("details[data-section]")) {
    if (folded[section.dataset.section]) section.open = false;
    section.addEventListener("toggle", () => {
      folded[section.dataset.section] = !section.open;
      try {
        localStorage.setItem(FOLDED, JSON.stringify(folded));
      } catch (error) {}
    });
  }

  // The drum palette, for a drum staff: a button for each drum of the kit.
  const drumRow = root.querySelector("[data-drums]");
  for (const drum of M.DRUMS) {
    const button = Object.assign(document.createElement("button"), { type: "button", className: "tool", textContent: drum.label, title: `${drum.label} (${drum.name})` });
    button.dataset.act = "drum";
    button.dataset.name = drum.name;
    drumRow?.append(button);
  }

  // The intervals to transpose by; a major second by default.
  const intervalMenu = root.querySelector("[data-transpose-interval]");
  if (intervalMenu) {
    M.INTERVALS.forEach((it, k) => intervalMenu.append(new Option(it.name, String(k))));
    intervalMenu.value = String(M.INTERVALS.findIndex((it) => it.name === "major second"));
  }

  // The instrument menus, from INSTRUMENTS by family; the new staff's offers
  // the piano's lower staff too, in the bass clef.
  for (const select of root.querySelectorAll("[data-instruments]")) {
    const families = new Map();
    M.INSTRUMENTS.forEach((it, k) => {
      if (!families.has(it.family)) families.set(it.family, Object.assign(document.createElement("optgroup"), { label: it.family }));
      const group = families.get(it.family);
      group.append(new Option(it.name, String(k)));
      if (select.dataset.instruments === "new" && it.name === "Piano") group.append(new Option("Piano, lower staff", `${k}|bass`));
    });
    select.append(...families.values());
    // A second staff is most often a melody instrument: the violin, as before.
    if (select.dataset.instruments === "new") select.value = String(M.INSTRUMENTS.findIndex((it) => it.name === "Violin"));
  }

  // "New…": a dialog to start from a template, its title, key, metre, tempo and bars set.
  const newDialog = root.querySelector("[data-new]");
  const templateBox = newDialog.querySelector("[data-templates]");
  for (const template of M.TEMPLATES) {
    const label = Object.assign(document.createElement("label"), { className: "studio-template" });
    const radio = Object.assign(document.createElement("input"), { type: "radio", name: "template", value: template.id, id: `new-template-${template.id}`, checked: template.id === "piano" });
    const staves = template.staves.map((spec) => spec.name ?? spec.instrument).filter((name, k, all) => name !== all[k - 1]);
    label.append(radio, Object.assign(document.createElement("b"), { textContent: template.name }), Object.assign(document.createElement("small"), { textContent: template.about ?? staves.join(", ") }));
    templateBox.append(label);
  }
  for (const close of newDialog.querySelectorAll("[data-new-close]")) close.addEventListener("click", () => newDialog.close());
  const propertiesDialog = root.querySelector("[data-properties]");
  propertiesDialog?.querySelector("[data-properties-close]").addEventListener("click", () => propertiesDialog.close());
  propertiesDialog?.addEventListener("click", (event) => {
    if (event.target === propertiesDialog) propertiesDialog.close();
  });
  newDialog.addEventListener("click", (event) => {
    if (event.target === newDialog) newDialog.close();
  });
  newDialog.querySelector("[data-new-form]").addEventListener("submit", (event) => {
    const form = new FormData(event.target);
    const template = M.TEMPLATES.find((t) => t.id === form.get("template"));
    try {
      const metre = M.metreOf(form.get("time"));
      const score = M.fromTemplate(template.id, {
        title: form.get("title").trim(),
        composer: form.get("composer").trim(),
        key: Number(form.get("key")),
        time: metre.time,
        bpm: Number(form.get("bpm")) || 0,
        bars: Number(form.get("bars")) || 16,
      });
      score.timeParts = metre.parts;
      open(M.toLilyPond(score).source, `A new score: ${template.name.toLowerCase()}. Press N, then the letters, to write notes.`);
    } catch (error) {
      event.preventDefault();
      say(error.message, true);
    }
  });

  // File ▸ Print a part…: one staff, written as its player reads it.
  const partsDialog = root.querySelector("[data-parts]");
  const partsStaff = partsDialog?.querySelector("[data-parts-staff]");
  const partSource = () => M.toLilyPond(M.partOf(st.score, Number(partsStaff.value)), { written: true }).source;
  const partName = () => partsStaff.selectedOptions[0]?.textContent ?? "part";
  async function previewPart() {
    await loaded();
    const box = partsDialog.querySelector("[data-parts-preview]");
    try {
      box.innerHTML = engine.svg(partSource(), 560, 5.5, "{}");
    } catch (error) {
      box.textContent = error.message ?? String(error);
    }
  }
  function openParts() {
    if (!st.score) return say("A part needs the score tools: this piece is edited in its text.", true);
    partsStaff.replaceChildren(...M.staffLanes(st.score).map((s, n) => {
      const staff = st.score.staves[s];
      const name = staff.name || M.INSTRUMENTS[M.instrumentOf(st.score, s)]?.name || `Staff ${n + 1}`;
      return new Option(name, String(s));
    }));
    partsDialog.showModal();
    return previewPart();
  }
  partsStaff?.addEventListener("change", previewPart);
  partsDialog?.querySelector("[data-parts-close]").addEventListener("click", () => partsDialog.close());
  partsDialog?.querySelector("[data-parts-ly]").addEventListener("click", () => download(partSource(), `${fileName()} - ${partName()}.ly`, "text/x-lilypond"));
  partsDialog?.querySelector("[data-parts-pdf]").addEventListener("click", () => {
    toPdf(partSource(), `${title()} — ${partName()}`).then((pdf) => download(pdf, `${fileName()} - ${partName()}.pdf`, "application/pdf")).catch((e) => refuse(e));
  });

  // ---- Model ↔ text ----------------------------------------------------------

  function readText(text) {
    st.text = text;
    try {
      const result = M.fromParsed(JSON.parse(score_json(text)));
      st.score = result.score ?? null;
      st.unsupported = result.unsupported ?? [];
    } catch (error) {
      st.score = null;
      st.unsupported = [];
    }
  }

  function writeText() {
    if (!st.score) return;
    const { source, items } = M.toLilyPond(st.score);
    st.text = source;
    st.items = items;
    if (sourceBox.value !== source) sourceBox.value = source;
  }

  function snapshot() {
    return JSON.stringify({ score: st.score, text: st.text, sel: st.sel, input: st.input });
  }

  function restore(snap) {
    const s = JSON.parse(snap);
    st.score = s.score;
    st.text = s.text;
    st.sel = s.sel;
    st.input = s.input;
    st.unsupported = [];
    if (st.score) writeText();
    else {
      sourceBox.value = st.text;
      readText(st.text);
    }
  }

  /** Runs `fn` on the model as one undoable edit; a refusal leaves everything as it was. */
  function edit(fn, { keepFuture = false } = {}) {
    if (!st.score) return say("The score tools wait: this piece is edited in its text below.", true);
    if (st.written) return say("Written pitch is for reading: View ▸ Written pitch again to write, at concert pitch.", true);
    const before = snapshot();
    try {
      fn(st.score);
    } catch (error) {
      restore(before);
      return say(error.message ?? String(error), true);
    }
    writeText();
    // Nothing changed: no step to undo.
    if (st.text === JSON.parse(before).text) {
      draw();
      return true;
    }
    try {
      JSON.parse(editor_view_lit(st.text, 600, 7, "{}"));
    } catch (error) {
      restore(before);
      return say(`The engraver refuses that: ${error.message ?? error}`, true);
    }
    st.past.push(before);
    if (st.past.length > 300) st.past.shift();
    if (!keepFuture) st.future = [];
    if (status.dataset.fresh !== "1") say("");
    delete status.dataset.fresh;
    saveDraft();
    draw();
    return true;
  }

  function undo() {
    if (!st.past.length) return;
    st.future.push(snapshot());
    restore(st.past.pop());
    saveDraft();
    draw();
  }

  function redo() {
    if (!st.future.length) return;
    st.past.push(snapshot());
    restore(st.future.pop());
    saveDraft();
    draw();
  }

  // Every change ends here: the browser's draft (the playground's), and
  // whoever embeds the editor (the app, which saves to the account).
  function saveDraft() {
    if (draftKey) {
      try {
        localStorage.setItem(draftKey, st.text);
      } catch (error) {}
    }
    options.onChange?.(st.text);
  }

  // New, Open a file, an example: a score of its own where the embedder says
  // so (the app), else in place of this one (the playground, one draft).
  function open(text, message) {
    if (options.onOpen) return options.onOpen(text, message);
    load(text, message);
  }

  function load(text, message) {
    st.past.push(snapshot());
    st.future = [];
    sourceBox.value = text;
    readText(text);
    if (st.score) writeText();
    st.sel = null;
    st.input = { ...st.input, on: false, t: 0, staff: 0, last: null };
    saveDraft();
    draw();
    if (message) say(message);
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

  // ---- The drawing and the text, linked -------------------------------------------
  //
  // A note clicked on the score is selected in the text, and the caret put on
  // a note in the text selects it on the score — while the text is the one
  // the model writes; typed text not yet read back links nothing.

  let written = { text: null, spans: [] };
  const textMark = root.querySelector("[data-source-mark]");

  /** Each note of the model and where the source box writes it, or null while it holds other text. */
  function writtenPlaces() {
    if (!st.score) return null;
    const { source, items } = M.toLilyPond(st.score);
    if (source !== sourceBox.value) return null;
    if (written.text !== source) {
      let spans = [];
      try {
        spans = JSON.parse(source_spans(source));
      } catch (error) {}
      written = { text: source, spans };
    }
    return items.map((it, k) => ({ ...it, span: written.spans[k] }));
  }

  /** The selection's notes, marked in the text; `select` selects them there too and scrolls to them, the focus staying where it was. */
  function showInText(select) {
    const r = range();
    const places = r && !st.input.on ? writtenPlaces() : null;
    if (!places) return markText();
    const first = places.find((p) => p.staff === r.s && p.index === r.a)?.span;
    const last = places.find((p) => p.staff === r.s && p.index === r.b)?.span;
    if (!first || !last) return markText();
    markText(first[0], last[1]);
    if (!select || document.activeElement === sourceBox) return;
    const focused = document.activeElement;
    sourceBox.setSelectionRange(first[0], last[1]);
    if (focused && focused !== sourceBox && document.activeElement === sourceBox) focused.focus({ preventScroll: true });
    const lineHeight = parseFloat(getComputedStyle(sourceBox).lineHeight) || 18;
    const top = (sourceBox.value.slice(0, first[0]).split("\n").length - 1) * lineHeight;
    if (top < sourceBox.scrollTop || top > sourceBox.scrollTop + sourceBox.clientHeight - lineHeight) {
      sourceBox.scrollTop = Math.max(0, top - 2 * lineHeight);
    }
  }

  /** Marks `from`–`to` of the text behind it, seen while the focus is elsewhere; no arguments, no mark. */
  function markText(from, to) {
    if (!textMark) return;
    textMark.replaceChildren();
    if (from == null || sourceBox.value !== written.text) return;
    const text = sourceBox.value;
    const mark = Object.assign(document.createElement("mark"), { textContent: text.slice(from, to) });
    textMark.append(text.slice(0, from), mark, text.slice(to) + "\n");
    followText();
  }

  function followText() {
    if (!textMark) return;
    textMark.scrollTop = sourceBox.scrollTop;
    textMark.scrollLeft = sourceBox.scrollLeft;
  }

  sourceBox.addEventListener("scroll", followText);
  sourceBox.addEventListener("input", () => markText());

  /** The note the caret is on in the text, selected on the score. */
  function showOnScore() {
    if (typing || st.input.on || sourceBox.selectionStart !== sourceBox.selectionEnd) return;
    const caret = sourceBox.selectionStart;
    const place = writtenPlaces()?.find((p) => p.span && p.span[0] <= caret && caret <= p.span[1]);
    if (!place) return;
    const t = M.starts(st.score.staves[place.staff])[place.index];
    if (st.sel && st.sel.staff === place.staff && st.sel.t0 === t && st.sel.t1 === t) return;
    st.sel = { staff: place.staff, t0: t, t1: t, head: -1 };
    draw();
  }

  sourceBox.addEventListener("click", showOnScore);
  sourceBox.addEventListener("keyup", (event) => {
    if (event.key.startsWith("Arrow") || ["Home", "End", "PageUp", "PageDown"].includes(event.key)) showOnScore();
  });

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

  // ---- Note input ---------------------------------------------------------------

  function inputTicks() {
    return M.notated(st.input.base, st.input.dots);
  }

  function setInput(on) {
    if (on && st.score) {
      const r = range();
      st.input.staff = r ? r.s : 0;
      st.input.t = r ? M.starts(r.staff)[r.a] : 0;
      st.input.last = null;
    }
    st.input.on = Boolean(on && st.score);
    draw();
  }

  /** Writes at the cursor: `step` a letter (0–6), a drum's name, a MIDI key played ({ key }), or null for a rest. */
  function inputWrite(step, add) {
    const drum = typeof step === "string";
    const played = step !== null && typeof step === "object";
    return edit((score) => {
      const s = st.input.staff;
      if (step !== null && drum !== M.isDrums(score, s)) {
        throw new Error(drum ? "Drums go on a drum staff: add one with + Staff, Drum kit" : "A drum staff has drums, not pitches: the drum buttons write them");
      }
      const pitch = () => M.pitchOfKey(step.key, M.keyOf(score, s, st.input.t));
      const strike = (lane, i, extra) => {
        if (drum) return M.drumHit(score, lane, i, step, extra);
        if (played) return M.setPitch(score, lane, i, pitch(), extra);
        return M.letter(score, lane, i, step, extra);
      };
      if (add) {
        // The note just written; else the note at the cursor, or the one before it.
        const staff = score.staves[s];
        const at = M.starts(staff);
        const last = st.input.last && M.eventAt(score.staves[st.input.last.staff], st.input.last.t);
        let lane = s;
        let i = -1;
        if (st.input.last && last >= 0) [lane, i] = [st.input.last.staff, last];
        else {
          const here = at.findLastIndex((t) => t <= st.input.t);
          const before = at.findLastIndex((t) => t < st.input.t);
          i = staff.events[here] && !staff.events[here].rest && at[here] === st.input.t ? here : before;
        }
        if (i < 0 || score.staves[lane].events[i].rest) throw new Error("Shift+letter adds to a note's chord: write a note, or put the cursor on one");
        strike(lane, i, true);
        st.input.last = { staff: lane, t: M.starts(score.staves[lane])[i] };
        return;
      }
      const staff = score.staves[s];
      M.ensureLength(score, st.input.t + 1);
      let i = M.eventAt(staff, st.input.t);
      const ev = staff.events[i];
      if (ev?.tuplet) {
        // Into a tuplet's slot: the slot keeps its value.
        if (step === null) M.remove(score, s, i);
        else {
          if (!ev.rest) M.remove(score, s, i);
          i = M.eventAt(staff, st.input.t);
          strike(s, i, false);
        }
        const len = M.ticksOf(staff.events[M.eventAt(staff, st.input.t)]);
        st.input.last = step === null ? null : { staff: s, t: st.input.t };
        st.input.t += len;
      } else {
        const near = M.previousPitch(score, s, i < 0 ? staff.events.length : i);
        const content = step === null ? { rest: true } : { rest: false, pitches: [drum ? M.drumPitch(step) : played ? pitch() : M.nearestPitch(step, near, M.keyOf(score, s))] };
        M.write(score, s, st.input.t, inputTicks(), content);
        st.input.last = step === null ? null : { staff: s, t: st.input.t };
        st.input.t += inputTicks();
      }
      // Always room to write into.
      M.ensureLength(score, st.input.t + 1);
    });
  }

  function inputBack() {
    edit((score) => {
      const staff = score.staves[st.input.staff];
      const at = M.starts(staff);
      const i = at.findLastIndex((t) => t < st.input.t);
      if (i < 0) return;
      M.remove(score, st.input.staff, i);
      st.input.t = at[i];
      st.input.last = null;
    });
  }

  function inputTuplet(n) {
    edit((score) => {
      const s = st.input.staff;
      const staff = score.staves[s];
      const i = M.eventAt(staff, st.input.t);
      if (i >= 0 && staff.events[i].tuplet) throw new Error("already in a tuplet");
      M.tupletAt(score, s, st.input.t, inputTicks(), n);
    });
  }

  // ---- Actions ------------------------------------------------------------------

  // What changes or moves to a note sounds it, as the person works.
  const SOUNDING = new Set(["letter", "drum", "move", "alter", "head-up", "head-down", "next", "previous"]);

  function act(name, data = {}) {
    const done = doAct(name, data);
    if (SOUNDING.has(name)) Promise.resolve(done).then(hear);
    return done;
  }

  function doAct(name, data = {}) {
    switch (name) {
      case "new": return newDialog.showModal();
      case "properties": return root.querySelector("[data-properties]").showModal();
      case "midi-view": {
        if (!st.score) return say("The MIDI view needs the score tools: this piece is edited in its text.", true);
        st.mode = st.mode === "midi" ? "score" : "midi";
        const label = root.querySelector("[data-midi-label]");
        if (label) label.firstChild.textContent = st.mode === "midi" ? "Score view " : "MIDI view ";
        root.querySelector("[data-midi-button]")?.setAttribute("aria-pressed", String(st.mode === "midi"));
        say(st.mode === "midi" ? "MIDI view: drag across bars and tracks to select a section." : "Score view.");
        return draw();
      }
      case "roll-layout":
        st.rollLayout = data.layout === "keys" ? "keys" : "tracks";
        st.rollOnly = null;
        // A section on some tracks covers them all on one keyboard: the selection follows what is shown.
        if (st.rollLayout === "keys" && st.sel?.lanes) st.sel = null;
        return draw();
      case "insert-copied": return insertCopied();
      case "record": return record();
      case "set-loop": return setLoop(selectedBarsOrNull());
      case "clear-loop": return setLoop(null);
      case "written": {
        if (!st.score) return say("Written pitch needs the score tools: this piece is edited in its text.", true);
        st.written = !st.written;
        root.querySelector("[data-written-label]").firstChild.textContent = st.written ? "Concert pitch " : "Written pitch ";
        const moved = M.staffLanes(st.score).some((s) => M.transpositionOf(st.score.staves[s]));
        say(st.written ? (moved ? "Written pitch: transposing instruments as their players read them. For reading only." : "Written pitch: no instrument here is written apart from how it sounds.") : "Concert pitch: as it sounds, and as it is written into.");
        return draw();
      }
      case "parts": return openParts();
      case "break": {
        let bar;
        try {
          bar = selectedBars()[1];
        } catch (error) {
          return say("Select a bar first: the line or the page ends after it.", true);
        }
        const kind = (st.score?.breaks ?? {})[bar] === data.kind ? null : data.kind;
        if (edit((score) => M.setBreak(score, bar, kind))) say(kind ? `A new ${kind} after bar ${bar + 1}: the PDF is laid out so.` : `Bar ${bar + 1}: the line goes on.`);
        return;
      }
      case "undo": return undo();
      case "redo": return redo();
      case "play": return togglePlay();
      case "stop": return stopPlay();
      case "mute": case "solo": {
        const lane = Number(data.lane);
        const set = st.mix[name];
        if (set.has(lane)) set.delete(lane);
        else set.add(lane);
        applyMix();
        return renderMix();
      }
      case "keys": {
        const sheetOfKeys = root.querySelector("[data-keys]");
        if (sheetOfKeys.open) sheetOfKeys.close();
        else sheetOfKeys.showModal();
        return;
      }
      case "zoom-in": st.zoom = Math.min(2, Math.round((st.zoom + 0.1) * 10) / 10); return draw();
      case "tools": {
        const open = root.classList.toggle("studio-tools-open");
        root.querySelector('[data-act="tools"]').setAttribute("aria-expanded", String(open));
        return;
      }
      case "zoom-out": st.zoom = Math.max(0.5, Math.round((st.zoom - 0.1) * 10) / 10); return draw();
      case "save-ly": return download(st.text, `${fileName()}.ly`, "text/x-lilypond");
      case "save-musicxml": {
        // Written from the editor's own score: a text it cannot read has none.
        if (!st.score) return say("MusicXML is written from the score the editor reads; this text holds what it does not edit.", true);
        return musicXml()
          .then((X) => download(X.toMusicXML(st.score), `${fileName()}.musicxml`, "application/vnd.recordare.musicxml+xml"))
          .catch((error) => say(error.message ?? String(error), true));
      }
      case "save-pdf": return toPdf(st.text, title()).then((pdf) => download(pdf, `${fileName()}.pdf`, "application/pdf")).catch((e) => refuse(e));
      // In the app, a saved score's own sharing page; elsewhere a link that holds the score.
      case "share": return options.shareUrl ? location.assign(options.shareUrl) : share();
      case "transpose": {
        const it = M.INTERVALS[Number(root.querySelector("[data-transpose-interval]").value)];
        const way = Number(root.querySelector("[data-transpose-way]").value);
        const by = { steps: way * it.steps, semitones: way * it.semitones };
        const words = `${way > 0 ? "up" : "down"} a${/^[ao]/.test(it.name) ? "n" : ""} ${it.name}`;
        if (data.scope === "score") {
          if (edit((score) => M.transpose(score, by))) say(`The score, ${words}.`);
          return;
        }
        const r = range();
        if (!r) return say("Select the notes to transpose, or transpose the score", true);
        if (edit((score) => M.transpose(score, { ...by, s: r.s, a: r.a, b: r.b }))) say(`${r.b - r.a + 1} selected, ${words}.`);
        return;
      }
      case "save-midi": return toMidi(...heard(st.score)).then((m) => download(m, `${fileName()}.mid`, "audio/midi")).catch((e) => refuse(e));
      case "save-wav": return saveWav();
      case "save-svg": case "save-png": return saveImage(name === "save-png");
      case "mode-select": return setInput(false);
      case "mode-input": return setInput(true);
      case "duration": return duration(Number(data.base), st.input.on ? st.input.dots : 0);
      case "dot": return toggleDot();
      case "letter": {
        const add = data.add || root.querySelector("[data-chord-mode]")?.checked;
        if (st.input.on) return inputWrite(Number(data.step), add);
        return edit((score) => {
          const t = need();
          M.letter(score, t.s, t.i, Number(data.step), add, t.head);
        });
      }
      case "drum": {
        const add = data.add || root.querySelector("[data-chord-mode]")?.checked;
        if (st.input.on) return inputWrite(data.name, add);
        return edit((score) => {
          const t = need();
          M.drumHit(score, t.s, t.i, data.name, add);
        });
      }
      case "rest":
        if (st.input.on) return inputWrite(null);
        return edit((score) => {
          const r = range() ?? (() => { throw new Error("Select a note first"); })();
          for (let i = r.b; i >= r.a; i--) M.remove(score, r.s, i, r.a === r.b ? st.sel.head : -1);
        });
      case "move": return edit((score) => {
        const r = range();
        if (st.input.on || !r || r.a === r.b) {
          const t = need();
          M.move(score, t.s, t.i, data.how, Number(data.by), t.head);
          return;
        }
        // A note tied from one already moved has moved with it.
        for (let i = r.a; i <= r.b; i++) {
          if (!r.staff.events[i].rest && !(i > r.a && r.staff.events[i - 1].tie)) M.move(score, r.s, i, data.how, Number(data.by));
        }
      });
      case "alter": return edit((score) => {
        const t = need();
        M.setAlter(score, t.s, t.i, Number(data.alter), t.head);
      });
      case "tuplet":
        if (st.input.on) return inputTuplet(Number(data.n));
        return edit((score) => {
          const t = need();
          M.makeTuplet(score, t.s, t.i, Number(data.n));
        });
      case "untuplet": return edit((score) => {
        const t = need();
        const i = M.removeTuplet(score, t.s, t.i);
        keepOn(t.s, M.starts(score.staves[t.s])[i]);
      });
      case "tie":
        if (st.input.on && st.input.last) {
          // In note input, T writes the same note again, tied.
          return edit((score) => {
            const { staff: s, t } = st.input.last;
            const i = M.eventAt(score.staves[s], t);
            const ev = score.staves[s].events[i];
            M.write(score, s, st.input.t, inputTicks(), { rest: false, pitches: ev.pitches.map((p) => ({ ...p })) });
            M.toggleTie(score, s, M.eventAt(score.staves[s], t));
            st.input.last = { staff: s, t: st.input.t };
            st.input.t += inputTicks();
            M.ensureLength(score, st.input.t + 1);
          });
        }
        return edit((score) => {
          const t = need();
          M.toggleTie(score, t.s, t.i);
        });
      case "slur": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select the notes to slur: click the first, Shift+click the last"); })();
        M.toggleSlur(score, r.s, r.a, r.b);
      });
      case "hairpin": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select the notes the hairpin spans"); })();
        M.setHairpin(score, r.s, r.a, r.b, data.kind);
      });
      case "art": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select a note first"); })();
        for (let i = r.a; i <= r.b; i++) if (!r.staff.events[i].rest || data.name === "fermata") M.toggleArticulation(score, r.s, i, data.name);
      });
      case "grace": return edit((score) => {
        const t = need();
        M.setGrace(score, t.s, t.i, data.kind);
      });
      case "grace-add": return edit((score) => {
        const t = need();
        M.addGrace(score, t.s, t.i);
      });
      case "grace-move": return edit((score) => {
        const t = need();
        M.moveGrace(score, t.s, t.i, "step", Number(data.by));
      });
      case "grace-remove": return edit((score) => {
        const t = need();
        M.removeGraces(score, t.s, t.i);
      });
      case "arpeggio": return edit((score) => {
        const t = need();
        M.toggleArpeggio(score, t.s, t.i);
      });
      case "gliss": return edit((score) => {
        const t = need();
        M.toggleGlissando(score, t.s, t.i);
      });
      case "tremolo": return edit((score) => {
        const t = need();
        M.setTremolo(score, t.s, t.i, Number(data.value));
      });
      case "dynamic": return edit((score) => {
        const t = need();
        M.setDynamic(score, t.s, t.i, data.name);
      });
      case "lyrics": return openWords("lyric");
      case "chord": return openWords("chord");
      case "text": return openWords("text");
      case "expression": return openWords("expression");
      case "mark": return edit((score) => {
        const [b] = selectedBars();
        M.setMark(score, b, data.mark);
        const on = M.changeAt(score, b)?.mark === data.mark;
        say(`Bar ${b + 1}: ${on ? { letter: "a rehearsal letter", segno: "a segno", coda: "a coda" }[data.mark] : "mark taken away"}`);
      });
      case "jump": return edit((score) => {
        const [, b] = selectedBars();
        const jump = root.querySelector("[data-jump]").value;
        M.setJump(score, b, jump);
        say(M.changeAt(score, b)?.jump === jump ? `${M.JUMPS[jump]} at the end of bar ${b + 1} — Play takes it` : `Bar ${b + 1}: ${M.JUMPS[jump]} taken away`);
      });
      case "pedal": return edit((score) => {
        const t = need();
        M.setPedal(score, t.s, t.i, data.how);
      });
      case "repeat": return edit((score) => {
        const [a, b] = selectedBars();
        M.toggleRepeat(score, a, b);
        say(`Bars ${a + 1}–${b + 1}${(score.repeats ?? []).some((r) => r.from === a && r.to === b) ? " repeated" : ": repeat taken away"}`);
      });
      case "ending": return edit((score) => {
        const [a, b] = selectedBars();
        const ending = M.endingFromBars(score, a, b);
        const r = score.repeats.find((x) => x.to < a && M.repeatEnd(x) >= b);
        const at = (k) => r.to + 2 + r.endings.slice(0, k).reduce((x, y) => x + y, 0);
        const bars = (k) => (r.endings[k] > 1 ? `bars ${at(k)}–${at(k) + r.endings[k] - 1}` : `bar ${at(k)}`);
        say(ending === 1
          ? `Ending 1: ${bars(0)} · ending 2: ${bars(1)} — drag the 2. handle to change it`
          : `Ending ${ending + 1}: ${bars(ending)}`);
      });
      case "endings": return edit((score) => {
        const [a, b] = selectedBars();
        M.addEndings(score, a, b);
      });
      case "unrepeat": return edit((score) => M.removeRepeat(score, selectedBars()[0]));
      case "add-bar": return edit((score) => M.addBars(score, 1));
      case "remove-bar": return edit((score) => M.removeLastBar(score));
      case "insert-bar": return edit((score) => {
        // Before the selected bars, or the cursor's; at the end with nothing selected.
        const at = st.sel || st.input.on ? selectedBars()[0] : M.barsOf(score);
        M.insertBars(score, at, 1);
        if (st.input.on) st.input.t = M.barStart(score, at);
        else if (st.sel) st.sel = { staff: st.sel.staff, t0: M.barStart(score, at), t1: M.barStart(score, at), head: -1 };
        say(`A bar put in as bar ${at + 1}`);
      });
      case "delete-bars": return edit((score) => {
        const [a, b] = selectedBars();
        M.deleteBars(score, a, b);
        st.sel = null;
        if (st.input.on) st.input = { ...st.input, t: Math.min(st.input.t, M.barStart(score, Math.min(a, M.barsOf(score) - 1))), last: null };
        say(a === b ? `Bar ${a + 1} taken away` : `Bars ${a + 1}–${b + 1} taken away`);
      });
      case "add-staff": return edit((score) => {
        const [k, clef] = root.querySelector('[data-field="new-staff"]').value.split("|");
        const it = M.INSTRUMENTS[Number(k)] ?? M.INSTRUMENTS[0];
        const kit = it.drums ? { drums: true } : {};
        M.addStaff(score, { instrument: it.sound, name: it.name, short: it.short, clef: clef || it.clef || "treble", ...kit });
        st.sel = { staff: score.staves.length - 1, t0: 0, t1: 0, head: -1 };
      });
      case "voice": return toVoice(Number(data.voice));
      case "voice-remove": return edit((score) => {
        const s = staffOf();
        const upper = M.upperOf(score, s);
        M.removeVoice(score, s);
        // The lanes after the one taken away move up by one.
        const moved = (lane) => (lane === upper + 1 ? upper : lane > upper + 1 ? lane - 1 : lane);
        if (st.sel) st.sel = { ...st.sel, staff: moved(st.sel.staff), head: -1 };
        st.input.staff = moved(st.input.staff);
        say("Voice 2 taken away");
      });
      case "remove-staff": return edit((score) => {
        M.removeStaff(score, staffOf());
        st.sel = null;
        st.input.staff = 0;
      });
      case "copy": return copy(false);
      case "cut": return copy(true);
      case "paste": return paste();
      case "next": case "previous": return step(name === "next" ? 1 : -1, data.extend);
      case "head-up": case "head-down": return chordHead(name === "head-up" ? 1 : -1);
    }
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

  function duration(base, dots) {
    st.input.base = base;
    st.input.dots = dots;
    if (st.input.on || !range()) return draw();
    edit((score) => {
      const t = need();
      const start = M.starts(score.staves[t.s])[t.i];
      M.setDuration(score, t.s, t.i, base, dots);
      keepOn(t.s, start);
    });
  }

  function toggleDot() {
    if (st.input.on || !range()) {
      st.input.dots = st.input.dots ? 0 : 1;
      return draw();
    }
    const t = target();
    const ev = st.score.staves[t.s].events[t.i];
    duration(ev.base, ev.dots ? 0 : 1);
  }

  function step(by, extend) {
    if (!st.score) return;
    if (st.input.on) {
      const staff = st.score.staves[st.input.staff];
      const at = M.starts(staff);
      const i = at.findLastIndex((t) => t <= st.input.t);
      const next = Math.max(0, Math.min(at.length - 1, i + by));
      st.input.t = at[next];
      st.input.last = null;
      return draw();
    }
    const r = range();
    if (!r) return select(0, 0);
    const edge = extend ? M.starts(r.staff).indexOf(st.sel.t1) : by > 0 ? r.b : r.a;
    const next = Math.max(0, Math.min(r.staff.events.length - 1, edge + by));
    select(r.s, next, -1, extend);
  }

  function chordHead(by) {
    const t = target();
    if (!t) return;
    const ev = st.score.staves[t.s].events[t.i];
    if (ev.pitches.length < 2) return;
    const head = st.sel?.head ?? -1;
    const next = head < 0 ? (by > 0 ? ev.pitches.length - 1 : 0) : Math.max(0, Math.min(ev.pitches.length - 1, head + by));
    st.sel = { ...st.sel, head: next };
    draw();
  }

  // The clipboard is the system's too: what is copied goes there as
  // LilyPond, for another page or program; what another program copied is
  // pasted when it reads as music. The same text back is this page's own
  // clip, which keeps what the text cannot say.
  //
  // Selected bars are copied as a section — every track the selection
  // covers, bar for bar — which pastes over bars or goes in as new ones.
  function copy(cut) {
    if (st.sel?.bars && st.score) return copySection(cut);
    const r = range();
    if (!r) return say("Select what to copy", true);
    try {
      st.clip = M.copy(st.score, r.s, r.a, r.b);
      st.clipText = M.clipText(st.clip);
      say(`${r.b - r.a + 1} copied`);
    } catch (error) {
      return say(error.message, true);
    }
    navigator.clipboard?.writeText(st.clipText).catch(() => {});
    if (cut) edit((score) => {
      for (let i = r.b; i >= r.a; i--) M.remove(score, r.s, i);
    });
  }

  function copySection(cut) {
    const [a, b] = st.sel.bars;
    const lanes = st.sel.lanes ?? [st.sel.staff];
    let section;
    try {
      section = M.copySection(st.score, lanes, a, b);
    } catch (error) {
      return say(error.message, true);
    }
    st.clip = { section };
    st.clipText = M.sectionText(section);
    navigator.clipboard?.writeText(st.clipText).catch(() => {});
    const what = `${section.bars === 1 ? "1 bar" : `${section.bars} bars`} of ${lanes.length === 1 ? "1 track" : `${lanes.length} tracks`}`;
    if (!cut) return say(`${what} copied`);
    edit((score) => {
      const [t0, t1] = [M.barStart(score, a), M.barStart(score, b + 1)];
      for (const s of lanes) {
        const at = M.starts(score.staves[s]);
        for (let i = at.length - 1; i >= 0; i--) if (at[i] >= t0 && at[i] < t1 && !score.staves[s].events[i].rest) M.remove(score, s, i);
      }
    });
    say(`${what} cut`);
  }

  /** Where a section goes: the selected bar of the selected track (or the cursor's). */
  function sectionPlace() {
    if (st.input.on) return { lane: st.input.staff, bar: M.barAt(st.score, st.input.t) };
    if (!st.sel) return null;
    return { lane: st.sel.lanes?.[0] ?? st.sel.staff, bar: selectedBars()[0] };
  }

  function sectionSaid(skipped) {
    return skipped ? ` (${skipped === 1 ? "one track" : `${skipped} tracks`} had no staff below to go to)` : "";
  }

  /** The copied bars put in before the selected bar, as new bars: nothing written over. */
  async function insertCopied() {
    if (!st.score) return say("Inserting bars needs the score tools: this piece is edited in its text.", true);
    const place = sectionPlace();
    if (!place) return say("Select the bar to put the copied bars before", true);
    const clip = await clipboard().catch(() => null);
    if (!clip?.section) return say("Copy bars first: select them (drag across them), then Ctrl+C", true);
    let skipped = 0;
    edit((score) => {
      skipped = M.insertSection(score, place.lane, place.bar, clip.section);
      selectSectionQuietly(score, place.bar, place.bar + clip.section.bars - 1, place.lane, clip.section);
    });
    const n = clip.section.bars;
    say(`${n === 1 ? "1 bar" : `${n} bars`} put in as bar${n === 1 ? "" : "s"} ${place.bar + 1}${n === 1 ? "" : `–${place.bar + n}`}${sectionSaid(skipped)}`);
  }

  /** After a paste or an insert: the bars written selected, on the tracks they went to. */
  function selectSectionQuietly(score, a, b, lane, section) {
    const lanes = section.parts.map((part) => lane + part.offset).filter((s) => score.staves[s]);
    if (!lanes.length) return;
    const at = M.starts(score.staves[lanes[0]]);
    const last = Math.max(...at.filter((t) => t < M.barStart(score, b + 1)));
    st.sel = { staff: lanes[0], t0: M.barStart(score, a), t1: last, head: -1, bars: [a, b], lanes };
  }

  /** What to paste: the system clipboard's music, else this page's clip; null when there is none. */
  async function clipboard() {
    let text = "";
    try {
      text = (await navigator.clipboard?.readText())?.trim() ?? "";
    } catch (error) {}
    if (!text || text === st.clipText) return st.clip;
    return M.clipFromText(text, score_json);
  }

  async function paste() {
    const s = st.input.on ? st.input.staff : st.sel?.staff;
    const t = st.input.on ? st.input.t : st.sel?.t0;
    if (s == null || t == null) return say("Select where to paste", true);
    let clip;
    try {
      clip = await clipboard();
    } catch (error) {
      return say(`The clipboard's text is not music this reads: ${error.message ?? error}`, true);
    }
    if (!clip) return say("Nothing copied yet", true);
    if (clip.section) {
      if (!st.score) return say("Pasting bars needs the score tools", true);
      const place = sectionPlace();
      let skipped = 0;
      edit((score) => {
        skipped = M.pasteSection(score, place.lane, place.bar, clip.section);
        selectSectionQuietly(score, place.bar, place.bar + clip.section.bars - 1, place.lane, clip.section);
      });
      return say(`Pasted over bar${clip.section.bars === 1 ? "" : "s"} ${place.bar + 1}${clip.section.bars === 1 ? "" : `–${place.bar + clip.section.bars}`}${sectionSaid(skipped)}`);
    }
    edit((score) => {
      M.paste(score, s, t, clip);
      const end = t + clip.reduce((sum, p) => sum + p.ticks, 0);
      if (st.input.on) st.input.t = end;
    });
  }

  // ---- Lyrics and chord symbols ----------------------------------------------------

  let wordsBox = null;

  function openWords(kind) {
    let t = target();
    if (!t || !st.score) return say("Select a note first", true);
    closeWords();
    if (kind === "lyric") {
      const staff = st.score.staves[t.s];
      const skip = M.melismata(staff);
      if (staff.events[t.i].rest) return say("A syllable goes under a note: select a note", true);
      if (skip[t.i]) {
        // A note held from an earlier one (a tie, a slur) sings that note's syllable.
        let i = t.i;
        while (i > 0 && skip[i]) i--;
        t = { ...t, i };
        st.sel = { staff: t.s, t0: M.starts(staff)[i], t1: M.starts(staff)[i], head: -1 };
        say("That note is held from the one before (tie or slur): its syllable goes here.");
        draw();
      }
    }
    const ev = st.score.staves[t.s].events[t.i];
    const box = Object.assign(document.createElement("input"), { type: "text", className: `studio-words studio-words-${kind}` });
    box.value = wordsOf(ev, kind);
    box.placeholder = { lyric: "syllable", chord: "Am7", text: "solo", expression: "dolce" }[kind];
    box.setAttribute("aria-label", {
      lyric: "Syllable — Space next note, - hyphen, Enter done",
      chord: "Chord symbol — Space next note, Enter done",
      text: "Staff text — Enter done",
      expression: "Expression, in italics — Enter done",
    }[kind]);
    sheet.appendChild(box);
    wordsBox = { box, kind, s: t.s, t: M.starts(st.score.staves[t.s])[t.i] };
    placeWords();
    box.focus();
    box.select();
    box.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeWords();
        sheet.focus();
      } else if (event.key === "Enter") {
        event.preventDefault();
        commitWords();
        closeWords();
        sheet.focus();
      } else if ((event.key === " " && (kind === "lyric" || kind === "chord")) || event.key === "Tab" || (event.key === "-" && kind === "lyric")) {
        event.preventDefault();
        commitWords({ hyphen: event.key === "-" });
        nextWords();
      }
    });
    box.addEventListener("blur", () => setTimeout(() => {
      if (wordsBox?.box === box && document.activeElement !== box) {
        commitWords();
        closeWords();
      }
    }, 0));
  }

  /** The verse the lyrics box writes: the Verse menu's, 1 the first. */
  function verse() {
    return Number(root.querySelector("[data-verse]")?.value) || 1;
  }

  /** What a words box shows for `ev`: its syllable, chord symbol, staff text or expression. */
  function wordsOf(ev, kind) {
    if (kind === "lyric") return M.syllableOf(ev, verse())?.text ?? "";
    if (kind === "chord") return ev.chord ?? "";
    return M.textOf(ev, kind === "text" ? "staff" : "expression");
  }

  function commitWords(extra = {}) {
    if (!wordsBox) return;
    const { box, kind, s, t } = wordsBox;
    const value = box.value;
    edit((score) => {
      const i = M.eventAt(score.staves[s], t);
      if (kind === "lyric") {
        if (score.staves[s].events[i].rest) return;
        M.setLyric(score, s, i, value, Boolean(extra.hyphen), false, verse());
      } else if (kind === "chord") M.setChordSymbol(score, s, i, value);
      else M.setText(score, s, i, kind === "text" ? "staff" : "expression", value);
    });
  }

  function nextWords() {
    if (!wordsBox) return;
    const { kind, s, t } = wordsBox;
    const staff = st.score.staves[s];
    const at = M.starts(staff);
    let i = M.eventAt(staff, t) + 1;
    // Lyrics skip rests, tied-to notes and the notes under a slur (as
    // LilyPond sets them); a chord symbol goes on any note.
    const skip = M.melismata(staff);
    while (i < staff.events.length && (staff.events[i].rest || (kind === "lyric" && skip[i]))) i++;
    if (i >= staff.events.length) return closeWords();
    st.sel = { staff: s, t0: at[i], t1: at[i], head: -1 };
    draw();
    const ev = staff.events[i];
    wordsBox.t = at[i];
    wordsBox.box.value = wordsOf(ev, kind);
    placeWords();
    wordsBox.box.focus();
    wordsBox.box.select();
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

  function closeWords() {
    wordsBox?.box.remove();
    wordsBox = null;
  }

  function placeWords() {
    if (!wordsBox || !st.view) return;
    const k = st.items.findIndex((it) => it.staff === wordsBox.s && M.starts(st.score.staves[it.staff])[it.index] === wordsBox.t);
    const item = st.view.items.find((it) => it.item === k);
    const g = geometry();
    if (!item || !g) return;
    const [x0, y0, , y1] = item.box;
    const below = wordsBox.kind === "lyric" || wordsBox.kind === "expression";
    const corner = g.at(x0, below ? y1 : y0);
    wordsBox.box.style.left = `${corner.x - 6}px`;
    // A later verse's box a line lower, as its words stand.
    const line = wordsBox.kind === "lyric" ? (verse() - 1) * 26 * st.zoom : 0;
    wordsBox.box.style.top = below ? `${corner.y + 8 + line}px` : `${Math.max(0, corner.y - 36)}px`;
  }

  // ---- Drawing ------------------------------------------------------------------

  function lit() {
    const items = {};
    const heads = [];
    const itemOf = (s, i) => st.items.findIndex((it) => it.staff === s && it.index === i);
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
    // Drawn: the text, with the second voice's bars opened where the page writes in them.
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
    if (wordsBox) placeWords();
    placeOverlay();
    placePlayhead();
    drawRoll();
    showState();
    if (!st.playing) showInText(false);
  }

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
      if (!it) continue;
      lit.add(`${it.staff}:${it.index}`);
      const t = M.starts(st.score.staves[it.staff])[it.index];
      cursor = cursor == null ? t : Math.min(cursor, t);
    }
    const left = rollScroll.scrollLeft;
    rollScroll.innerHTML = R.drawRoll(st.score, { layout: st.rollLayout, zoom: st.zoom, sel: st.sel, lit, cursor, loop: st.loopBars, only: st.rollLayout === "keys" ? st.rollOnly : null });
    const only = rollHost.querySelector("[data-roll-only]");
    only.hidden = !(st.rollLayout === "keys" && st.rollOnly != null);
    if (!only.hidden) only.textContent = `${R.laneNames(st.score)[st.rollOnly] ?? ""} only`;
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
    say(`${a === b ? `Bar ${a + 1}` : `Bars ${a + 1}–${b + 1}`}, ${n === 1 ? "one track" : `${n} tracks`}: Ctrl+C copies them.`);
  }

  rollHost.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".studio-roll-bar") || !st.score) return;
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
    say(`${R.laneNames(st.score)[p.lane]} on the keyboard: Tracks or Keyboard shows them all again.`);
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
    try {
      i = M.moveNote(from, d.lane, d.index, change);
    } catch (error) {
      return;
    }
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
    const what = d.resize ? "made longer or shorter" : "moved";
    say(`Note ${what} — Ctrl+Z puts it back.`);
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

  /** The bars of a second voice the cursor or the selection is in: written even while they are rests. */
  function openBars() {
    const s = st.input.on ? st.input.staff : st.sel?.staff;
    if (s == null || !M.isLower(st.score, s)) return [];
    const [t0, t1] = st.input.on ? [st.input.t, st.input.t] : [Math.min(st.sel.t0, st.sel.t1), Math.max(st.sel.t0, st.sel.t1)];
    const last = M.barsOf(st.score) - 1;
    const out = [];
    for (let bar = Math.min(M.barAt(st.score, t0), last); bar <= Math.min(M.barAt(st.score, t1), last); bar++) out.push({ staff: s, bar });
    return out;
  }

  /** The cursor or the selection moved to the other voice of its staff, at the same time; voice 2 made when needed. */
  function toVoice(voice) {
    if (!st.score) return;
    const s = staffOf();
    const upper = M.upperOf(st.score, s);
    let lane = upper;
    if (voice === 2) {
      lane = M.lowerOf(st.score, upper);
      if (lane < 0) {
        // A voice of rests: nothing in the text changes, so no step to undo.
        lane = M.addVoice(st.score, upper);
        if (st.input.on && st.input.staff > upper) st.input.staff++;
      }
    }
    if (st.input.on) {
      st.input.staff = lane;
      st.input.last = null;
    } else if (st.sel) {
      const at = M.starts(st.score.staves[lane]);
      const t = Math.min(st.sel.t0, st.sel.t1);
      const start = Math.max(...at.filter((x) => x <= t));
      st.sel = { staff: lane, t0: start, t1: start, head: -1 };
    } else {
      st.sel = { staff: lane, t0: 0, t1: 0, head: -1 };
    }
    say(voice === 2 ? "Voice 2: notes written now go under voice 1, stems down" : "Voice 1");
    draw();
  }

  function showState() {
    root.classList.toggle("studio-input", st.input.on);
    root.classList.toggle("studio-text-only", !st.score);
    notice.hidden = Boolean(st.score) || !st.unsupported.length;
    if (!st.score && st.unsupported.length) {
      notice.textContent = `This piece uses ${st.unsupported.join(", ")}: the score editor does not edit those yet. It is engraved, and its text below can be edited.`;
    }
    for (const button of root.querySelectorAll('[data-act="duration"]')) button.classList.toggle("on", Number(button.dataset.base) === st.input.base);
    root.querySelector('.studio-toolbox [data-act="dot"]')?.classList.toggle("on", st.input.dots > 0);
    // The toolbox's toggles show their state; the menus' items of the same name do not.
    root.querySelector('.studio-toolbox [data-act="mode-input"]')?.classList.toggle("on", st.input.on);
    root.querySelector('.studio-toolbox [data-act="mode-select"]')?.classList.toggle("on", !st.input.on);
    const second = st.score ? M.isLower(st.score, staffOf()) : false;
    root.querySelector('.studio-toolbox [data-act="voice"][data-voice="1"]')?.classList.toggle("on", Boolean(st.score) && !second);
    root.querySelector('.studio-toolbox [data-act="voice"][data-voice="2"]')?.classList.toggle("on", second);
    // A drum staff writes with drums, the others with letters.
    const onDrums = Boolean(st.score) && M.isDrums(st.score, staffOf());
    if (drumRow) drumRow.hidden = !onDrums;
    for (const button of root.querySelectorAll('[data-act="letter"]')) button.hidden = onDrums;
    // The toggles say whether they are on.
    for (const button of root.querySelectorAll('.studio-toolbox :is([data-act="duration"], [data-act="dot"], [data-act^="mode-"], [data-act="voice"])')) {
      button.setAttribute("aria-pressed", String(button.classList.contains("on")));
    }
    for (const button of root.querySelectorAll('[data-act="undo"]')) button.disabled = !st.past.length;
    for (const button of root.querySelectorAll('[data-act="redo"]')) button.disabled = !st.future.length;
    const handle = st.playing?.handle;
    root.querySelector(".studio-play").textContent = !st.playing ? "▶ Play" : !handle ? "■ Stop" : handle.paused ? "▶ Play" : "❚❚ Pause";
    root.querySelector('.studio-menu[data-act="stop"]').hidden = !handle;
    renderMix();
    root.querySelector("[data-zoom-label]").textContent = `${Math.round(st.zoom * 100)} %`;
    for (const tool of root.querySelectorAll(".studio-toolbox .tool, .studio-toolbox input, .studio-toolbox select")) tool.disabled = !st.score;
    fillFields();
    // What is selected, in words.
    const value = `${({ 1: "whole", 2: "half", 4: "quarter", 8: "eighth", 16: "16th", 32: "32nd" })[st.input.base]}${st.input.dots ? ", dotted" : ""}`;
    if (st.playing) showProgress();
    else if (st.input.on) state.textContent = `Note input${M.isLower(st.score, st.input.staff) ? " · voice 2" : ""} · ${value} · A–G write, 0 rest, Esc to stop`;
    else {
      const r = range();
      if (!r) state.textContent = st.score ? "Click a note to select it · N to write notes" : "Text only";
      else if (r.a !== r.b) state.textContent = `${r.b - r.a + 1} selected`;
      else {
        const ev = r.staff.events[r.a];
        const len = ({ 1: "whole", 2: "half", 4: "quarter", 8: "eighth", 16: "16th", 32: "32nd" })[ev.base] + (ev.dots ? " dotted" : "") + (ev.tuplet ? ` (${ev.tuplet.n}-tuplet)` : "");
        state.textContent = (M.isLower(st.score, r.s) ? "Voice 2 · " : "") + (ev.rest ? `Rest · ${len}` : `${ev.pitches.length > 1 ? "Chord" : "Note"} ${ev.pitches.map((p, k) => (k === st.sel.head ? `[${M.pitchName(p.d, p.alter)}]` : M.pitchName(p.d, p.alter))).join(" ")} · ${len}`);
      }
    }
  }

  let filling = false;
  function fillFields() {
    if (!st.score) return;
    filling = true;
    const set = (field, value) => {
      const el = root.querySelector(`[data-field="${field}"]`);
      if (el && document.activeElement !== el) el.value = value ?? "";
    };
    const staff = st.score.staves[M.upperOf(st.score, staffOf())] ?? st.score.staves[0];
    set("title", st.score.header.title);
    set("subtitle", st.score.header.subtitle);
    set("composer", st.score.header.composer);
    set("key", String(st.score.key));
    set("time", M.timeText(st.score));
    set("bpm", st.score.tempo?.bpm || "");
    set("tempo-text", st.score.tempo?.text || "");
    set("group", st.score.group);
    const paper = st.score.paper?.size ?? "a4";
    set("paper-size", paper.replace(/landscape$/, ""));
    set("paper-orientation", paper.endsWith("landscape") ? "landscape" : "portrait");
    set("staff-size", String(st.score.paper?.staffSize ?? 20));
    const even = root.querySelector('[data-field="even-pages"]');
    if (even) even.checked = st.score.paper?.evenPages === true;
    set("staff-name", staff.name);
    set("staff-short", staff.short);
    set("staff-clef", staff.clef);
    set("staff-key", staff.key == null ? "" : String(staff.key));
    fillChanges(set);
    // An instrument the menu does not offer (from a source) shows as itself.
    const instrument = root.querySelector('[data-field="staff-instrument"]');
    if (instrument && document.activeElement !== instrument) {
      const k = M.instrumentOf(st.score, staffOf());
      instrument.querySelector("[data-other]")?.remove();
      if (k < 0) {
        const other = new Option(`Other: ${staff.instrument}`, "other");
        other.dataset.other = "";
        instrument.prepend(other);
      }
      instrument.value = k < 0 ? "other" : String(k);
    }
    filling = false;
  }

  const KEY_NAMES = ["C♭", "G♭", "D♭", "A♭", "E♭", "B♭", "F", "C", "G", "D", "A", "E", "B", "F♯", "C♯"];

  /** The changes section: the bar's own changes, and what is in force there otherwise. */
  function fillChanges(set) {
    const b = changeBar();
    const section = root.querySelector("[data-changes]");
    if (!section) return;
    const on = b != null && b > 0;
    section.querySelector("[data-change-bar]").textContent = b == null ? "—" : String(b + 1);
    section.querySelector("[data-change-hint]").textContent = b == null
      ? "Select a bar, or put the cursor in it: what changes here goes on to the next change."
      : b === 0 ? "Bar 1 is the piece's start: its key, metre and tempo are in File ▸ Score properties, its clef under This staff." : "What changes here goes on to the next change.";
    for (const el of section.querySelectorAll("[data-field]")) el.disabled = !on;
    if (!on) return;
    const s = staffOf();
    const c = M.changeAt(st.score, b);
    const was = { key: M.keyOf(st.score, s, M.barStart(st.score, b - 1)), time: M.timeAt(st.score, b - 1), clef: M.clefAt(st.score, s, b - 1), tempo: M.tempoAt(st.score, b - 1) };
    const first = (field, text) => {
      const option = section.querySelector(`[data-field="${field}"] option[value=""]`);
      if (option) option.textContent = `As before: ${text}`;
    };
    first("change-key", `${KEY_NAMES[was.key + 7]} major`);
    first("change-time", was.time.join("/"));
    first("change-clef", was.clef.replace("_8", " 8"));
    section.querySelector('[data-field="change-bpm"]').placeholder = was.tempo?.bpm ? `as before: ${was.tempo.bpm}` : "as before";
    set("change-key", c?.key == null ? "" : String(c.key));
    set("change-time", c?.time ? c.time.join("/") : "");
    set("change-bpm", c?.tempo?.bpm || "");
    set("change-tempo-text", c?.tempo?.text || "");
    set("change-clef", (st.score.staves[M.upperOf(st.score, s)].clefs ?? []).find((x) => x.bar === b)?.clef ?? "");
    const double = section.querySelector('[data-field="change-double"]');
    if (double) double.checked = c?.line === "||";
  }

  function onField(event) {
    const el = event.target.closest("[data-field]");
    if (!el || filling || el.dataset.field === "new-staff") return;
    const value = el.value;
    edit((score) => {
      const staff = score.staves[M.upperOf(score, staffOf())] ?? score.staves[0];
      switch (el.dataset.field) {
        case "title": case "subtitle": case "composer": score.header[el.dataset.field] = value; break;
        case "key": M.setKey(score, Number(value)); break;
        case "time": M.setMetre(score, value); break;
        case "bpm": score.tempo = { ...(score.tempo ?? { text: "", base: 4 }), bpm: Number(value) || 0 }; break;
        case "tempo-text": score.tempo = { ...(score.tempo ?? { base: 4, bpm: 0 }), text: value }; break;
        case "group": score.group = value; break;
        case "paper-size": case "paper-orientation": {
          const size = root.querySelector('[data-field="paper-size"]').value;
          const wide = root.querySelector('[data-field="paper-orientation"]').value === "landscape";
          M.setPaper(score, { size: size + (wide ? "landscape" : ""), staffSize: score.paper?.staffSize ?? null });
          break;
        }
        case "staff-size": M.setPaper(score, { size: score.paper?.size ?? "a4", staffSize: Number(value) }); break;
        case "even-pages": M.setEvenPages(score, el.checked); break;
        case "staff-name": staff.name = value; break;
        case "staff-short": staff.short = value; break;
        case "staff-clef": staff.clef = value; break;
        case "staff-key": M.setStaffKey(score, staffOf(), value === "" ? score.key : Number(value)); break;
        case "change-key": M.setKeyAt(score, changeBar(), value === "" ? null : Number(value)); break;
        case "change-time": {
          const b = changeBar();
          const [n, d] = value ? value.split("/").map(Number) : M.timeAt(score, b - 1);
          M.setTimeAt(score, b, n, d);
          break;
        }
        case "change-bpm": case "change-tempo-text": {
          const b = changeBar();
          const here = M.changeAt(score, b)?.tempo ?? { text: "", base: M.tempoAt(score, b - 1)?.base || 4, bpm: 0 };
          M.setTempoAt(score, b, el.dataset.field === "change-bpm" ? { ...here, bpm: Number(value) || 0 } : { ...here, text: value });
          break;
        }
        case "change-clef": M.setClefAt(score, staffOf(), changeBar(), value || null); break;
        case "change-double": M.setDoubleBar(score, changeBar(), el.checked); break;
        case "staff-instrument": if (value !== "other") M.setInstrument(score, staffOf(), Number(value)); break;
      }
    });
  }

  /** Copies a link holding the score; where the clipboard is refused, shows it to copy by hand. */
  async function share() {
    const link = `${location.origin}${location.pathname}#s=${await M.shareCode(st.text)}`;
    try {
      await navigator.clipboard.writeText(link);
      return say("Link copied: whoever opens it gets this score. It lives in the link, not on the site.");
    } catch (error) {
      say("Copy this link:");
      const field = Object.assign(document.createElement("input"), { type: "text", value: link, readOnly: true, className: "studio-link" });
      field.setAttribute("aria-label", "Link to this score");
      status.append(" ", field);
      field.select();
    }
  }

  /** A refusal of the text: its line, and a button that selects that place in the source. */
  function refuse(error, text = st.text) {
    const message = error.message ?? String(error);
    const place = M.refusalPlace(message, text);
    say(place ? place.message : message, true);
    if (!place || text !== sourceBox.value) return false;
    const show = Object.assign(document.createElement("button"), { type: "button", className: "studio-show", textContent: "Show" });
    show.addEventListener("click", () => {
      sourceBox.focus();
      sourceBox.setSelectionRange(place.at, place.at + 1);
      // The selected line, with two above it, at the top of the box.
      const lineHeight = parseFloat(getComputedStyle(sourceBox).lineHeight) || 18;
      sourceBox.scrollTop = Math.max(0, (place.line - 3) * lineHeight);
      sourceBox.scrollIntoView({ block: "nearest" });
    });
    status.append(" ", show);
    return false;
  }

  function say(message, error = false) {
    // Said during an edit: it outlives the edit's own clearing.
    status.dataset.fresh = "1";
    queueMicrotask(() => delete status.dataset.fresh);
    status.textContent = message;
    status.classList.toggle("studio-error", error);
    return false;
  }

  function title() {
    return st.score?.header.title || (st.text.match(/title\s*=\s*"([^"]*)"/)?.[1] ?? "score");
  }

  function fileName() {
    return title().trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "score";
  }

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

  sheet.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".studio-words")) return;
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

  // ---- Keyboard -------------------------------------------------------------------

  root.addEventListener("keydown", (event) => {
    // In a field, or in the shortcuts sheet (whose Esc closes it): not the score's keys.
    const field = event.target.closest("input, textarea, select, dialog");
    if (field) return;
    const key = event.key;
    const mod = event.ctrlKey || event.metaKey;
    const run = (name, data) => {
      event.preventDefault();
      act(name, data);
    };
    if (mod && key.toLowerCase() === "z") return run(event.shiftKey ? "redo" : "undo");
    if (mod && key.toLowerCase() === "y") return run("redo");
    if (mod && key.toLowerCase() === "c") return run("copy");
    if (mod && key.toLowerCase() === "x") return run("cut");
    if (mod && event.shiftKey && key.toLowerCase() === "v") return run("insert-copied");
    if (mod && key.toLowerCase() === "v") return run("paste");
    if (mod && key.toLowerCase() === "l") return run("lyrics");
    if (mod && key.toLowerCase() === "k") return run("chord");
    // Ctrl+Alt+1, 2: the voice, as MuseScore has it; event.code, since Alt changes the key.
    if (mod && event.altKey && ["Digit1", "Digit2", "Numpad1", "Numpad2"].includes(event.code)) return run("voice", { voice: event.code.slice(-1) });
    if (mod && ["3", "5", "6", "7"].includes(key)) return run("tuplet", { n: key });
    if (mod && (key === "Delete" || key === "Backspace")) return run("delete-bars");
    if (key === " " && !event.target.closest("button, summary")) return run("play");
    if (key === "?") return run("keys");
    if (mod) return;
    if (key === "Escape") {
      event.preventDefault();
      if (st.input.on) return setInput(false);
      st.sel = null;
      return draw();
    }
    if (key === "n" || key === "N") return run(st.input.on ? "mode-select" : "mode-input");
    if (key === "ArrowRight" || key === "ArrowLeft") return run(key === "ArrowRight" ? "next" : "previous", { extend: event.shiftKey });
    if ((key === "ArrowUp" || key === "ArrowDown") && event.altKey) return run(key === "ArrowUp" ? "head-up" : "head-down");
    if (key === "ArrowUp" || key === "ArrowDown") {
      return run("move", { how: event.shiftKey ? "semitone" : "step", by: key === "ArrowUp" ? 1 : -1 });
    }
    if (KEY_DURATIONS[key]) return run("duration", { base: KEY_DURATIONS[key] });
    if (key === ".") return run("dot");
    const letter = LETTERS[key.toLowerCase()];
    if (letter !== undefined && !event.altKey) return run("letter", { step: letter, add: event.shiftKey });
    if (key === "0") return run("rest");
    if (key === "]") return run("add-bar");
    if (key === "Insert") return run("insert-bar");
    if (key === "Delete" || (key === "Backspace" && !st.input.on)) return run("rest");
    if (key === "Backspace" && st.input.on) {
      event.preventDefault();
      return inputBack();
    }
    if (key === "+") return run("alter", { alter: Math.min(2, currentAlter() + 1) });
    if (key === "-") return run("alter", { alter: Math.max(-2, currentAlter() - 1) });
    if (key === "=") return run("alter", { alter: 0 });
    if (key === "l" || key === "L") return run("lyrics");
    if (key === "k" || key === "K") return run("chord");
    if (key === "t" || key === "T") return run("tie");
    if (key === "r" || key === "R") return run("record");
    if (key === "s" || key === "S") return run("slur");
  });

  // The shortcuts sheet closes on a click outside it, as on Esc.
  root.querySelector("[data-keys]")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });

  // Ctrl+arrows move by octaves; the browser keeps Ctrl+↑ for itself otherwise.
  root.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && (event.key === "ArrowUp" || event.key === "ArrowDown") && !event.target.closest("input, textarea, select")) {
      event.preventDefault();
      act("move", { how: "octave", by: event.key === "ArrowUp" ? 1 : -1 });
    }
  });

  function currentAlter() {
    const t = target();
    if (!t) return 0;
    const ev = st.score.staves[t.s].events[t.i];
    return (ev.pitches[t.head >= 0 ? t.head : 0] ?? { alter: 0 }).alter;
  }

  // ---- The controls ---------------------------------------------------------------

  root.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-act]");
    if (!button || button.disabled) return;
    const typing = ["lyrics", "chord", "text", "expression"].includes(button.dataset.act);
    const menu = button.closest(".studio-dropdown");
    if (menu) menu.open = false;
    if ((!button.closest(".studio-menubar") || menu) && !typing) sheet.focus({ preventScroll: true });
    act(button.dataset.act, { ...button.dataset, add: event.shiftKey });
  });

  // The menus: one open at a time, closed by Escape or a click elsewhere.
  const menus = [...root.querySelectorAll(".studio-dropdown")];
  for (const menu of menus) {
    menu.addEventListener("toggle", () => {
      if (menu.open) for (const other of menus) if (other !== menu) other.open = false;
    });
  }
  document.addEventListener("click", (event) => {
    for (const menu of menus) if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  root.addEventListener("keydown", (event) => {
    const open = menus.find((menu) => menu.open);
    if (event.key !== "Escape" || !open) return;
    open.open = false;
    open.querySelector("summary").focus();
    event.stopPropagation();
  }, true);

  root.addEventListener("change", (event) => {
    const el = event.target;
    const menu = el.closest(".studio-dropdown");
    if (menu) menu.open = false;
    if (el.matches('[data-act="example"]') && el.value) {
      const path = `${options.examples ?? "/examples"}/${el.value}/source.ly`;
      el.value = "";
      fetch(path).then((r) => r.text()).then((text) => open(text, "Example opened.")).catch(() => say("Could not open that example", true));
      return;
    }
    if (el.matches('[data-act="open"]') && el.files?.[0]) {
      const file = el.files[0];
      el.value = "";
      if (!isMusicXmlName(file.name)) {
        file.text().then((text) => open(text, `${file.name} opened.`));
        return;
      }
      // MusicXML, from MuseScore, Sibelius, Finale or Dorico: read as LilyPond.
      musicXml()
        .then(async (X) => X.fromMusicXML(await X.musicXmlOf(file)))
        .then(({ source, warnings }) => open(source, `${file.name} opened.${warnings.length ? ` Left out: ${warnings.join("; ")}.` : ""}`))
        .catch((error) => say(error.message ?? String(error), true));
      return;
    }
    if (el.matches("select[data-field], input[type=number][data-field], input[type=checkbox][data-field]")) onField(event);
  });
  root.addEventListener("input", (event) => {
    if (event.target.matches('input[type="text"][data-field]')) onField(event);
  });

  let typing = null;
  sourceBox.addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      typing = null;
      st.past.push(snapshot());
      st.future = [];
      readText(sourceBox.value);
      if (st.score) {
        // Keep what was typed; the model rewrites it on the next edit.
        st.items = M.toLilyPond(st.score).items;
      }
      saveDraft();
      draw();
    }, 250);
  });

  // Left alone, typed LilyPond is rewritten as the model writes it: one
  // notation, and every note where the score's tools expect it.
  sourceBox.addEventListener("change", () => {
    if (!st.score) return;
    writeText();
    saveDraft();
    draw();
  });

  new ResizeObserver(() => draw()).observe(sheet);

  // ---- Playing --------------------------------------------------------------------
  //
  // player.js plays the MIDI with MuseScore_General. The MIDI is written from
  // the score with every repeat played out, and `passes` says when each bar
  // sounds on each pass: the notes light up on the second time through too.

  /**
   * toMidi's arguments for what is heard: the score with its repeats played
   * out and its jumps taken; a piece edited in its text, as toMidi plays it
   * (out, when the model reads it; as written otherwise). Play, Save as
   * MIDI and Save the sound all play this, at 100 a quarter when the source
   * sets no tempo.
   */
  const heard = (score) =>
    score
      ? [M.toLilyPond(score, { unfold: true }).source, { bpm: M.DEFAULT_BPM, beat: 4, unfold: false }]
      : [st.text, { bpm: M.DEFAULT_BPM, beat: 4 }];

  // The Playback section's settings, kept from one visit to the next.
  const PLAYBACK = "eui-score-studio-playback";
  const playOption = (name) => root.querySelector(`[data-play="${name}"]`);
  try {
    const kept = JSON.parse(localStorage.getItem(PLAYBACK) || "{}");
    if (kept.rate) playOption("rate").value = kept.rate;
    playOption("metronome").checked = Boolean(kept.metronome);
    playOption("count-in").checked = Boolean(kept.countIn);
  } catch (error) {}
  root.querySelector('[data-section="playback"]')?.addEventListener("change", (event) => {
    if (event.target.dataset.play === "output") return chooseOutput(event.target);
    if (event.target.dataset.play === "rate" && st.playing?.handle) st.playing.handle.rate = rate();
    try {
      localStorage.setItem(PLAYBACK, JSON.stringify({ rate: playOption("rate").value, metronome: playOption("metronome").checked, countIn: playOption("count-in").checked }));
    } catch (error) {}
  });
  const rate = () => Number(playOption("rate")?.value) || 1;

  /** Play; pause; play on. A second press while the sounds load gives up. */
  async function togglePlay() {
    const playing = st.playing;
    if (playing?.handle) {
      if (playing.handle.paused) {
        playing.handle.resume();
        playing.next = null;
        say("Playing — Space to pause");
      } else {
        playing.handle.pause();
        say("Paused — Space to play on, Stop to go back to the start");
      }
      return showState();
    }
    if (playing) return stopPlay();
    // Inside the click, before anything waits: a browser starts sound only
    // from a gesture, and a gesture does not outlive a download.
    P.unlock();
    // Looped: the loop's bars over and over (set on the MIDI view's ruler,
    // or Play › Loop), else the selected bars when Playback asks for it —
    // recorded into or not. Recorded into or looped, the score plays on past
    // its last note (M.padded).
    const looping = Boolean(st.loopBars) || playOption("loop")?.checked;
    const played = st.score && (st.recording || looping) ? M.padded(st.score) : st.score;
    // The staff recorded into is silent: in this browser it is muted, and a
    // MIDI device (Sound to) is not sent its old notes at all.
    if (st.recording) M.write(played, st.recording.lane, 0, M.barStart(played, M.barsOf(played)), { rest: true });
    const passes = played ? M.playback(played) : [];
    // From the selection's bar (its first pass), or from the start.
    const loopBars = st.loopBars ?? (looping ? selectedBarsOrNull() : null);
    const loop = loopBars && st.score ? loopOf(passes, loopBars) : null;
    if (looping && !loop) say("Select the bars to loop: playing from the start.");
    if (st.recording) st.recording.loop = loop ? loopBars : null;
    const from = changeBar();
    const at = loop ? loop.start : from == null ? 0 : (passes.find((p) => p.bar === from)?.start ?? 0);
    let bytes;
    try {
      bytes = await toMidi(...heard(played));
    } catch (error) {
      return say(error.message ?? String(error), true);
    }
    const state = { handle: null, passes, times: noteTimes(passes), beats: played ? M.beats(played, passes) : [], loop, next: null, now: [], lit: -1, frame: 0, timer: 0, ticker: 0 };
    st.playing = state;
    showState();
    const progress = (f) => st.playing === state && say(`Loading the sounds… ${Math.round(100 * f)} % (38 MB, once)`);
    try {
      if (!P.isReady()) say("Loading the sounds…");
      await P.prepare(progress);
      if (st.playing !== state) return;
      // A recording always counts a bar in.
      if ((st.recording || playOption("count-in")?.checked) && passes.length) await countIn(state, at);
      if (st.playing !== state) return;
      state.handle = await P.play(bytes, { at, onStop: () => st.playing === state && stopPlay() });
    } catch (error) {
      if (st.playing === state) stopPlay();
      return say("The sounds could not be loaded.", true);
    }
    if (!state.handle || st.playing !== state) return;
    state.handle.rate = rate();
    applyMix();
    // The padding staff's note, silent.
    if (played !== st.score) {
      state.padChannel = M.channels(played).at(-1).channel;
      P.mute(state.padChannel, true);
    }
    if (!st.recording) say(loop ? "Looping the selected bars — Space to pause" : "Playing — Space to pause");
    showState();
    state.timer = setInterval(showProgress, 200);
    state.ticker = setInterval(tick, 25);
    const follow = () => {
      if (st.playing !== state) return;
      light(state.handle.heard);
      state.frame = requestAnimationFrame(follow);
    };
    follow();
  }

  /** The selected bars as a loop: from their first pass to the end of that pass through the last; null with none selected. */
  function loopOf(passes, bars = null) {
    if (!bars) {
      try {
        bars = selectedBars();
      } catch (error) {
        return null;
      }
    }
    const first = passes.findIndex((p) => p.bar === bars[0]);
    if (first < 0) return null;
    const last = passes.findIndex((p, k) => k >= first && p.bar === bars[1]);
    return last < 0 ? null : { start: passes[first].start, end: passes[last].end };
  }

  /** One bar of clicks, at the speed of the bar the music starts in; resolves when it is over. */
  function countIn(state, at) {
    const pass = M.passAt(state.passes, at);
    const [num, den] = M.timeAt(st.score, pass.bar);
    const beat = ((M.WHOLE / den) / (M.WHOLE / pass.base)) * (60 / pass.bpm) / rate();
    const t0 = P.audioTime() + 0.05;
    for (let k = 0; k < num; k++) P.click(t0 + k * beat, k === 0);
    say("One bar to come in…");
    return new Promise((resolve) => setTimeout(resolve, (num * beat + 0.05) * 1000));
  }

  /** Every 25 ms: the loop's jump back, and the metronome's clicks due in the next 120 ms, each once. */
  function tick() {
    const state = st.playing;
    const handle = state?.handle;
    if (!handle || handle.paused) return;
    const now = handle.time;
    if (state.loop && now >= state.loop.end - 0.02) {
      handle.time = state.loop.start;
      state.next = null;
      return;
    }
    // A recording always has the metronome.
    if (!(st.recording || playOption("metronome")?.checked) || !state.beats.length) return;
    const beats = state.beats;
    // After a jump — a seek, the loop — the count starts again where the music is.
    const lost = state.next == null || (state.next > 0 && beats[state.next - 1].sec > now + 0.3) || (beats[state.next] && beats[state.next].sec < now - 0.3);
    if (lost) state.next = Math.max(0, beats.findIndex((b) => b.sec >= now - 0.01));
    while (state.next < beats.length && beats[state.next].sec < now + 0.12) {
      const b = beats[state.next++];
      if (b.sec >= now - 0.01) P.click(P.audioTime() + (b.sec - now) / handle.rate, b.down);
    }
  }

  /** Lights the notes that started last, at `sec`; draws only when they change. */
  function light(sec) {
    const playing = st.playing;
    const times = playing.times;
    let k = -1;
    while (k + 1 < times.length && times[k + 1].sec <= sec + 0.01) k++;
    if (k === playing.lit) return;
    playing.lit = k;
    playing.now = k < 0 ? [] : times[k].items;
    draw().then(followPlaying);
  }

  function stopPlay() {
    const playing = st.playing;
    // Where the music got to, for the keys still held when a recording stops.
    const reached = st.recording && playing?.handle ? M.tickAtPlayed(st.score, playing.passes, playing.handle.heard) : null;
    st.playing = null;
    if (playing) {
      clearInterval(playing.timer);
      clearInterval(playing.ticker);
      cancelAnimationFrame(playing.frame);
      if (playing.handle) playing.handle.stop();
      else P.stop(); // still loading: it must not start after all
      if (playing.padChannel != null) P.mute(playing.padChannel, false);
    }
    progress.hidden = true;
    playhead.hidden = true;
    say("");
    if (st.recording) return finishRecording(reached);
    draw();
  }

  // The bar under the menu: how far the music has played, the bar it is in;
  // a click on it plays from there.
  const progress = document.createElement("div");
  progress.className = "studio-progress";
  progress.hidden = true;
  progress.innerHTML = '<div class="studio-progress-fill"></div><span class="studio-progress-text"></span>';
  root.querySelector(".studio-menubar").after(progress);
  // On a narrow screen the menu bar wraps: the progress bar sticks under it, however tall.
  const menubar = root.querySelector(".studio-menubar");
  new ResizeObserver(() => root.style.setProperty("--studio-menubar-h", `${menubar.offsetHeight}px`)).observe(menubar);
  progress.addEventListener("click", (event) => {
    const handle = st.playing?.handle;
    if (!handle?.duration) return;
    const rect = progress.getBoundingClientRect();
    handle.time = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * handle.duration;
  });

  const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

  function showProgress() {
    const handle = st.playing?.handle;
    if (!handle) return;
    const total = handle.duration || 0;
    const now = Math.min(Math.max(0, handle.time || 0), total);
    progress.hidden = false;
    progress.querySelector(".studio-progress-fill").style.width = total ? `${(100 * now) / total}%` : "0";
    const pass = M.passAt(st.playing.passes, now);
    const bars = pass && st.score ? ` · bar ${pass.bar + 1} of ${M.barsOf(st.score)}` : "";
    progress.querySelector(".studio-progress-text").textContent = `${clock(now)} / ${clock(total)}${bars}`;
    state.textContent = `Playing${bars} · ${clock(now)} / ${clock(total)} — Space to stop`;
  }

  /** The selected bars' boxes, and a handle on every edge of every repeat. */
  function placePalette() {
    const g = geometry();
    const sel = st.sel;
    const hide = () => {
      palette.hidden = true;
    };
    if (!g || !st.score || st.input.on || st.playing || !sel || sel.bars || sel.t0 !== sel.t1) return hide();
    const starts = M.starts(st.score.staves[sel.staff]);
    const k = st.items.findIndex((it) => it.staff === sel.staff && starts[it.index] === sel.t0);
    const item = st.view?.items.find((it) => it.item === k);
    if (!item) return hide();
    const corner = g.at(item.box[0], item.box[1]);
    palette.hidden = false;
    palette.style.left = `${Math.max(4, corner.x - 10)}px`;
    palette.style.top = `${Math.max(4, corner.y - 48)}px`;
  }

  function placeOverlay() {
    placePalette();
    overlay.innerHTML = "";
    const g = geometry();
    if (!g || !st.score || st.input.on) return;
    const boxOf = (bar) => st.view.bars?.find((b) => b.bar === bar)?.box;
    const add = (className, x0, y0, x1, y1, props = {}) => {
      const a = g.at(x0, y0);
      const b = g.at(x1, y1);
      const el = Object.assign(document.createElement("div"), { className, ...props });
      Object.assign(el.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${Math.max(2, b.x - a.x)}px`, height: `${b.y - a.y}px` });
      overlay.appendChild(el);
      return el;
    };
    if (st.sel?.bars) {
      for (let bar = st.sel.bars[0]; bar <= st.sel.bars[1]; bar++) {
        const box = boxOf(bar);
        if (box) add("studio-bar-selected", box[0], box[1], box[2] + 3, box[3]);
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

  // ---- Mute, solo, and where the sound goes ----------------------------------------

  st.mix = { mute: new Set(), solo: new Set() };

  /** Each staff's channel muted or not: muted, or not soloed while another is. */
  function applyMix() {
    if (!st.score) return;
    for (const { lane, channel } of M.channels(st.score)) {
      P.mute(channel, st.mix.mute.has(lane) || (st.mix.solo.size > 0 && !st.mix.solo.has(lane)));
    }
  }

  /** The Playback section's staves, a Mute and a Solo for each. */
  function renderMix() {
    const box = playOption("staves");
    if (!box) return;
    const rows = st.score ? M.channels(st.score) : [];
    const key = JSON.stringify([rows.map((r) => r.name), [...st.mix.mute], [...st.mix.solo]]);
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.innerHTML = "";
    if (rows.length < 2) return;
    for (const { lane, name } of rows) {
      const row = Object.assign(document.createElement("div"), { className: "tool-staff" });
      row.append(Object.assign(document.createElement("span"), { textContent: name, title: name }));
      for (const [act, letter, words] of [["mute", "M", "Mute"], ["solo", "S", "Solo"]]) {
        const on = st.mix[act].has(lane);
        const button = Object.assign(document.createElement("button"), { type: "button", className: `tool${on ? " on" : ""}`, textContent: letter, title: `${words} ${name}` });
        button.dataset.act = act;
        button.dataset.lane = String(lane);
        button.setAttribute("aria-pressed", String(on));
        button.setAttribute("aria-label", `${words} ${name}`);
        row.append(button);
      }
      box.append(row);
    }
  }

  // ---- Sound and picture, to files ---------------------------------------------------

  /** What is heard on Play — every repeat played out, the muted staves left out — as a WAV file. */
  async function saveWav() {
    let bytes;
    try {
      bytes = await toMidi(...heard(st.score));
    } catch (error) {
      return refuse(error);
    }
    const muted = st.score ? M.channels(st.score).filter(({ lane }) => st.mix.mute.has(lane) || (st.mix.solo.size > 0 && !st.mix.solo.has(lane))).map(({ channel }) => channel) : [];
    say("Making the WAV file…");
    try {
      const wav = await P.renderWav(bytes, { muted, onProgress: (f) => say(`Loading the sounds… ${Math.round(100 * f)} % (38 MB, once)`) });
      download(wav, `${fileName()}.wav`, "audio/wav");
      say(`${fileName()}.wav saved — ${(wav.size / 1048576).toFixed(1)} MB`);
    } catch (error) {
      say(`The WAV file could not be made: ${error.message ?? error}`, true);
    }
  }

  /** The score as a picture: SVG as drawn, or PNG at twice its size — on white, in black ink, nothing selected. */
  async function saveImage(png) {
    await loaded();
    const width = Math.max(320, Math.floor(sheet.clientWidth - 2));
    let svg;
    try {
      svg = engine.svg(st.text, width, 8, "{}");
    } catch (error) {
      return refuse(error);
    }
    // A margin all round, as on paper.
    const pad = 24;
    const [, top, inner, innerH] = svg.match(/viewBox="0 (-?\d+) (\d+) (\d+)"/).map(Number);
    const [w, h] = [inner + 2 * pad, innerH + 2 * pad];
    svg = svg
      .replace(/viewBox="[^"]*" width="\d+" height="\d+"/, `viewBox="${-pad} ${top - pad} ${w} ${h}" width="${w}" height="${h}"`)
      .replace("<svg ", '<svg color="#000" style="background:#fff" ')
      .replace("<defs>", `<rect x="${-pad}" y="${top - pad}" width="${w}" height="${h}" fill="#fff"/><defs>`);
    if (!png) return download(svg, `${fileName()}.svg`, "image/svg+xml");
    const picture = new Image();
    picture.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      await picture.decode();
      const canvas = Object.assign(document.createElement("canvas"), { width: w * 2, height: h * 2 });
      const pen = canvas.getContext("2d");
      pen.fillStyle = "#fff";
      pen.fillRect(0, 0, canvas.width, canvas.height);
      pen.drawImage(picture, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      download(blob, `${fileName()}.png`, "image/png");
    } finally {
      URL.revokeObjectURL(picture.src);
    }
  }

  // ---- A MIDI keyboard ------------------------------------------------------------
  //
  // A key played writes its note at the cursor, in the duration chosen —
  // note input starts if it was off; keys held together make a chord. With
  // notes selected and note input off, the key gives the selected note its
  // pitch, as a letter does.

  const midiIn = root.querySelector("[data-midi-in]");
  midiIn?.addEventListener("change", () => chooseInput(midiIn));

  function playKey(key, held) {
    if (!st.score) return;
    if (!st.input.on && !st.sel) setInput(true);
    // A key pressed while others are down joins their chord.
    const add = held.length > 0 && st.input.on && st.input.last;
    if (st.input.on) inputWrite({ key }, add);
    else edit((score) => {
      const t = need();
      M.setPitch(score, t.s, t.i, M.pitchOfKey(key, M.keyOf(score, t.s, M.starts(score.staves[t.s])[t.i])), false, t.head);
    });
    hear();
  }

  // ---- The loop ---------------------------------------------------------------------
  //
  // The bars played over and over, kept apart from the selection: set on the
  // MIDI view's ruler (a drag, or a click on a bar), or with Play › Loop the
  // selected bars; a click on it, or Play › No loop, takes it away.

  function setLoop(bars) {
    if (bars === undefined || (bars === null && !st.loopBars)) return say(bars === null ? "No loop" : "Select the bars to loop first", bars !== null);
    st.loopBars = bars ? [Math.min(...bars), Math.max(...bars)] : null;
    if (st.playing) stopPlay();
    const [a, b] = st.loopBars ?? [];
    say(st.loopBars ? `Loop: ${a === b ? `bar ${a + 1}` : `bars ${a + 1}–${b + 1}`}, played over and over (and recorded into). A click on it in the MIDI view's ruler, or Play › No loop, takes it away.` : "No loop: the music plays on.");
    draw();
  }

  // ---- Recording from a MIDI keyboard --------------------------------------------
  //
  // R (or Record) plays the score from the selected bar after a bar of
  // count-in, the metronome on and the staff recorded into silent; the keys
  // played are kept with the times they were heard at, and written when the
  // music stops, fitted to the Quantize grid. One Undo takes it all back.

  const quantizeBox = root.querySelector("[data-quantize]");
  const dynamicsBox = root.querySelector("[data-record-dynamics]");
  const recordButtons = () => root.querySelectorAll("[data-record]");

  function keyboardChosen() {
    return midiIn && midiIn.value && midiIn.value !== "find" ? midiIn.value : null;
  }

  async function record() {
    if (st.recording) return stopPlay();
    if (!st.score) return say("Recording needs the score tools: this piece is edited in its text.", true);
    const port = keyboardChosen();
    if (!port) return say("Choose a MIDI keyboard first (Playback › MIDI keyboard), then record.", true);
    const lane = st.input.on ? st.input.staff : (st.sel?.staff ?? 0);
    if (st.playing) stopPlay();
    if (st.input.on) setInput(false);
    const sound = st.score.staves[M.upperOf(st.score, lane)]?.instrument;
    const muted = !st.mix.mute.has(lane);
    st.mix.mute.add(lane);
    st.recording = { lane, bar: changeBar() ?? 0, program: M.programOf(sound), drums: M.isDrums(st.score, lane), channel: laneChannel(lane), down: new Map(), played: [], muted };
    P.listen(port, recordKey, releaseKey);
    for (const button of recordButtons()) {
      button.textContent = "■ Stop rec";
      button.setAttribute("aria-pressed", "true");
    }
    await togglePlay();
    if (st.recording && st.playing) {
      const loop = st.recording.loop;
      say(loop
        ? `Recording into ${laneName(lane)}, bars ${loop[0] + 1}–${loop[1] + 1} in a loop: each pass adds its notes; R stops.`
        : `Recording into ${laneName(lane)} from bar ${st.recording.bar + 1}: play after the count-in; R stops.`);
    }
  }

  /** Lane `s`'s MIDI channel, as the music is sent: its staff's. */
  function laneChannel(s) {
    return M.channels(st.score).find((c) => c.lane === M.upperOf(st.score, s))?.channel ?? 0;
  }

  function laneName(s) {
    const staff = st.score.staves[M.upperOf(st.score, s)];
    return staff?.name || `staff ${M.staffNumber(st.score, s) + 1}`;
  }

  /** The tick being heard now, while recording; null before the music has started or while it is paused. */
  function recordingNow() {
    const handle = st.playing?.handle;
    return st.recording && handle && !handle.paused ? M.tickAtPlayed(st.score, st.playing.passes, handle.heard) : null;
  }

  function recordKey(key, held, velocity = 100) {
    if (!st.recording) return;
    P.hold(key, true, st.recording.program, { drums: st.recording.drums, velocity, channel: st.recording.channel });
    const t = recordingNow();
    if (t != null) st.recording.down.set(key, { t, velocity });
  }

  function releaseKey(key) {
    if (!st.recording) return;
    P.hold(key, false, 0, { drums: st.recording.drums, channel: st.recording.channel });
    const down = st.recording.down.get(key);
    if (!down) return;
    st.recording.down.delete(key);
    const { t: t0, velocity } = down;
    const t1 = recordingNow() ?? t0;
    // The music went back meanwhile — a repeat, the loop: the note lasts to its bar's end, or the loop's.
    const back = st.recording.loop ? M.barStart(st.score, st.recording.loop[1] + 1) : M.barStart(st.score, M.barAt(st.score, t0) + 1);
    st.recording.played.push({ key, t0, t1: t1 > t0 ? t1 : back, velocity });
  }

  /** The music stopped: the keys played written into the staff, from the bar recording began to the end of the last note's. */
  function finishRecording(reached) {
    const rec = st.recording;
    st.recording = null;
    P.listen(keyboardChosen(), playKey);
    if (rec.muted) st.mix.mute.delete(rec.lane);
    renderMix();
    for (const button of recordButtons()) {
      button.textContent = "● Rec";
      button.setAttribute("aria-pressed", "false");
    }
    for (const [key, { t: t0, velocity }] of rec.down) {
      P.hold(key, false, 0, { drums: rec.drums, channel: rec.channel });
      rec.played.push({ key, t0, t1: Math.max(reached ?? t0, t0 + 1), velocity });
    }
    if (!rec.played.length) {
      say("Nothing was played: the score is as it was.");
      return draw();
    }
    const grid = M.RECORDING_GRIDS[quantizeBox?.value] ?? M.RECORDING_GRIDS.sixteenth;
    // Looped, every pass is kept (each played over the others) and the loop's bars written whole.
    const first = rec.loop ? rec.loop[0] : rec.bar;
    const from = M.barStart(st.score, first);
    const lastBar = rec.loop ? rec.loop[1] : M.barAt(st.score, Math.max(from, Math.max(...rec.played.map((n) => n.t1)) - 1));
    let written = 0;
    edit((score) => {
      written = M.writeRecording(score, rec.lane, from, M.barStart(score, lastBar + 1), rec.played, grid, { dynamics: Boolean(dynamicsBox?.checked) });
    });
    const bars = lastBar === first ? `bar ${first + 1}` : `bars ${first + 1}–${lastBar + 1}`;
    say(`Recorded ${written === 1 ? "1 note" : `${written} notes`} into ${laneName(rec.lane)}, ${bars}, fitted to ${quantizeBox?.selectedOptions[0]?.textContent ?? "sixteenths"}. Ctrl+Z takes it back.`);
  }

  /** The "MIDI keyboard" menu: none, or a keyboard, found when asked for. */
  async function chooseInput(select) {
    if (select.value === "") {
      P.listen(null);
      return say("No MIDI keyboard: the letters write the notes.");
    }
    if (select.value !== "find") {
      P.listen(select.value, playKey);
      return say(`Play on ${select.selectedOptions[0].textContent}: each key writes its note at the cursor.`);
    }
    let ports = [];
    try {
      ports = await P.midiInputs();
    } catch (error) {
      select.value = "";
      return say(error.message ?? "The browser gave no access to MIDI keyboards.", true);
    }
    select.innerHTML = "";
    select.append(new Option("none", ""));
    for (const port of ports) select.append(new Option(port.name, port.id));
    select.append(new Option("look again…", "find"));
    if (!ports.length) {
      select.value = "";
      return say("No MIDI keyboard found: plug one in (USB or Bluetooth), then look again.", true);
    }
    select.value = ports[0].id;
    P.listen(ports[0].id, playKey);
    say(`Play on ${ports[0].name}: each key writes its note at the cursor, in the duration chosen; keys held together make a chord.`);
  }

  /** The "Sound to" menu: this browser, or a MIDI device, found when asked for. */
  async function chooseOutput(select) {
    if (select.value === "") {
      P.setOutput(null);
      return say("The sound plays in this browser.");
    }
    if (select.value !== "find") {
      P.setOutput(select.value);
      return say(`From the next Play on, the music goes to ${select.selectedOptions[0].textContent}.`);
    }
    let ports = [];
    try {
      ports = await P.midiOutputs();
    } catch (error) {
      select.value = "";
      return say(error.message ?? "The browser gave no access to MIDI devices.", true);
    }
    select.innerHTML = "";
    select.append(new Option("this browser", ""));
    for (const port of ports) select.append(new Option(port.name, port.id));
    select.append(new Option("look again…", "find"));
    if (!ports.length) {
      select.value = "";
      return say("No MIDI device found. On a Mac, open Audio MIDI Setup → MIDI Studio, and set the IAC Driver online; then look again.", true);
    }
    select.value = ports[0].id;
    P.setOutput(ports[0].id);
    say(`From the next Play on, the music goes to ${ports[0].name}. Open GarageBand (or Logic) on an instrument track to hear it.`);
  }

  /** When notes start, in seconds, on every pass: [{ sec, items }], in order. */
  function noteTimes(passes) {
    if (!st.score) return [];
    const at = new Map();
    const starts = st.score.staves.map((staff) => M.starts(staff));
    st.items.forEach(({ staff, index }, item) => {
      if (st.score.staves[staff].events[index].rest) return;
      for (const sec of M.heardAt(st.score, passes, staff, index, starts[staff][index])) {
        const key = Math.round(sec * 1000);
        if (!at.has(key)) at.set(key, { sec, items: [] });
        at.get(key).items.push(item);
      }
    });
    return [...at.values()].sort((a, b) => a.sec - b.sec);
  }

  // ---- Start ---------------------------------------------------------------------

  let start = fixed ? options.source : sourceBox.value;
  const fromExample = fixed || new URLSearchParams(location.search).has("source");
  // A shared link: its score, which then becomes this browser's draft; the
  // link itself leaves the address bar, so a reload keeps the edits.
  const shared = fixed ? null : /^#s=([A-Za-z0-9_-]+)$/.exec(location.hash)?.[1];
  let opening = Promise.resolve(null);
  let draft = null;
  try {
    if (draftKey) draft = localStorage.getItem(draftKey);
  } catch (error) {}
  if (shared) {
    opening = M.fromShareCode(shared).then((text) => (text.trim() ? text : null)).catch(() => null);
    history.replaceState(null, "", location.pathname + location.search);
  } else if (!fromExample && draft) start = draft;
  // The engraver reads the source: nothing is read before it has loaded.
  const ready = Promise.all([loaded(), opening]).then(([, sharedText]) => {
    if (sharedText != null) start = sharedText;
    // A link that holds no score opens what would have opened without it.
    else if (shared && draft) start = draft;
    sourceBox.value = start;
    readText(start);
    if (st.score) writeText();
    if (sharedText != null) saveDraft();
    return draw().then(() => sharedText);
  }).then((sharedText) => {
    if (options.greeting) say(options.greeting);
    else if (shared && sharedText == null) say(`That link holds no score: here is ${draft ? "your last one" : "the starting one"}.`, true);
    else if (sharedText != null) say("A shared score. Your changes stay in this browser; Share makes a new link.");
    else if (!fromExample && start !== sourceBox.defaultValue) say("Your last score, kept in this browser. New starts afresh.");
    else say("Click a note to select it, or press N and type A–G to write.");
  });
  return { state: st, ready, source: () => st.text, load };
}
