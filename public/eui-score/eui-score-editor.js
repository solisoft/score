// <eui-score-editor>: a score you can edit with the mouse and the keyboard.
//
//   <script type="module" src="https://score.solisoft.net/eui-score/eui-score-editor.js"></script>
//   <eui-score-editor>
//     <script type="text/x-lilypond">{ \time 3/4 g'4 a' b' | d''2 r4 }</script>
//   </eui-score-editor>
//
// The source is LilyPond text, and stays the only state: every edit is
// made by eui-score's own edit functions (compiled to WebAssembly with the
// engraver), which rewrite the few characters that spell a note, and each
// result is engraved before it is kept — an edit the engraver would refuse
// is refused, with its reason. A source in \relative is written out in
// absolute pitches on the first edit, since a relative pitch depends on the
// notes before it.
//
//   click, ← →          select a note or rest; Alt+↑ ↓ choose a note of a chord
//   ↑ ↓                 a step in the key; Shift: a semitone; Ctrl: an octave
//   drag                move the note under the pointer; Shift: by semitones
//   A–G                 that note in place of the selection (a rest becomes it)
//   Shift+A–G           that note added above the chord
//   R, Delete           the note becomes a rest (a chord's selected note leaves it)
//   + − =               sharp, flat, natural
//   Ctrl+Z, Ctrl+Y      undo, redo        Escape: no selection
//
// Property `source` reads and replaces the LilyPond. Events: `change` after
// each edit (detail.source), `render` after each drawing (detail.ms),
// `refuse` when an edit or the source is refused (detail.message).

const V = new URL(import.meta.url).search;
// Its words in the page's language (#508): English where the page has none.
const { tr } = await import(`./words.js${V}`);
const { loaded, engine } = await import(`./eui-score.js${V}`);
const { editor_view, editor_apply } = engine;

const STYLE = `
  eui-score-editor { display: block; outline: none; }
  eui-score-editor .ese-toolbar { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
  eui-score-editor .ese-toolbar button {
    font: 600 13px/1 system-ui, sans-serif; min-width: 32px; padding: 7px 9px; border-radius: 8px;
    border: 1px solid #d4cbbb; background: #fff; color: #1d1914; cursor: pointer;
  }
  eui-score-editor .ese-toolbar button:hover:not(:disabled) { border-color: #1d1914; }
  eui-score-editor .ese-toolbar button:disabled { opacity: .4; cursor: default; }
  eui-score-editor .ese-toolbar .ese-gap { width: 10px; }
  eui-score-editor .ese-sheet { position: relative; cursor: default; touch-action: none; user-select: none; border-radius: 6px; }
  eui-score-editor:focus-visible .ese-sheet { box-shadow: 0 0 0 2px rgba(180, 55, 58, .35); }
  eui-score-editor .ese-sheet svg { display: block; max-width: 100%; height: auto; }
  eui-score-editor .ese-sheet.ese-dragging { cursor: ns-resize; }
  eui-score-editor .ese-status { min-height: 18px; margin-top: 8px; font: 12.5px/1.4 system-ui, sans-serif; color: #6e665b; }
  eui-score-editor .ese-status.ese-error { color: #8b2b2c; }
  eui-score-editor .ese-hint { font: 12px/1.5 system-ui, sans-serif; color: #8a8276; margin-top: 4px; }
`;

const LETTERS = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };

class EuiScoreEditor extends HTMLElement {
  constructor() {
    super();
    this._source = null;
    this.selected = -1;
    this.head = -1;
    this.past = [];
    this.future = [];
    this.view = null;
    this._queued = false;
    this._width = 0;
    this.drag = null;
  }

