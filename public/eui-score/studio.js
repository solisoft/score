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
// The editor's words in the page's language (#508).
const { tr } = await import(`./words.js${V}`);
const { loaded, toMidi, toPdf, download, engine } = await import(`./eui-score.js${V}`);
const M = await import(`./score-model.js${V}`);
const P = await import(`./player.js${V}`);
const R = await import(`./piano-roll.js${V}`);
const K = await import(`./shortcuts.js${V}`);
const S = await import(`./midi-sync.js${V}`);
const X = await import(`./mixer.js${V}`);
const Vel = await import(`./velocity.js${V}`);
const { mixerPanel } = await import(`./mixer-ui.js${V}`);
// Practice, the synthesizer, your own SoundFonts and MPE (#391).
const Pr = await import(`./practice.js${V}`);
const Sy = await import(`./synth.js${V}`);
const { installInstruments } = await import(`./instruments-ui.js${V}`);
// Swing, humanize and the tempo's glides, put into the MIDI that is heard (#379).
const F = await import(`./feel.js${V}`);
const A = await import(`./automation.js${V}`);
const Ch = await import(`./channels.js${V}`);
const G = await import(`./graces.js${V}`);
const { automationLane } = await import(`./automation-ui.js${V}`);
// The microphone: audio tracks, their notes written down, a tuner, practice (#390).
const { audioTracks } = await import(`./audio-ui.js${V}`);
// The undo history kept in this browser, and Undo across others' changes (#387).
const H = await import(`./undo-history.js${V}`);
const { mergeScores, conflictLines } = await import(`./merge.js${V}`);
const { editor_view_lit, score_json, source_spans } = engine;

/** The engraver's reading of a text with where each note is written: what the model keeps as written reads back (merges). */
function parseKept(text) {
  const parsed = JSON.parse(score_json(text));
  parsed.spans = JSON.parse(source_spans(text));
  return JSON.stringify(parsed);
}

/** The MusicXML reader and writer, loaded the first time a file needs it. */
const musicXml = () => import(`./musicxml.js${V}`);

// The editor's parts, one job each. startStudio makes what they share — the
// elements, the state (`st`), say — and installs them in turn:
// - studio-toolbox.js: the toolbox and the menus, what they show, their fields;
// - studio-files.js: New, the properties, parts; files opened, shared, saved;
// - studio-text.js: the score as a model and as text; the undoable edit;
// - studio-selection.js: the selection, the note the tools act on, heard;
// - studio-history.js: Undo and Redo, the history kept in this browser;
// - studio-source.js: the source box, linked to the drawing, typed in;
// - studio-input.js: note input, durations, the cursor moved, voices;
// - studio-commands.js: act — what each button, menu item and key does;
// - studio-clipboard.js: copy, cut and paste, of notes and of sections;
// - studio-words.js: lyrics, chord symbols, figures and texts, typed in;
// - studio-draw.js: the score engraved, what goes over it, printing;
// - studio-peers.js: where this person and the others work; comments;
// - studio-roll.js: the MIDI view;
// - studio-velocity.js: the velocity strip and the automation lane;
// - studio-pointer.js: the pointer on the score: selecting, dragging;
// - studio-ghost.js: note input's pen and ghost note, a click writing there;
// - studio-playback.js: Play, the metronome, practice, the loop;
// - studio-mix.js: mute, solo, the mixer, the instruments, the audio tracks;
// - studio-recording.js: a MIDI keyboard, recording, Sound to.
const [
  Toolbox, Files, Text, Selection, History, Source, Input, Commands, Clipboard, Words, Draw, Peers, Roll, Velocity,
  Pointer, Ghost, Playback, Mix, Recording
] = await Promise.all([
  import(`./studio-toolbox.js${V}`),
  import(`./studio-files.js${V}`),
  import(`./studio-text.js${V}`),
  import(`./studio-selection.js${V}`),
  import(`./studio-history.js${V}`),
  import(`./studio-source.js${V}`),
  import(`./studio-input.js${V}`),
  import(`./studio-commands.js${V}`),
  import(`./studio-clipboard.js${V}`),
  import(`./studio-words.js${V}`),
  import(`./studio-draw.js${V}`),
  import(`./studio-peers.js${V}`),
  import(`./studio-roll.js${V}`),
  import(`./studio-velocity.js${V}`),
  import(`./studio-pointer.js${V}`),
  import(`./studio-ghost.js${V}`),
  import(`./studio-playback.js${V}`),
  import(`./studio-mix.js${V}`),
  import(`./studio-recording.js${V}`),
]);

