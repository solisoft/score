// The score editor's keyboard shortcuts, in one table: the keyboard handler
// (studio.js) finds what a key does in it, and the shortcuts sheet ("?") is
// written from it. A key handled is therefore a key listed (#369).
//
// Each entry: `keys` and `does`, as the sheet shows them ("Ctrl" written for
// Ctrl on Windows and Linux, ⌘ on a Mac: see `keyLabel`), and `match(key,
// ctx)`, which answers [action, data] for a key it takes, or null. `key` is
// a keydown's { key, code, mod (Ctrl or ⌘), shiftKey, altKey }; `ctx` is
// { inputOn, alter, onButton } — note input on, the selected note's
// alteration, a button focused. Two actions are the handler's own:
// "escape" (note input off, or the selection dropped) and "input-back".

// What each entry does, in the page's language (#508): the keys stay as they are matched.
const V = new URL(import.meta.url).search;
const { tr } = await import(`./words.js${V}`);

const KEY_DURATIONS = { 2: 32, 3: 16, 4: 8, 5: 4, 6: 2, 7: 1 };
const LETTERS = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };
const lower = (k) => k.key.toLowerCase();

export const SHORTCUTS = [
  {
    keys: "N or I / Esc",
    does: tr("note input on and off / select"),
    match: (k, ctx) => {
      if (k.mod) return null;
      // I as well as N (#423).
      if (lower(k) === "n" || (lower(k) === "i" && !k.altKey)) return [ctx.inputOn ? "mode-select" : "mode-input"];
      return k.key === "Escape" ? ["escape"] : null;
    },
  },
  {
    keys: "A–G",
    does: tr("write a note (Shift: add to the chord)"),
    match: (k) => {
      const step = LETTERS[lower(k)];
      return k.mod || k.altKey || step === undefined ? null : ["letter", { step, add: k.shiftKey }];
    },
  },
  // R as well as 0 in note input (#423): out of it, R records (below).
  { keys: "0 / R", does: tr("rest (R: in note input)"), match: (k, ctx) => (!k.mod && (k.key === "0" || (ctx.inputOn && lower(k) === "r")) ? ["rest"] : null) },
  {
    keys: "2–7 / .",
    does: tr("32nd … whole / dot"),
    match: (k) => {
      if (k.mod) return null;
      if (KEY_DURATIONS[k.key]) return ["duration", { base: KEY_DURATIONS[k.key] }];
      return k.key === "." ? ["dot"] : null;
    },
  },
  {
    keys: "Ctrl+Shift+↑ ↓",
    does: tr("draw the notes on the staff above / below (again: back)"),
    match: (k) => (k.mod && k.shiftKey && !k.altKey && (k.key === "ArrowUp" || k.key === "ArrowDown") ? ["cross", { dir: k.key === "ArrowUp" ? "-1" : "1" }] : null),
  },
  {
    keys: "↑ ↓",
    does: tr("step; Shift semitone; Ctrl octave"),
    match: (k) => {
      if (k.key !== "ArrowUp" && k.key !== "ArrowDown") return null;
      const by = k.key === "ArrowUp" ? 1 : -1;
      if (k.mod) return ["move", { how: "octave", by }];
      return k.altKey ? null : ["move", { how: k.shiftKey ? "semitone" : "step", by }];
    },
  },
  {
    keys: "Alt+↑ ↓",
    does: tr("a note of the chord"),
    match: (k) => (!k.mod && k.altKey && (k.key === "ArrowUp" || k.key === "ArrowDown") ? [k.key === "ArrowUp" ? "head-up" : "head-down"] : null),
  },
  {
    keys: "← →",
    does: tr("previous / next; Shift extends"),
    match: (k) => (!k.mod && (k.key === "ArrowRight" || k.key === "ArrowLeft") ? [k.key === "ArrowRight" ? "next" : "previous", { extend: k.shiftKey }] : null),
  },
  {
    keys: "+ − =",
    does: tr("sharp, flat, natural"),
    match: (k, ctx) => {
      if (k.mod) return null;
      if (k.key === "+") return ["alter", { alter: Math.min(2, ctx.alter + 1) }];
      if (k.key === "-") return ["alter", { alter: Math.max(-2, ctx.alter - 1) }];
      return k.key === "=" ? ["alter", { alter: 0 }] : null;
    },
  },
  {
    keys: "T / S / Shift+S",
    does: tr("tie / slur / phrasing slur"),
    match: (k) => {
      if (k.mod) return null;
      if (lower(k) === "s" && k.shiftKey) return ["phrase"];
      return { t: ["tie"], s: ["slur"] }[lower(k)] ?? null;
    },
  },
  { keys: "X", does: tr("flip the stems: up, down, as the voice wants"), match: (k) => (!k.mod && !k.altKey && lower(k) === "x" ? ["stem-flip"] : null) },
  {
    keys: "Alt+B / Alt+Shift+B",
    does: tr("beam the selection by hand (again: unbeamed) / break the beam here"),
    match: (k) => (!k.mod && k.altKey && (k.code === "KeyB" || lower(k) === "b") ? [k.shiftKey ? "beam-break" : "beam"] : null),
  },
  { keys: "J", does: tr("spell the other way: C♯ ↔ D♭"), match: (k) => (!k.mod && !k.altKey && lower(k) === "j" ? ["enharmonic"] : null) },
  {
    keys: "Alt+Shift+1–5",
    does: tr("fingering on the grace note before the note"),
    match: (k) => (!k.mod && k.altKey && k.shiftKey && /^(Digit|Numpad)[1-5]$/.test(k.code) ? ["grace-finger", { n: k.code.slice(-1) }] : null),
  },
  {
    keys: "Alt+1–5",
    does: tr("fingering (again to take it away)"),
    match: (k) => (!k.mod && k.altKey && /^(Digit|Numpad)[1-5]$/.test(k.code) ? ["finger", { n: k.code.slice(-1) }] : null),
  },
  {
    keys: "L / K, Ctrl+L / Ctrl+K",
    does: tr("lyrics / chord symbol"),
    match: (k) => (k.altKey ? null : { l: ["lyrics"], k: ["chord"] }[lower(k)] ?? null),
  },
  { keys: "Ctrl+Alt+1 – 4", does: tr("voice 1, 2, 3 or 4"), match: (k) => (k.mod && k.altKey && /^(Digit|Numpad)[1-4]$/.test(k.code) ? ["voice", { voice: k.code.slice(-1) }] : null) },
  { keys: "Ctrl+Alt+M", does: tr("comment on the selection (in the app)"), match: (k) => (k.mod && k.altKey && (k.code === "KeyM" || lower(k) === "m") ? ["comment"] : null) },
  { keys: "Ctrl+3, 5, 6, 7", does: tr("tuplets"), match: (k) => (k.mod && !k.altKey && ["3", "5", "6", "7"].includes(k.key) ? ["tuplet", { n: k.key }] : null) },
  { keys: "]", does: tr("a bar at the end"), match: (k) => (!k.mod && k.key === "]" ? ["add-bar"] : null) },
  { keys: "Insert", does: tr("a bar before the selection"), match: (k) => (!k.mod && k.key === "Insert" ? ["insert-bar"] : null) },
  { keys: "Ctrl+Delete", does: tr("take the selected bars away"), match: (k) => (k.mod && (k.key === "Delete" || k.key === "Backspace") ? ["delete-bars"] : null) },
  {
    keys: "Delete",
    does: tr("make rests; in note input, Backspace takes the last note back"),
    match: (k, ctx) => {
      if (k.mod) return null;
      if (k.key === "Delete") return ["rest"];
      if (k.key !== "Backspace") return null;
      return ctx.inputOn ? ["input-back"] : ["rest"];
    },
  },
  {
    keys: "Ctrl+C V X",
    does: tr("copy, paste, cut — as LilyPond, with other programs too"),
    match: (k) => {
      if (!k.mod || k.altKey) return null;
      if (lower(k) === "v") return k.shiftKey ? null : ["paste"];
      return { c: ["copy"], x: ["cut"] }[lower(k)] ?? null;
    },
  },
  { keys: "Ctrl+Shift+V", does: tr("insert the copied bars before the selection"), match: (k) => (k.mod && k.shiftKey && !k.altKey && lower(k) === "v" ? ["insert-copied"] : null) },
  {
    keys: "Ctrl+Z / Y",
    does: tr("undo / redo (Ctrl+Shift+Z redoes too)"),
    match: (k) => {
      if (!k.mod || k.altKey) return null;
      if (lower(k) === "z") return [k.shiftKey ? "redo" : "undo"];
      return lower(k) === "y" ? ["redo"] : null;
    },
  },
  {
    keys: "Ctrl++ / Ctrl+−",
    does: tr("larger / smaller"),
    match: (k) => {
      if (!k.mod || k.altKey) return null;
      if (k.key === "+" || k.key === "=") return ["zoom-in"];
      return k.key === "-" || k.key === "_" ? ["zoom-out"] : null;
    },
  },
  { keys: "R", does: tr("record from the MIDI keyboard (out of note input)"), match: (k, ctx) => (!k.mod && !ctx.inputOn && lower(k) === "r" ? ["record"] : null) },
  { keys: "Space", does: tr("play / pause"), match: (k, ctx) => (k.key === " " && !ctx.onButton ? ["play"] : null) },
  { keys: "?", does: tr("this sheet"), match: (k) => (k.key === "?" ? ["keys"] : null) },
];