  connectedCallback() {
    if (this._built) return;
    this._built = true;
    if (!document.getElementById("eui-score-editor-style")) {
      document.head.appendChild(Object.assign(document.createElement("style"), { id: "eui-score-editor-style", textContent: STYLE }));
    }
    if (this._source === null) {
      const script = this.querySelector('script[type="text/x-lilypond"]');
      this._source = (script ? script.textContent : this.textContent).trim();
    }
    this.tabIndex = 0;
    this.innerHTML = `
      <div class="ese-toolbar" role="toolbar" aria-label="${tr("Edit the score")}">
        <button type="button" data-do="up" title="${tr("A step up (↑)")}">↑</button>
        <button type="button" data-do="down" title="${tr("A step down (↓)")}">↓</button>
        <button type="button" data-do="sharp" title="${tr("Sharp (+)")}">♯</button>
        <button type="button" data-do="flat" title="${tr("Flat (−)")}">♭</button>
        <button type="button" data-do="natural" title="${tr("Natural (=)")}">♮</button>
        <span class="ese-gap"></span>
        ${["C", "D", "E", "F", "G", "A", "B"].map((l) => `<button type="button" data-letter="${l.toLowerCase()}" title="${l} (${l})">${l}</button>`).join("")}
        <span class="ese-gap"></span>
        <button type="button" data-do="rest" title="${tr("Make it a rest (R)")}">${tr("Rest")}</button>
        <button type="button" data-do="bar" title="${tr("Add a bar of rests at the end")}">${tr("+ Bar")}</button>
        <span class="ese-gap"></span>
        <button type="button" data-do="undo" title="${tr("Undo (Ctrl+Z)")}">${tr("Undo")}</button>
        <button type="button" data-do="redo" title="${tr("Redo (Ctrl+Y)")}">${tr("Redo")}</button>
      </div>
      <div class="ese-sheet"></div>
      <div class="ese-status" aria-live="polite"></div>
      <div class="ese-hint">${tr("Click a note · ↑↓ move (Shift semitone, Ctrl octave) · drag · A–G write · Shift+A–G add to chord · R rest · + − = accidentals · Ctrl+Z undo")}</div>`;
    this.sheet = this.querySelector(".ese-sheet");
    this.status = this.querySelector(".ese-status");

    this.querySelector(".ese-toolbar").addEventListener("click", (event) => this._toolbar(event));
    this.addEventListener("keydown", (event) => this._key(event));
    this.sheet.addEventListener("pointerdown", (event) => this._down(event));
    this.sheet.addEventListener("pointermove", (event) => this._move(event));
    this.sheet.addEventListener("pointerup", (event) => this._up(event));
    this.sheet.addEventListener("pointercancel", () => this._cancelDrag());

    this._observer = new ResizeObserver(() => {
      const width = Math.floor(this.sheet.clientWidth);
      if (width > 0 && Math.abs(width - this._width) >= 8) this._schedule();
    });
    this._observer.observe(this.sheet);
    this._schedule();
  }

  disconnectedCallback() {
    this._observer?.disconnect();
  }

  get source() {
    return this._source ?? "";
  }

  set source(value) {
    const text = String(value);
    if (text === this._source) return;
    this._source = text;
    this._schedule();
  }

  get staffSpace() {
    return parseFloat(this.getAttribute("staff-space")) || 8;
  }

  // ---- Drawing ------------------------------------------------------------

  _schedule() {
    if (this._queued || !this.sheet) return;
    this._queued = true;
    requestAnimationFrame(() => {
      this._queued = false;
      this._draw();
    });
  }

  async _draw(preview) {
    await loaded();
    const width = Math.max(240, Math.floor(this.sheet.clientWidth || 760));
    const source = preview ?? this._source;
    const started = performance.now();
    try {
      this.view = JSON.parse(editor_view(source, width, this.staffSpace, this.selected, this.head));
    } catch (error) {
      this.view = null;
      this.sheet.innerHTML = "";
      this._say(error.message ?? String(error), true);
      this.dispatchEvent(new CustomEvent("refuse", { detail: { message: error.message ?? String(error) } }));
      return;
    }
    this._width = width;
    this.sheet.innerHTML = this.view.svg;
    if (this.selected >= 0 && !this.view.items.some((it) => it.item === this.selected)) {
      this.selected = -1;
      this.head = -1;
    }
    this._buttons();
    this.dispatchEvent(new CustomEvent("render", { detail: { ms: performance.now() - started } }));
  }

  _buttons() {
    const item = this._item();
    const note = item?.kind === "note";
    for (const button of this.querySelectorAll(".ese-toolbar button")) {
      const what = button.dataset.do;
      if (what === "undo") button.disabled = this.past.length === 0;
      else if (what === "redo") button.disabled = this.future.length === 0;
      else if (what === "bar") button.disabled = false;
      else if (button.dataset.letter) button.disabled = !item || item.kind === "bar-rest";
      else button.disabled = !note;
    }
  }

  _say(message, error = false) {
    this.status.textContent = message;
    this.status.classList.toggle("ese-error", error);
  }

  // ---- Selection ----------------------------------------------------------

  _item() {
    return this.view?.items.find((it) => it.item === this.selected) ?? null;
  }