const DRAFT = "eui-score-studio-draft";
// The palette over the selected note: the changes made to a note most, its
// title (the key in brackets) and its name for a screen reader.
const PALETTE = () => [
  ["move", { how: "step", by: "1" }, "↑", tr("A step up (↑)"), tr("A step up")],
  ["move", { how: "step", by: "-1" }, "↓", tr("A step down (↓)"), tr("A step down")],
  ["alter", { alter: "-1" }, "♭", tr("Flat (−)"), tr("Flat")],
  ["alter", { alter: "0" }, "♮", tr("Natural (=)"), tr("Natural")],
  ["alter", { alter: "1" }, "♯", tr("Sharp (+)"), tr("Sharp")],
  ["dot", {}, "•", tr("Dotted (.)"), tr("Dotted")],
  ["tie", {}, "⁀", tr("Tie to the next note (T)"), tr("Tie to the next note")],
  ["art", { name: "staccato" }, "·", tr("Staccato"), tr("Staccato")],
  ["art", { name: "accent" }, ">", tr("Accent"), tr("Accent")],
  ["rest", {}, "𝄽", tr("A rest instead (0)"), tr("A rest instead")],
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
 * - `shareUrl`: where Share goes (the app's sharing page, for the owner)
 *   instead of copying a link that holds the score.
 * - `scoreUrl`: without `shareUrl`, the link Share copies (the score's page
 *   in the app, which opens for those it is shared with).
 *
 * - `onPlace(place)`: where this person works, `{ lane, bars: [a, b] }` or
 *   null, each time it changes (the app tells the others in the room).
 * - `onComment(place)`: "Comment on the selection" (Edit menu, the
 *   selection's 💬, Ctrl+Alt+M) hands it the selection's place, or null.
 *   Without it, comments are not offered (the playground).
 * - `onMarker(id)`: a click on a comment's bubble (`markers`) over the score.
 * - `onBars(op)`: bars put in or taken away here, `{ at, removed, added }`,
 *   or null after an Undo or a Redo (#392): the app sends them with the
 *   save so the comments follow their bars (merge.js, anchorMap).
 * - `history`: the key the undo history is kept under in this browser
 *   (undo-history.js), or false for none; the playground's draft has one
 *   of its own. `historyAcross`: the score may have been changed by someone
 *   else since the history was kept (the app): it is kept all the same, and
 *   Undo merges back around their changes; without it, a history that ends
 *   at another text than the one opened is left.
 *
 * - `audio`: `{ url, csrf }`, where the score's audio tracks are kept (the
 *   app's); without it, no audio tracks (the tuner and practice still are).
 *
 * Answers `{ state, ready, source(), load(text, message, { keep, remote }), peers(list),
 * parse(text), markers(list), selectPlace(place), placeLabel(place), place() }`:
 * `ready` settles once the first score is drawn; `peers` draws the others'
 * places (see "Where the others work"); `markers` the comments' bubbles
 * (see "Comments").
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
  palette.setAttribute("aria-label", tr("The selected note"));
  for (const [act, data, sign, title, name] of PALETTE()) {
    const button = Object.assign(document.createElement("button"), { type: "button", textContent: sign, title });
    button.setAttribute("aria-label", name);
    Object.assign(button.dataset, { act, ...data });
    palette.appendChild(button);
  }
  // Comments (the app's): the selected note's bars commented on from here too.
  if (options.onComment) {
    const button = Object.assign(document.createElement("button"), { type: "button", textContent: "💬", title: tr("Comment on the selection (Ctrl+Alt+M)") });
    button.setAttribute("aria-label", tr("Comment on the selection"));
    button.dataset.act = "comment";
    palette.appendChild(button);
  }
  // A press on it is not a press on the score under it.
  palette.addEventListener("pointerdown", (event) => event.stopPropagation());
  sheet.appendChild(palette);

  // The MIDI view, in place of the engraving when it is on: its layout's
  // switch, and the roll, which scrolls sideways.
  const rollHost = Object.assign(document.createElement("div"), { className: "studio-roll", hidden: true, tabIndex: 0 });
  rollHost.innerHTML = `<div class="studio-roll-bar"><span class="studio-roll-layouts" role="group" aria-label="${tr("MIDI view layout")}"><button type="button" class="studio-menu" data-act="roll-layout" data-layout="tracks" aria-pressed="true">${tr("Tracks")}</button><button type="button" class="studio-menu" data-act="roll-layout" data-layout="keys" aria-pressed="false">${tr("Keyboard")}</button></span><span class="studio-roll-only" data-roll-only hidden></span><span class="studio-roll-hint">${tr("Drag across bars and tracks to select a section; a click elsewhere lets it go. Drag on the bar numbers to set a loop; a click on it takes it away. On the keyboard, drag a note to move it, its right edge to change its length.")}</span></div><div class="studio-roll-scroll" data-roll-scroll></div>`;
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
    lost: [], // what the text holds that the model does not keep: the first rewrite drops it
    passed: [], // the settings the engraver read and passed over in the text: said when it is opened
    lostNotice: "", // said once it has been dropped
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
  // The Quantize grid (Playback): what is recorded, dragged on the keyboard,
  // or opened from a MIDI file is fitted to it.
  const quantizeBox = root.querySelector("[data-quantize]");

  // What the parts share: the elements, the state, the libraries — and each
  // part's functions, added as it is installed (`install(ctx)` answers them).
  const ctx = {
    root, options, draftKey, sheet, sourceBox, status, state, notice, svgHost, overlay, palette, rollHost, rollScroll,
    playhead, st, quantizeBox, loaded, toMidi, toPdf, download, engine, M, P, R, K, S, X, Vel, mixerPanel, Pr, Sy,
    installInstruments, F, A, Ch, G, automationLane, audioTracks, H, mergeScores, conflictLines, editor_view_lit,
    score_json, source_spans, parseKept, musicXml, refuse, say
  };
  // The editor's lifetime: instant navigation swaps the page out without
  // unloading it, so what a part adds to `document` or `window` takes this
  // signal, its observers go in `ctx.observers`, and `ctx.ends` run when the
  // editor is gone (see the end of the parts below).
  const lifetime = new AbortController();
  ctx.signal = lifetime.signal;
  ctx.observers = [];
  ctx.ends = [];
  // A part calls another's functions through `ctx.call`, which finds them when
  // called: whichever part is installed first, `draw` reaches `showState`.
  const asked = new Set();
  ctx.call = new Proxy({}, { get: (_, name) => (asked.add(name), (...args) => ctx[name](...args)) });
  const {
    readText, adoptText, restoreHistory, saveDraft, load, passedText, act, draw, place, setMarkers, placeLabel,
    selectPlace, setPeers, keptHistoryNote
  } = ctx.call;

  /** A refusal of the text: its line, and a button that selects that place in the source. */
  function refuse(error, text = st.text) {
    const message = error.message ?? String(error);
    const place = M.refusalPlace(message, text);
    say(place ? place.message : message, true);
    if (!place || text !== sourceBox.value) return false;
    const show = Object.assign(document.createElement("button"), { type: "button", className: "studio-show", textContent: tr("Show") });
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

  function say(message, error = false, link = null) {
    // Said during an edit: it outlives the edit's own clearing.
    status.dataset.fresh = "1";
    queueMicrotask(() => delete status.dataset.fresh);
    status.textContent = message;
    // `link`: { href, text }, a way on after the message (the Pricing page, #393).
    if (link?.href) status.append(" ", Object.assign(document.createElement("a"), { href: link.href, textContent: link.text }));
    status.classList.toggle("studio-error", error);
    return false;
  }

  // The parts, installed in turn: each makes its elements and adds its
  // listeners, in the order the editor always set them up.
  Object.assign(ctx, Toolbox.install(ctx));
  Object.assign(ctx, Files.install(ctx));
  Object.assign(ctx, Text.install(ctx));
  Object.assign(ctx, Selection.install(ctx));
  Object.assign(ctx, History.install(ctx));
  Object.assign(ctx, Source.install(ctx));
  Object.assign(ctx, Input.install(ctx));
  Object.assign(ctx, Commands.install(ctx));
  Object.assign(ctx, Clipboard.install(ctx));
  Object.assign(ctx, Words.install(ctx));
  Object.assign(ctx, Draw.install(ctx));
  Object.assign(ctx, Peers.install(ctx));
  Object.assign(ctx, Roll.install(ctx));
  Object.assign(ctx, Velocity.install(ctx));
  Object.assign(ctx, Pointer.install(ctx));
  Object.assign(ctx, Ghost.install(ctx));
  Object.assign(ctx, Playback.install(ctx));
  Object.assign(ctx, Mix.install(ctx));
  Object.assign(ctx, Recording.install(ctx));
  // The MIDI clock, sent and followed, and MIDI learn (midi-sync.js).
  ctx.sync = S.attach({ root, st, M, P, act, say });

  // Once a swap has taken this editor away, its listeners and observers go with it.
  document.addEventListener("soli:load", () => {
    if (root.isConnected) return;
    for (const end of ctx.ends) end();
    for (const observer of ctx.observers) observer.disconnect();
    lifetime.abort();
    // For a test: this editor has let go of the page.
    root.dataset.studio = "ended";
  }, { signal: lifetime.signal });

  // Every function a part asked for is there.
  for (const name of asked) if (typeof ctx[name] !== "function") throw new Error(`studio: no part installs ${name}`);

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
    adoptText();
    if (sharedText != null) saveDraft();
    return draw().then(() => sharedText);
  }).then(async (sharedText) => {
    // The undo history kept in this browser: never in the way of the score opening.
    try {
      await restoreHistory();
    } catch (error) {}
    // For a test, or a console: the history is read ("back", or "none").
    root.dataset.history = keptHistoryNote() ? "back" : "none";
    draw();
    return sharedText;
  }).then((sharedText) => {
    if (st.passed.length) say(`${options.greeting ?? tr("Opened.")}${passedText()}`);
    else if (options.greeting) say(options.greeting);
    else if (shared && sharedText == null) say(draft ? tr("That link holds no score: here is your last one.") : tr("That link holds no score: here is the starting one."), true);
    else if (sharedText != null) say(tr("A shared score. Your changes stay in this browser; Share makes a new link."));
    else if (!fromExample && start !== sourceBox.defaultValue) say(tr("Your last score, kept in this browser. New starts afresh."));
    // Otherwise nothing: the bar beside it already says how to start (#419).
    // After what was said on opening, not in its place.
    if (keptHistoryNote()) say(`${status.textContent} ${keptHistoryNote()}`.trim(), status.classList.contains("studio-error"));
  }).then(() => (options.importSection ? importFromLibrary(options.importSection) : null));

  /**
   * A section of the library added after the score's bars (#451), from its
   * page's "Add it": one edit, so one Undo takes it back. The address
   * forgets it, so a reload does not add it twice.
   */
  async function importFromLibrary(url) {
    const here = new URL(location.href);
    here.searchParams.delete("section");
    history.replaceState(null, "", here.pathname + here.search + here.hash);
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) return say(tr("That section is no longer in the library."), true);
      const data = await response.json();
      const { addToScore } = await import(`./section-library.js${new URL(import.meta.url).search}`);
      addToScore({ barsEdit: ctx.barsEdit, say, parse: score_json }, data);
    } catch (error) {
      say(tr("That section could not be added: try again."), true);
    }
  }
  // `parse`: the engraver's reading of a text (score_json), for the app's merge.
  return { state: st, ready, source: () => st.text, load, peers: setPeers, parse: (text) => parseKept(text), markers: setMarkers, selectPlace, placeLabel, place };
}
