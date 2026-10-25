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
// - studio-pointer.js: the pointer on the score: selecting, dragging.
const [
  Toolbox, Files, Text, Selection, History, Source, Input, Commands, Clipboard, Words, Draw, Peers, Roll, Velocity,
  Pointer
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
]);

const DRAFT = "eui-score-studio-draft";
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
  palette.setAttribute("aria-label", "The selected note");
  for (const [act, data, sign, title] of PALETTE) {
    const button = Object.assign(document.createElement("button"), { type: "button", textContent: sign, title });
    button.setAttribute("aria-label", title.replace(/\s*\(.*\)\s*$/, ""));
    Object.assign(button.dataset, { act, ...data });
    palette.appendChild(button);
  }
  // Comments (the app's): the selected note's bars commented on from here too.
  if (options.onComment) {
    const button = Object.assign(document.createElement("button"), { type: "button", textContent: "💬", title: "Comment on the selection (Ctrl+Alt+M)" });
    button.setAttribute("aria-label", "Comment on the selection");
    button.dataset.act = "comment";
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
    playhead, st, quantizeBox, loaded, toPdf, download, engine, M, P, R, K, X, Vel, automationLane, H, mergeScores,
    conflictLines, editor_view_lit, score_json, source_spans, musicXml, refuse, say, engraved, togglePlay, stopPlay,
    showProgress, mixFromMeta, mixHeard, soundMidi, applyMix, mixCommit, renderMix, setLoop, record, laneChannel,
    recordingNow
  };
  // A part calls another's functions through `ctx.call`, which finds them when
  // called: whichever part is installed first, `draw` reaches `showState`.
  const asked = new Set();
  ctx.call = new Proxy({}, { get: (_, name) => (asked.add(name), (...args) => ctx[name](...args)) });
  const {
    barNo, readText, adoptText, edit, restoreHistory, saveDraft, load, passedText, changeBar, hear, need, keepOn,
    setInput, inputWrite, act, selectedBarsOrNull, selectedBars, draw, place, setMarkers, placeLabel, selectPlace,
    setPeers, showState, followPlaying, keptHistoryNote
  } = ctx.call;

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

  /**
   * The MIDI of what is heard: each note at the velocity set for it
   * (velocity.js), the curves drawn played (automation.js), then as it is
   * played (feel.js) — swung and humanized as the meta line asks, on top of
   * those velocities, its rit. and accel. gliding. Play, Save as MIDI and
   * Save the sound all play this; `mix` (Save as MIDI) writes the mixer's
   * volume and pan in too; `practice` transposes it, and sets its speed (a
   * saved file's, when asked: practice.js).
   */
  const heardMidi = (score, passes = score ? M.playback(score) : [], { mix = null, practice = null } = {}) =>
    engraved(score).then((bytes) => {
      const velocities = score ? Vel.applyVelocities(score, bytes) : bytes;
      // Past fifteen channels, two staves may go through one mixer strip: their volume and pan in the file (#389).
      const shared = score && !mix ? X.fileMixLanes(mixHeard(), M.channels(score)) : [];
      const fileMix = mix ?? (shared.length ? mixHeard() : null);
      const curves = score ? A.applyAutomation(score, velocities, { passes, mix: fileMix, mixLanes: mix ? null : shared, volumeMin: X.VOLUME_MIN }) : velocities;
      const graced = score ? G.applyGraces(score, curves, { passes }) : curves;
      const felt = F.feel(graced, { score, passes, ...F.feelOf(score ? score.meta : M.readMeta(st.text)) });
      return practice ? Pr.applyPractice(felt, practice) : felt;
    });
  ctx.heardMidi = heardMidi;

  /** The engraver's MIDI of what is heard, each staff on its own channel (channels.js, #389). */
  function engraved(score) {
    return toMidi(...heard(score)).then((bytes) => Ch.assignChannels(score, bytes));
  }

  // The Playback section's settings, kept from one visit to the next.
  const PLAYBACK = "eui-score-studio-playback";
  const playOption = (name) => root.querySelector(`[data-play="${name}"]`);
  try {
    const kept = JSON.parse(localStorage.getItem(PLAYBACK) || "{}");
    if (kept.rate) playOption("rate").value = kept.rate;
    playOption("metronome").checked = Boolean(kept.metronome);
    playOption("count-in").checked = Boolean(kept.countIn);
    if (playOption("subdivide") && kept.subdivide) playOption("subdivide").value = kept.subdivide;
    if (playOption("accent")) playOption("accent").checked = kept.accent !== false;
  } catch (error) {}
  /** The metronome's first beat of each bar accented (Playback), as it always was unless turned off. */
  const accent = () => playOption("accent")?.checked ?? true;
  root.querySelector('[data-section="playback"]')?.addEventListener("change", (event) => {
    if (event.target.dataset.play === "output") return chooseOutput(event.target);
    if (event.target.dataset.play === "rate" && st.playing?.handle) st.playing.handle.rate = rate();
    try {
      localStorage.setItem(
        PLAYBACK,
        JSON.stringify({ rate: playOption("rate").value, metronome: playOption("metronome").checked, countIn: playOption("count-in").checked, subdivide: playOption("subdivide")?.value, accent: accent() }),
      );
    } catch (error) {}
  });
  const rate = () => Number(playOption("rate")?.value) || 1;

  // Practice (#391): Play transposed, saved files as practised, the loop
  // faster each pass — kept in this browser, like the rest of Playback.
  const PRACTICE = "eui-score-studio-practice";
  const practiceOption = (name) => root.querySelector(`[data-practice="${name}"]`);
  try {
    const kept = JSON.parse(localStorage.getItem(PRACTICE) || "{}");
    for (const [name, value] of Object.entries(kept)) {
      const el = practiceOption(name);
      if (el?.type === "checkbox") el.checked = Boolean(value);
      else if (el) el.value = value;
    }
  } catch (error) {}
  root.querySelector("[data-practice-box]")?.closest(".tool-section")?.addEventListener("change", (event) => {
    const name = event.target.dataset?.practice;
    if (!name) return;
    // The audio takes (#390) are sound, not notes: they keep their pitch.
    const takes = st.audio?.mixerTracks().length ? " The audio takes keep their own pitch." : "";
    if (name === "transpose") say(`Play transposed: ${Pr.transposeText(transposeNow())}${st.playing ? ", heard from the next Play" : ""}.${takes}`);
    try {
      const all = Object.fromEntries([...root.querySelectorAll("[data-practice]")].map((el) => [el.dataset.practice, el.type === "checkbox" ? el.checked : el.value]));
      localStorage.setItem(PRACTICE, JSON.stringify(all));
    } catch (error) {}
  });
  const transposeNow = () => Pr.transposition(practiceOption("transpose")?.value);
  const rampNow = () => Pr.rampOf({ from: practiceOption("from")?.value, step: practiceOption("step")?.value, to: practiceOption("to")?.value, atTarget: practiceOption("at")?.value });
  /** The practice a saved file gets: the speed and the transposition, when Playback asks for it. */
  const exportPractice = () => (practiceOption("exports")?.checked ? { transpose: transposeNow(), tempo: rate() } : null);
  ctx.exportPractice = exportPractice;
  const showRamp = (text) => {
    const out = root.querySelector("[data-practice-now]");
    if (out) out.textContent = text;
  };

  /** A pass of the rising loop is over: the next a step faster, or the end at the target. */
  function rampPass(state, handle) {
    const next = Pr.rampAfter(state.ramp, state.pass);
    if (next.done) {
      stopPlay();
      const text = `Practice loop: ${next.percent} % reached after ${state.pass + 1} passes.`;
      showRamp(text);
      return say(text);
    }
    state.pass = next.pass;
    // The audio takes follow on the next tick (audio-ui.js `sync`: a new rate starts them again
    // there). TIME-STRETCH: they follow by playbackRate, their pitch with it (takes.js `scheduleOf`).
    handle.rate = next.percent / 100;
    showRamp(Pr.rampText(state.ramp, state.pass));
  }

  /** Play; pause; play on. A second press while the sounds load gives up. */
  async function togglePlay() {
    const playing = st.playing;
    if (playing?.handle) {
      // A take being recorded is not paused: it ends.
      if (st.taking) return stopPlay();
      if (playing.handle.paused) {
        playing.handle.resume();
        playing.next = null;
        say("Playing — Space to pause");
      } else {
        playing.handle.pause();
        playing.voices?.silence();
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
    // A take is recorded straight through, never looped.
    const looping = !st.taking && (Boolean(st.loopBars) || playOption("loop")?.checked);
    const played = st.score && (st.recording || looping) ? M.padded(st.score) : st.score;
    // The staff recorded into is silent: in this browser it is muted, and a
    // MIDI device (Sound to) is not sent its old notes at all.
    if (st.recording) M.write(played, st.recording.lane, 0, M.barStart(played, M.barsOf(played)), { rest: true });
    const passes = played ? M.playback(played) : [];
    // From the selection's bar (its first pass), or from the start.
    const loopBars = st.taking ? null : (st.loopBars ?? (looping ? selectedBarsOrNull() : null));
    const loop = loopBars && st.score ? loopOf(passes, loopBars) : null;
    if (looping && !loop) say("Select the bars to loop: playing from the start.");
    if (st.recording) st.recording.loop = loop ? loopBars : null;
    const from = changeBar();
    const at = loop ? loop.start : from == null ? 0 : (passes.find((p) => p.bar === from)?.start ?? 0);
    let bytes;
    let sound = null;
    let notes = [];
    try {
      bytes = await heardMidi(played, passes, { practice: { transpose: transposeNow() } });
      // The synthesizer's staves and the own SoundFonts' (#391): in this browser only, not to a MIDI device.
      if (!P.outputPort()) {
        sound = await st.instruments.prepare(played);
        ({ bytes, notes } = st.instruments.forSound(bytes, sound));
      }
    } catch (error) {
      return say(error.message ?? String(error), true);
    }
    const state = { handle: null, passes, times: noteTimes(passes), beats: played ? M.beats(played, passes, { subdivide: Number(playOption("subdivide")?.value) || 0 }) : [], loop, next: null, now: [], lit: -1, frame: 0, timer: 0, ticker: 0 };
    // The loop faster each pass, from its first speed (#391).
    if (practiceOption("ramp")?.checked) {
      if (loop) Object.assign(state, { ramp: rampNow(), pass: 0 });
      else state.unramped = true;
    }
    st.playing = state;
    showState();
    const progress = (f) => st.playing === state && say(`Loading the sounds… ${Math.round(100 * f)} % (38 MB, once)`);
    try {
      if (!P.isReady()) say("Loading the sounds…");
      await P.prepare(progress);
      if (st.playing !== state) return;
      // A recording always counts a bar in.
      if ((st.recording || st.taking || playOption("count-in")?.checked) && passes.length) await countIn(state, at);
      if (st.playing !== state) return;
      state.handle = await P.play(bytes, { at, onStop: () => st.playing === state && stopPlay() });
    } catch (error) {
      if (st.playing === state) stopPlay();
      return say("The sounds could not be loaded.", true);
    }
    if (!state.handle || st.playing !== state) return;
    state.handle.rate = state.ramp ? Pr.rampPercent(state.ramp, 0) / 100 : rate();
    if (state.ramp) showRamp(Pr.rampText(state.ramp, 0));
    if (notes.length) {
      state.voices = new Sy.Scheduler({
        ctx: P.unlock(),
        notes,
        settingsOf: st.instruments.settingsFor(sound),
        destinationOf: (channel) => st.liveMixer?.strips[channel % 16].input ?? P.unlock().destination,
      });
    }
    applyMix();
    // The audio tracks, in time with it.
    st.audio?.startPlayback(state.handle);
    // The padding staff's note, silent.
    if (played !== st.score) {
      state.padChannel = M.channels(played).at(-1).channel;
      P.mute(state.padChannel, true);
    }
    if (state.unramped) say("Faster each pass plays a loop: set one first (Play ▸ Loop, or the MIDI view's ruler). Playing from the start — Space to pause");
    else if (!st.recording && !st.taking) say(loop ? "Looping the selected bars — Space to pause" : "Playing — Space to pause");
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
    const beat = ((M.WHOLE / den) / (M.WHOLE / pass.base)) * (60 / pass.bpm) / (state.ramp ? Pr.rampPercent(state.ramp, 0) / 100 : rate());
    const t0 = P.audioTime() + 0.05;
    for (let k = 0; k < num; k++) P.click(t0 + k * beat, k === 0 && accent());
    say("One bar to come in…");
    return new Promise((resolve) => setTimeout(resolve, (num * beat + 0.05) * 1000));
  }

  /** Every 25 ms: the loop's jump back, and the metronome's clicks due in the next 120 ms, each once. */
  function tick() {
    const state = st.playing;
    const handle = state?.handle;
    // The audio tracks follow a seek, the loop's jump, a pause, a new speed.
    if (handle) st.audio?.sync(handle);
    if (!handle || handle.paused) return;
    const now = handle.time;
    if (state.loop && now >= state.loop.end - 0.02) {
      handle.time = state.loop.start;
      state.next = null;
      if (state.ramp) rampPass(state, handle);
      return;
    }
    state.voices?.tick(now, handle.rate);
    // A recording always has the metronome.
    if (!(st.recording || playOption("metronome")?.checked) || !state.beats.length) return;
    const beats = state.beats;
    // After a jump — a seek, the loop — the count starts again where the music is.
    const lost = state.next == null || (state.next > 0 && beats[state.next - 1].sec > now + 0.3) || (beats[state.next] && beats[state.next].sec < now - 0.3);
    if (lost) state.next = Math.max(0, beats.findIndex((b) => b.sec >= now - 0.01));
    while (state.next < beats.length && beats[state.next].sec < now + 0.12) {
      const b = beats[state.next++];
      if (b.sec >= now - 0.01) P.click(P.audioTime() + (b.sec - now) / handle.rate, b.down && accent(), b.sub);
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
      playing.voices?.silence();
      if (playing.handle) playing.handle.stop();
      else P.stop(); // still loading: it must not start after all
      if (playing.padChannel != null) P.mute(playing.padChannel, false);
    }
    st.audio?.stopPlayback();
    progress.hidden = true;
    playhead.hidden = true;
    say("");
    if (st.recording) return finishRecording(reached);
    if (st.taking) {
      draw();
      return st.audio.finishTake();
    }
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
    const bars = pass && st.score ? ` · bar ${barNo(pass.bar)} of ${barNo(M.barsOf(st.score) - 1)}` : "";
    progress.querySelector(".studio-progress-text").textContent = `${clock(now)} / ${clock(total)}${bars}`;
    state.textContent = `Playing${bars} · ${clock(now)} / ${clock(total)} — Space to stop`;
  }

  // ---- Mute, solo, and where the sound goes ----------------------------------------

  // The mixer (mixer.js) is the score's: kept in its text, one Undo away,
  // its M and S the same as the Playback section's. Its graph is built on
  // Play's AudioContext with the synthesizer, and again on each WAV's.

  /** Mute and solo as the Playback section shows them: the score's mixer's, and the staff recorded into. */
  function mixFromMeta() {
    const mix = X.mixOf(st.score);
    st.mix = { mute: new Set(X.lanesWith(mix, "mute")), solo: new Set(X.lanesWith(mix, "solo")) };
    if (st.recording?.muted) st.mix.mute.add(st.recording.lane);
  }
  mixFromMeta();

  /** The mixer as heard: the score's, or the one a moving fader previews; the staff recorded into silent. */
  function mixHeard() {
    // A stem being made: its staff alone.
    if (st.stemMix) return st.stemMix;
    const mix = st.heardMix ?? X.mixOf(st.score);
    return st.recording?.muted ? (X.patched(mix, st.recording.lane, { mute: true }) ?? {}) : mix;
  }

  // Play's mixer goes out through the MIDI-learn volume (player.js), a WAV's straight to its file.
  P.setRouter((ctx, synth, offline, destination) => {
    const graph = X.mixerGraph(ctx, synth, destination);
    graph.apply(mixHeard(), st.score ? M.channels(st.score) : []);
    if (!offline) st.liveMixer = graph;
    // Save the sound: the synthesizer's notes, all scheduled, into their strips (#391).
    else if (st.offlineNotes?.notes.length) Sy.scheduleAll(ctx, st.offlineNotes.notes, st.offlineNotes.settingsOf, (channel) => graph.strips[channel % 16].input);
  });

  /**
   * What Save the sound renders: the heard MIDI (practised, when Playback
   * asks), its own SoundFonts' presets in, its synthesizer's notes out —
   * those ready for the router to schedule.
   */
  async function soundMidi() {
    const bytes = await heardMidi(st.score, undefined, { practice: exportPractice() });
    const sound = await st.instruments.prepare(st.score);
    const made = st.instruments.forSound(bytes, sound);
    st.offlineNotes = { notes: made.notes, settingsOf: st.instruments.settingsFor(sound) };
    return made.bytes;
  }

  /** Each staff's channel as the mixer says: muted, or not soloed while another is; its level, pan and effects. */
  function applyMix() {
    if (!st.score) return;
    const mix = mixHeard();
    for (const { lane, channel } of M.channels(st.score)) P.mute(channel, !X.audible(mix, lane));
    st.liveMixer?.apply(mix, M.channels(st.score));
    st.audio?.applyMix(mix);
  }

  /** A track's (or the master's) settings changed: kept in the score, heard at once. */
  function mixCommit(lane, patch) {
    st.heardMix = null;
    edit((score) => X.setMix(score, lane, patch));
    mixFromMeta();
    applyMix();
    renderMix();
  }

  st.instruments = installInstruments({ root, st, M, P, edit, say });
  st.mixer = mixerPanel({
    root,
    instrument: st.instruments,
    tracks: () => (st.score ? [...M.channels(st.score).map(({ lane, name }) => ({ lane, name, colour: R.laneColour(st.score, lane) })), ...(st.audio?.mixerTracks() ?? [])] : []),
    mix: () => X.mixOf(st.score),
    preview: (mix) => {
      st.heardMix = mix;
      applyMix();
    },
    commit: mixCommit,
    level: () => (st.playing?.handle && st.liveMixer ? st.liveMixer.level().peak : 0),
  });

  // The microphone (audio-ui.js, #390): what of the editor it works with.
  st.audio = audioTracks({
    root,
    st,
    options: options.audio ?? {},
    studio: {
      say,
      edit,
      draw,
      play: () => togglePlay(),
      stop: () => stopPlay(),
      showPlace: (lane, tick) => {
        keepOn(lane, tick);
        draw();
      },
      changeBar,
      laneName,
      barNo,
      grid: () => M.RECORDING_GRIDS[quantizeBox?.value] ?? M.RECORDING_GRIDS.sixteenth,
      gridName: () => quantizeBox?.selectedOptions[0]?.textContent ?? "sixteenths",
      mixHeard,
    },
  });

  /** The Playback section's staves, a Mute and a Solo for each. */
  function renderMix() {
    st.mixer?.refresh();
    st.instruments?.check();
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
    say(st.loopBars ? `Loop: ${a === b ? `bar ${barNo(a)}` : `bars ${barNo(a)}–${barNo(b)}`}, played over and over (and recorded into). A click on it in the MIDI view's ruler, or Play › No loop, takes it away.` : "No loop: the music plays on.");
    draw();
  }

  // ---- Recording from a MIDI keyboard --------------------------------------------
  //
  // R (or Record) plays the score from the selected bar after a bar of
  // count-in, the metronome on and the staff recorded into silent; the keys
  // played are kept with the times they were heard at, and written when the
  // music stops, fitted to the Quantize grid. One Undo takes it all back.

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
        ? `Recording into ${laneName(lane)}, bars ${barNo(loop[0])}–${barNo(loop[1])} in a loop: each pass adds its notes; R stops.`
        : `Recording into ${laneName(lane)} from bar ${barNo(st.recording.bar)}: play after the count-in; R stops.`);
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

  /**
   * The tick being heard now, while recording — or when the key's message
   * was `stamp` (ms, performance.now()), less the time it waited to be read;
   * null before the music has started or while it is paused.
   */
  function recordingNow(stamp = null) {
    const handle = st.playing?.handle;
    if (!st.recording || !handle || handle.paused) return null;
    const sec = stamp == null ? handle.heard : S.struckAt(handle.heard, handle.rate, performance.now() - stamp);
    return M.tickAtPlayed(st.score, st.playing.passes, sec);
  }

  function recordKey(key, held, velocity = 100, stamp = null) {
    if (!st.recording) return;
    P.hold(key, true, st.recording.program, { drums: st.recording.drums, velocity, channel: st.recording.channel });
    const t = recordingNow(stamp);
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
      // How hard each key was struck: the velocity of the note it wrote.
      Vel.setVelocities(score, Vel.fromRecording(score, rec.lane, rec.played, grid));
      // The knobs, the pedal and the bend played meanwhile (automation-ui.js), as curves.
      A.writeRecorded(score, M.upperOf(score, rec.lane), rec.cc, from, M.barStart(score, lastBar + 1));
    });
    const bars = lastBar === first ? `bar ${barNo(first)}` : `bars ${barNo(first)}–${barNo(lastBar)}`;
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
      for (const sec of G.heardAt(st.score, passes, staff, index, starts[staff][index])) {
        const key = Math.round(sec * 1000);
        if (!at.has(key)) at.set(key, { sec, items: [] });
        at.get(key).items.push(item);
      }
    });
    return [...at.values()].sort((a, b) => a.sec - b.sec);
  }

  // The MIDI clock, sent and followed, and MIDI learn (midi-sync.js).
  ctx.sync = S.attach({ root, st, M, P, act, say });

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
    if (st.passed.length) say(`${options.greeting ?? "Opened."}${passedText()}`);
    else if (options.greeting) say(options.greeting);
    else if (shared && sharedText == null) say(`That link holds no score: here is ${draft ? "your last one" : "the starting one"}.`, true);
    else if (sharedText != null) say("A shared score. Your changes stay in this browser; Share makes a new link.");
    else if (!fromExample && start !== sourceBox.defaultValue) say("Your last score, kept in this browser. New starts afresh.");
    else say("Click a note to select it, or press N and type A–G to write.");
    // After what was said on opening, not in its place.
    if (keptHistoryNote()) say(`${status.textContent} ${keptHistoryNote()}`.trim(), status.classList.contains("studio-error"));
  });
  // `parse`: the engraver's reading of a text (score_json), for the app's merge.
  return { state: st, ready, source: () => st.text, load, peers: setPeers, parse: (text) => score_json(text), markers: setMarkers, selectPlace, placeLabel, place };
}
