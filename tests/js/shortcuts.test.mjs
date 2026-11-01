// The editor's keyboard shortcuts: one table that the keys are found in and
// the "?" sheet is written from, and their names on a Mac (#369).
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SHORTCUTS, resolveKey, isMac, keyLabel } from "../../public/eui-score/shortcuts.js";

const press = (key, more = {}) => ({ key, code: more.code ?? "", ctrlKey: !!more.ctrl, metaKey: !!more.meta, shiftKey: !!more.shift, altKey: !!more.alt });
/** The entry of the sheet a key is found in: the one whose `match` takes it. */
const entryOf = (event, ctx = {}) =>
  SHORTCUTS.find((entry) => entry.match({ key: event.key, code: event.code, mod: event.ctrlKey || event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey }, { inputOn: false, alter: 0, onButton: false, ...ctx }));

// The editor's menus as they read, each label (a `t("…")` in the app's
// language, #508) taken for its text: the shortcuts stay literal.
function studioMarkup() {
  const template = readFileSync(new URL("../../app/views/shared/_studio.html.slv", import.meta.url), "utf8");
  return template.replace(/<%[-=] t\("[^"]+"\) %>/g, "label");
}

test("shortcuts: every entry of the sheet says its keys and what they do", () => {
  assert.ok(SHORTCUTS.length > 15);
  for (const entry of SHORTCUTS) {
    assert.ok(entry.keys.trim(), "keys");
    assert.ok(entry.does.trim(), `what ${entry.keys} does`);
    assert.equal(typeof entry.match, "function");
  }
  assert.equal(new Set(SHORTCUTS.map((e) => e.keys)).size, SHORTCUTS.length, "no entry twice");
});

test("shortcuts: the keys the audit found missing are handled, and listed", () => {
  const cases = [
    [press("r"), "record", "R"],
    [press("l"), "lyrics", "L / K, Ctrl+L / Ctrl+K"],
    [press("k"), "chord", "L / K, Ctrl+L / Ctrl+K"],
    [press("l", { ctrl: true }), "lyrics", "L / K, Ctrl+L / Ctrl+K"],
    [press("¡", { ctrl: true, alt: true, code: "Digit1" }), "voice", "Ctrl+Alt+1 – 4"],
    [press("™", { meta: true, alt: true, code: "Digit2" }), "voice", "Ctrl+Alt+1 – 4"],
    [press("V", { ctrl: true, shift: true }), "insert-copied", "Ctrl+Shift+V"],
    // Comment on the selection (#385): on a Mac, Alt makes another letter of M; its code stays.
    [press("µ", { meta: true, alt: true, code: "KeyM" }), "comment", "Ctrl+Alt+M"],
    [press("m", { ctrl: true, alt: true, code: "KeyM" }), "comment", "Ctrl+Alt+M"],
  ];
  assert.equal(resolveKey(press("m", { ctrl: true }))?.[0], undefined, "Ctrl+M alone is not a comment");
  // R (#423): a rest in note input, as 0 is; recording out of it.
  assert.equal(resolveKey(press("r"), { inputOn: true })?.[0], "rest");
  assert.equal(resolveKey(press("r"))?.[0], "record");
  assert.equal(entryOf(press("r"), { inputOn: true })?.keys, "0 / R");
  assert.equal(entryOf(press("R", { shift: true }), { inputOn: true })?.keys, "0 / R");
  assert.equal(entryOf(press("0"))?.keys, "0 / R");
  assert.equal(entryOf(press("r"))?.keys, "R");
  assert.equal(entryOf(press("r", { ctrl: true }), { inputOn: true }), undefined, "Ctrl+R is the browser's");
  // I turns note input on and off, as N does (#423); S stays the slur.
  assert.equal(resolveKey(press("i"))?.[0], "mode-input");
  assert.equal(resolveKey(press("i"), { inputOn: true })?.[0], "mode-select");
  assert.equal(resolveKey(press("s"))?.[0], "slur");
  for (const [event, act, keys] of cases) {
    assert.equal(resolveKey(event)?.[0], act, `${event.key} does ${act}`);
    assert.equal(entryOf(event)?.keys, keys, `${event.key} is listed as ${keys}`);
  }
  assert.deepEqual(resolveKey(press("1", { ctrl: true, alt: true, code: "Digit1" })), ["voice", { voice: "1" }]);
  assert.deepEqual(resolveKey(press("2", { ctrl: true, alt: true, code: "Numpad2" })), ["voice", { voice: "2" }]);
  assert.deepEqual(resolveKey(press("3", { ctrl: true, alt: true, code: "Digit3" })), ["voice", { voice: "3" }]);
  assert.deepEqual(resolveKey(press("4", { meta: true, alt: true, code: "Numpad4" })), ["voice", { voice: "4" }]);
  assert.notEqual(resolveKey(press("5", { ctrl: true, alt: true, code: "Digit5" }))?.[0], "voice", "a staff holds four voices");
  // The Add menu names voices 2 to 4 with their keys.
  const markup = studioMarkup();
  for (const v of [2, 3, 4]) assert.match(markup, new RegExp(`data-act="voice" data-voice="${v}">[^<]+<kbd>Ctrl\\+Alt\\+${v}</kbd>`));
});

test("shortcuts: + and − are sharp and flat; with Ctrl or ⌘ they zoom", () => {
  assert.deepEqual(resolveKey(press("+"), { alter: 0 }), ["alter", { alter: 1 }]);
  assert.deepEqual(resolveKey(press("-"), { alter: 0 }), ["alter", { alter: -1 }]);
  assert.deepEqual(resolveKey(press("+"), { alter: 2 }), ["alter", { alter: 2 }], "no more than a double sharp");
  assert.deepEqual(resolveKey(press("-"), { alter: -2 }), ["alter", { alter: -2 }], "no less than a double flat");
  assert.deepEqual(resolveKey(press("=")), ["alter", { alter: 0 }]);
  // Ctrl+= is what Ctrl and the + key give on a US keyboard, without Shift.
  for (const key of ["+", "="]) {
    assert.equal(resolveKey(press(key, { ctrl: true }))?.[0], "zoom-in");
    assert.equal(resolveKey(press(key, { meta: true }))?.[0], "zoom-in");
  }
  for (const key of ["-", "_"]) assert.equal(resolveKey(press(key, { ctrl: true }))?.[0], "zoom-out");
  assert.equal(resolveKey(press("+", { ctrl: true, alt: true })), null, "Ctrl+Alt+ is not taken");
});

test("shortcuts: what each key does, and what it leaves to the browser", () => {
  const cases = [
    [press("z", { ctrl: true }), ["undo", {}]],
    [press("Z", { ctrl: true, shift: true }), ["redo", {}]],
    [press("y", { meta: true }), ["redo", {}]],
    [press("c", { ctrl: true }), ["copy", {}]],
    [press("x", { ctrl: true }), ["cut", {}]],
    [press("v", { ctrl: true }), ["paste", {}]],
    [press("3", { ctrl: true }), ["tuplet", { n: "3" }]],
    [press("Delete", { ctrl: true }), ["delete-bars", {}]],
    [press("Backspace", { meta: true }), ["delete-bars", {}]],
    [press("n"), ["mode-input", {}]],
    [press("Escape"), ["escape", {}]],
    [press("C", { shift: true }), ["letter", { step: 0, add: true }]],
    [press("g"), ["letter", { step: 4, add: false }]],
    [press("0"), ["rest", {}]],
    [press("4"), ["duration", { base: 8 }]],
    [press("."), ["dot", {}]],
    [press("ArrowUp"), ["move", { how: "step", by: 1 }]],
    [press("ArrowDown", { shift: true }), ["move", { how: "semitone", by: -1 }]],
    [press("ArrowUp", { ctrl: true }), ["move", { how: "octave", by: 1 }]],
    [press("ArrowDown", { alt: true }), ["head-down", {}]],
    [press("ArrowLeft", { shift: true }), ["previous", { extend: true }]],
    [press("]"), ["add-bar", {}]],
    [press("Insert"), ["insert-bar", {}]],
    [press("Delete"), ["rest", {}]],
    [press("Backspace"), ["rest", {}]],
    [press("t"), ["tie", {}]],
    [press("S"), ["slur", {}]],
    [press("S", { shift: true }), ["phrase", {}]],
    [press("ArrowUp", { ctrl: true, shift: true }), ["cross", { dir: "-1" }]],
    [press("ArrowDown", { ctrl: true, shift: true }), ["cross", { dir: "1" }]],
    [press("x"), ["stem-flip", {}]],
    [press("j"), ["enharmonic", {}]],
    [press("∫", { alt: true, code: "KeyB" }), ["beam", {}]],
    [press("B", { alt: true, shift: true, code: "KeyB" }), ["beam-break", {}]],
    [press("#", { alt: true, shift: true, code: "Digit3" }), ["grace-finger", { n: "3" }]],
    [press("ArrowUp", { ctrl: true }), ["move", { how: "octave", by: 1 }]],
    [press("£", { alt: true, code: "Digit3" }), ["finger", { n: "3" }]],
    [press(" "), ["play", {}]],
    [press("?", { shift: true }), ["keys", {}]],
  ];
  for (const [event, expected] of cases) assert.deepEqual(resolveKey(event), expected, JSON.stringify(event));
  // In note input, N goes back to selecting and Backspace takes the last note back.
  assert.deepEqual(resolveKey(press("n"), { inputOn: true }), ["mode-select", {}]);
  assert.deepEqual(resolveKey(press("Backspace"), { inputOn: true }), ["input-back", {}]);
  // Space on a focused button presses the button.
  assert.equal(resolveKey(press(" "), { onButton: true }), null);
  // The browser's own: reload, new tab, save, print, find; and Alt+letters (menus, characters).
  for (const event of [press("r", { ctrl: true }), press("t", { meta: true }), press("s", { ctrl: true }), press("p", { ctrl: true }), press("f", { meta: true }), press("n", { ctrl: true }), press("c", { alt: true }), press("Tab"), press("F5"), press("2", { ctrl: true })]) {
    assert.equal(resolveKey(event), null, JSON.stringify(event));
  }
});

test("shortcuts: every shortcut a menu names does what the menu item does", () => {
  const markup = studioMarkup();
  const names = { Esc: "Escape", Del: "Delete", Space: " ", "−": "-" };
  const items = [...markup.matchAll(/data-act="([a-z-]+)"[^>]*>[^<]*<kbd>([^<]+)<\/kbd>/g)].map((m) => [m[1], m[2]]);
  const keyed = items.filter(([, kbd]) => /^((Ctrl|Alt|Shift)\+)*([A-Z0-9?\]+−]|Esc|Del|Insert|Space)$/.test(kbd));
  assert.ok(keyed.length >= 18, `the menus' shortcuts are read (${keyed.length})`);
  for (const [act, kbd] of keyed) {
    const mods = kbd.match(/^((?:Ctrl|Alt|Shift)\+)*/)[0];
    const last = kbd.slice(mods.length);
    const key = names[last] ?? (mods.includes("Shift") || last.length > 1 ? last : last.toLowerCase());
    const event = press(key, { ctrl: mods.includes("Ctrl"), alt: mods.includes("Alt"), shift: mods.includes("Shift"), code: /^\d$/.test(last) ? `Digit${last}` : "" });
    const found = resolveKey(event);
    // Esc is Select notes' key: it leaves note input.
    const expected = act === "mode-select" ? "escape" : act;
    assert.equal(found?.[0], expected, `${kbd} in the menus, for ${act}`);
    assert.ok(entryOf(event), `${kbd} is in the sheet`);
  }
  assert.ok(keyed.some(([act, kbd]) => act === "zoom-in" && kbd === "Ctrl++"), "Larger says Ctrl++");
  assert.ok(keyed.some(([act, kbd]) => act === "zoom-out" && kbd === "Ctrl+−"), "Smaller says Ctrl+−");
});