/** The keys of the sheet that are words, as the page's language says them; the others as they are. */
const KEY_WORDS = () => ({
  "N or I / Esc": tr("N or I / Esc"),
  Insert: tr("Insert"),
  "Ctrl+Delete": tr("Ctrl+Delete"),
  Delete: tr("Delete"),
  Space: tr("Space"),
});

/** An entry's `keys` as the shortcuts sheet shows them: in the page's language. */
export function keysShown(keys) {
  return KEY_WORDS()[keys] ?? keys;
}

/** What a keydown does: [action, data], or null for a key the editor leaves alone. */
export function resolveKey(event, ctx = {}) {
  const k = { key: event.key ?? "", code: event.code ?? "", mod: !!(event.ctrlKey || event.metaKey), shiftKey: !!event.shiftKey, altKey: !!event.altKey };
  const context = { inputOn: !!ctx.inputOn, alter: ctx.alter ?? 0, onButton: !!ctx.onButton };
  for (const entry of SHORTCUTS) {
    const found = entry.match(k, context);
    if (found) return [found[0], found[1] ?? {}];
  }
  return null;
}

/** Whether the browser runs on a Mac (or an iPad, whose keyboards have ⌘). */
export function isMac(nav = globalThis.navigator) {
  const platform = nav?.userAgentData?.platform || nav?.platform || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** A shortcut as the keyboard in front of the person says it: Ctrl and Alt are ⌘ and ⌥ on a Mac. */
export function keyLabel(text, mac = isMac()) {
  if (!mac) return text;
  return text.replace(/\bCtrl\+/g, "⌘").replace(/\bCtrl\b/g, "⌘").replace(/\bAlt\+/g, "⌥").replace(/\bAlt\b/g, "⌥").replace(/\bShift\+/g, "⇧");
}