  _select(item, head = -1) {
    this.selected = item;
    this.head = head;
    const it = this._item();
    if (it) {
      const n = item + 1;
      const said = it.kind !== "note"
        ? tr("Item {n}: rest", { n })
        : it.heads.length < 2
          ? tr("Item {n}: note", { n })
          : head >= 0
            ? tr("Item {n}: chord of {heads}, note {head} selected", { n, heads: it.heads.length, head: head + 1 })
            : tr("Item {n}: chord of {heads}", { n, heads: it.heads.length });
      this._say(said);
    } else {
      this._say("");
    }
    this._draw();
  }

  // The SVG's pixels under a pointer.
  _point(event) {
    const svg = this.sheet.querySelector("svg");
    if (!svg || !this.view) return null;
    const rect = svg.getBoundingClientRect();
    const scale = rect.width / this.view.width;
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale, scale };
  }

  _hit(p) {
    const inside = (b, pad) => p.x >= b[0] - pad && p.x <= b[2] + pad && p.y >= b[1] - pad && p.y <= b[3] + pad;
    for (const it of this.view.items) {
      for (const h of it.heads) {
        if (inside(h.box, 2)) return { item: it.item, head: h.index, d: h.d, alter: h.alter };
      }
    }
    let best = null;
    for (const it of this.view.items) {
      if (!inside(it.box, 6)) continue;
      const cx = (it.box[0] + it.box[2]) / 2;
      const dist = Math.abs(cx - p.x);
      if (!best || dist < best.dist) best = { item: it.item, head: -1, dist };
    }
    return best;
  }

  // ---- Pointer --------------------------------------------------------------

  _down(event) {
    this.focus();
    const p = this._point(event);
    if (!p) return;
    const hit = this._hit(p);
    if (!hit) {
      this._select(-1);
      return;
    }
    const item = this.view.items.find((it) => it.item === hit.item);
    const head = hit.head >= 0 ? hit.head : (item?.kind === "note" && item.heads.length === 1 ? 0 : -1);
    this._select(hit.item, item?.heads.length > 1 ? hit.head : -1);
    if (item?.kind === "note" && head >= 0) {
      const h = item.heads.find((x) => x.index === head) ?? item.heads[0];
      this.drag = { y: event.clientY, scale: p.scale, item: hit.item, head, from: [h.d, h.alter], by: 0, preview: null, chromatic: event.shiftKey };
      this.sheet.setPointerCapture(event.pointerId);
    }
  }

  _move(event) {
    if (!this.drag) return;
    const half = (this.staffSpace / 2) * this.drag.scale;
    const by = Math.round((this.drag.y - event.clientY) / half);
    if (by === this.drag.by) return;
    this.drag.by = by;
    this.sheet.classList.add("ese-dragging");
    if (by === 0) {
      this.drag.preview = null;
      this._draw();
      return;
    }
    const source = this._absoluteSource();
    if (source === null) return;
    try {
      this.drag.preview = editor_apply(source, JSON.stringify({ op: "drag", item: this.drag.item, head: this.drag.head, from: this.drag.from, by, chromatic: this.drag.chromatic }));
      this._draw(this.drag.preview);
    } catch (error) {
      this._say(error.message ?? String(error), true);
    }
  }

  _up(event) {
    const drag = this.drag;
    this._cancelDrag();
    if (drag?.preview) this._commit(drag.preview);
  }

  _cancelDrag() {
    this.drag = null;
    this.sheet.classList.remove("ese-dragging");
  }

  // ---- Keyboard -------------------------------------------------------------

  _key(event) {
    if (event.target !== this) return;
    const key = event.key;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && (key === "z" || key === "Z")) return this._stop(event, event.shiftKey ? this.redo() : this.undo());
    if (mod && (key === "y" || key === "Y")) return this._stop(event, this.redo());
    if (!this.view) return;
    const items = this.view.items;
    const index = items.findIndex((it) => it.item === this.selected);
    if (key === "ArrowRight" || key === "ArrowLeft") {
      const next = items[Math.min(items.length - 1, Math.max(0, index + (key === "ArrowRight" ? 1 : -1)))] ?? items[0];
      return this._stop(event, next && this._select(next.item));
    }
    if (key === "Escape") return this._stop(event, this._select(-1));
    if (index < 0) return;
    const item = items[index];
    if ((key === "ArrowUp" || key === "ArrowDown") && event.altKey && item.heads.length > 1) {
      const order = [...item.heads].sort((a, b) => a.d - b.d).map((h) => h.index);
      const at = order.indexOf(this.head);
      const next = at < 0 ? (key === "ArrowUp" ? order.length - 1 : 0) : Math.min(order.length - 1, Math.max(0, at + (key === "ArrowUp" ? 1 : -1)));
      return this._stop(event, this._select(item.item, order[next]));
    }
    if (key === "ArrowUp" || key === "ArrowDown") {
      const how = mod ? "octave" : event.shiftKey ? "semitone" : "step";
      return this._stop(event, this.edit({ op: "move", item: item.item, head: this.head, how, by: key === "ArrowUp" ? 1 : -1 }));
    }
    const letter = LETTERS[key.toLowerCase()];
    if (letter !== undefined && !mod && !event.altKey) {
      return this._stop(event, this.edit({ op: "letter", item: item.item, head: this.head, step: letter, add: event.shiftKey }));
    }
    if (key === "r" || key === "R" || key === "Delete" || key === "Backspace") {
      return this._stop(event, this.edit({ op: "rest", item: item.item, head: this.head }));
    }
    if (key === "+" || key === "-" || key === "=") {
      const head = item.heads.find((h) => h.index === this.head) ?? item.heads[0];
      const alter = key === "=" ? 0 : Math.max(-2, Math.min(2, (head?.alter ?? 0) + (key === "+" ? 1 : -1)));
      return this._stop(event, this.edit({ op: "alter", item: item.item, head: this.head, alter }));
    }
  }

  _stop(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  _toolbar(event) {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    this.focus();
    const item = this._item();
    if (button.dataset.letter) {
      if (item) this.edit({ op: "letter", item: item.item, head: this.head, step: LETTERS[button.dataset.letter], add: event.shiftKey });
      return;
    }
    const head = item?.heads.find((h) => h.index === this.head) ?? item?.heads[0];
    switch (button.dataset.do) {
      case "up": return this.edit({ op: "move", item: item.item, head: this.head, how: "step", by: 1 });
      case "down": return this.edit({ op: "move", item: item.item, head: this.head, how: "step", by: -1 });
      case "sharp": return this.edit({ op: "alter", item: item.item, head: this.head, alter: Math.min(2, (head?.alter ?? 0) + 1) });
      case "flat": return this.edit({ op: "alter", item: item.item, head: this.head, alter: Math.max(-2, (head?.alter ?? 0) - 1) });
      case "natural": return this.edit({ op: "alter", item: item.item, head: this.head, alter: 0 });
      case "rest": return this.edit({ op: "rest", item: item.item, head: this.head });
      case "bar": return this.edit({ op: "append-bar" });
      case "undo": return this.undo();
      case "redo": return this.redo();
    }
  }

  // ---- Edits ------------------------------------------------------------------

  // The source in absolute pitches, written out once; null when it cannot be.
  _absoluteSource() {
    if (this.view?.editable !== "relative") return this._source;
    try {
      return editor_apply(this._source, JSON.stringify({ op: "absolute" }));
    } catch (error) {
      this._say(error.message ?? String(error), true);
      return null;
    }
  }

  /** Applies one edit (see eui-score's editor_apply); false when refused. */
  edit(op) {
    if (!this.view) return false;
    let source = this._absoluteSource();
    if (source === null) return false;
    const converted = source !== this._source;
    try {
      source = editor_apply(source, JSON.stringify(op));
    } catch (error) {
      const message = error.message ?? String(error);
      this._say(message === "relative" ? tr("This source cannot be edited.") : message, true);
      this.dispatchEvent(new CustomEvent("refuse", { detail: { message } }));
      return false;
    }
    this._commit(source);
    if (converted) this._say(tr("Written out in absolute pitches so that its notes can be edited."));
    return true;
  }

  _commit(source) {
    if (source === this._source) return;
    this.past.push(this._source);
    if (this.past.length > 200) this.past.shift();
    this.future = [];
    this._source = source;
    this._changed();
  }

  undo() {
    if (this.past.length === 0) return false;
    this.future.push(this._source);
    this._source = this.past.pop();
    this._changed();
    return true;
  }

  redo() {
    if (this.future.length === 0) return false;
    this.past.push(this._source);
    this._source = this.future.pop();
    this._changed();
    return true;
  }

  _changed() {
    this.status.classList.remove("ese-error");
    this._draw();
    this.dispatchEvent(new CustomEvent("change", { detail: { source: this._source } }));
  }
}

if (!customElements.get("eui-score-editor")) customElements.define("eui-score-editor", EuiScoreEditor);