test("shortcuts: a Mac is told from its platform, its new name first", () => {
  assert.equal(isMac({ platform: "MacIntel" }), true);
  assert.equal(isMac({ platform: "iPad" }), true);
  assert.equal(isMac({ userAgentData: { platform: "macOS" }, platform: "" }), true);
  assert.equal(isMac({ userAgentData: { platform: "Windows" }, platform: "MacIntel" }), false, "userAgentData wins");
  assert.equal(isMac({ platform: "Win32" }), false);
  assert.equal(isMac({ platform: "Linux x86_64" }), false);
  assert.equal(isMac({}), false);
});

test("shortcuts: Ctrl and Alt read ⌘ and ⌥ on a Mac, and stay as they are elsewhere", () => {
  assert.equal(keyLabel("Ctrl+Z", true), "⌘Z");
  assert.equal(keyLabel("Ctrl+Shift+V", true), "⌘⇧V");
  assert.equal(keyLabel("Ctrl+Alt+1 / 2", true), "⌘⌥1 / 2");
  assert.equal(keyLabel("Ctrl++ / Ctrl+−", true), "⌘+ / ⌘−");
  assert.equal(keyLabel("step; Shift semitone; Ctrl octave", true), "step; Shift semitone; ⌘ octave");
  assert.equal(keyLabel("Alt+↑ ↓", true), "⌥↑ ↓");
  assert.equal(keyLabel("Undo (Ctrl+Z)", true), "Undo (⌘Z)");
  for (const text of ["Ctrl+Z", "Ctrl+Alt+2", "Alt+↑ ↓", ".ly, MusicXML, MIDI"]) assert.equal(keyLabel(text, false), text);
  // Every entry of the sheet reads without a Ctrl or an Alt on a Mac.
  for (const { keys, does } of SHORTCUTS) assert.doesNotMatch(keyLabel(`${keys} ${does}`, true), /\b(Ctrl|Alt)\b/);
});
