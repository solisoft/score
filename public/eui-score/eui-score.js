// eui-score for any web page: LilyPond engraved to SVG in the browser.
//
//   <script type="module" src="https://score.solisoft.net/eui-score/eui-score.js"></script>
//
//   <eui-score>
//     <script type="text/x-lilypond">
//       \relative c' { \key g \major \time 3/4 g'4( a b) | d2. \bar "|." }
//     </script>
//   </eui-score>
//
// The engraver is EUI's own (the `eui-score` crate) compiled to
// WebAssembly: ~200 KB gzipped, fetched once, beside this file. Nothing is
// sent anywhere — the page engraves, writes the MIDI and the PDF itself.
//
// The source goes in a <script type="text/x-lilypond"> because LilyPond is
// full of < and >: as plain text inside an element, the browser would read
// `<c e g>` as a tag. A source with no angle brackets may also be the
// element's own text, and `src="piece.ly"` fetches one.
//
// The module API, for pages that want the SVG as a string:
//
//   import { render, toMidi, toPdf, check } from ".../eui-score.js";
//   const svg = await render(src, { width: 640, staffSpace: 7 });

// The files are served immutable, for a year. The engraver's own version,
// written here by wasm/build.sh, is what the binding and the WebAssembly are
// asked for by: a new engraver is never taken from the cache of an old one,
// whatever address loaded this module, and it changes this file — and so
// this file's address — too.
const WASM = "96cb8f8e949d2032";
const V = `?v=${WASM}`;

/** The WebAssembly binding itself: every function the module exports. */
export const engine = await import(`./eui_score_web.js${V}`);

const ready = engine.default({ module_or_path: new URL(`./eui_score_web_bg.wasm${V}`, import.meta.url) });
const { svg: engraveSvg, midi: engraveMidi, pdf: engravePdf, check: engraveCheck } = engine;

/** Resolves once the engraver is loaded. */
export function loaded() {
  return ready;
}

/**
 * The score as an SVG string. Options: `width` (px, default 760),
 * `staffSpace` (px between two staff lines, default 7), `marks` (an item's
 * number among the notes and rests → a CSS colour). Rejects with the
 * engraver's refusal, "score: … (at character N)".
 */
export async function render(src, options = {}) {
  await ready;
  return engraveSvg(src, options.width ?? 760, options.staffSpace ?? 7, JSON.stringify(options.marks ?? {}));
}

/**
 * The source as a Standard MIDI File, a Uint8Array, played as it sounds:
 * every repeat played out, its endings in turn, and the D.S. and D.C.
 * taken — for a source the editor's model reads; another is played as
 * written. Options: `bpm` and `beat` for a source that sets no tempo (100
 * a quarter, as the editor plays it), `program` for a staff with no
 * instrument, `unfold: false` for a source already played out.
 */
export async function toMidi(src, options = {}) {
  await ready;
  const played = options.unfold === false ? src : await playedOut(src);
  return engraveMidi(played, options.bpm ?? 100, options.beat ?? 4, options.program ?? 0);
}

// The editor's model plays the repeats out; it is fetched only for a source that has some.
async function playedOut(src) {
  if (!/\\(repeat|jump)\b/.test(src)) return src;
  try {
    // Under this module's own version, which covers the model's file too.
    const model = await import(`./score-model.js${new URL(import.meta.url).search}`);
    return model.playedSource(src, engine.score_json);
  } catch {
    return src;
  }
}

/** The source as a PDF string, on the paper its \paper sets (A4 when none); `title` for a source whose header names none. */
export async function toPdf(src, title = "") {
  await ready;
  return engravePdf(src, title);
}

/** The engraver's refusal of `src`, or "" when it can set it. */
export async function check(src) {
  await ready;
  return engraveCheck(src);
}

/** Saves bytes or a string as a file, through a temporary link. */
export function download(data, fileName, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: fileName });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const STYLE = `
  eui-score { display: block; color: inherit; }
  eui-score > svg { display: block; max-width: 100%; height: auto; }
  eui-score > .eui-score-error { font: 13px/1.5 ui-monospace, monospace; color: #8b2b2c; margin: 0; white-space: pre-wrap; }
`;

/**
 * <eui-score>: engraves its source at its own width, again when it is
 * resized. Attributes: `src` (a .ly file to fetch), `staff-space` (px,
 * default 7), `width` (px; default: the element's width). Property
 * `source` reads and replaces the LilyPond; the element fires `render`
 * after each engraving (detail: `width`, and `ms` it took) and `refuse`
 * (detail: the message) on a refusal.
 */
class EuiScore extends HTMLElement {
  static get observedAttributes() {
    return ["src", "staff-space", "width"];
  }

  constructor() {
    super();
    this._source = null;
    this._width = 0;
    this._queued = false;
  }

  connectedCallback() {
    if (!document.getElementById("eui-score-style")) {
      const style = Object.assign(document.createElement("style"), { id: "eui-score-style", textContent: STYLE });
      document.head.appendChild(style);
    }
    if (this._source === null && !this.hasAttribute("src")) {
      const script = this.querySelector('script[type="text/x-lilypond"], script[type="text/lilypond"]');
      this._source = (script ? script.textContent : this.textContent).trim();
    }
    this._observer = new ResizeObserver(() => {
      const width = this._targetWidth();
      if (Math.abs(width - this._width) >= 8) this._schedule();
    });
    this._observer.observe(this);
    if (this.hasAttribute("src")) this._fetch();
    else this._schedule();
  }

  disconnectedCallback() {
    this._observer?.disconnect();
  }

  attributeChangedCallback(name, before, after) {
    if (before === after || !this.isConnected) return;
    if (name === "src") this._fetch();
    else this._schedule();
  }

  get source() {
    return this._source ?? "";
  }

  set source(value) {
    this._source = String(value);
    this._schedule();
  }

  _targetWidth() {
    const fixed = parseFloat(this.getAttribute("width"));
    return fixed > 0 ? fixed : Math.max(200, Math.floor(this.clientWidth || this.parentElement?.clientWidth || 760));
  }

  async _fetch() {
    try {
      const response = await fetch(new URL(this.getAttribute("src"), document.baseURI));
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      this._source = await response.text();
      this._schedule();
    } catch (error) {
      this._show(`eui-score: ${this.getAttribute("src")} could not be read (${error.message})`);
    }
  }

  // One engraving per frame, however many changes asked for it.
  _schedule() {
    if (this._queued) return;
    this._queued = true;
    requestAnimationFrame(() => {
      this._queued = false;
      this._engrave();
    });
  }

  async _engrave() {
    if (this._source === null) return;
    const width = this._targetWidth();
    const staffSpace = parseFloat(this.getAttribute("staff-space")) || 7;
    try {
      const started = performance.now();
      const markup = await render(this._source, { width, staffSpace });
      const ms = performance.now() - started;
      this._width = width;
      this.innerHTML = markup;
      this.dispatchEvent(new CustomEvent("render", { detail: { width, ms } }));
    } catch (error) {
      const message = error?.message ?? String(error);
      this._show(message);
      this.dispatchEvent(new CustomEvent("refuse", { detail: message }));
    }
  }

  _show(message) {
    const line = Object.assign(document.createElement("p"), { className: "eui-score-error", textContent: message });
    this.replaceChildren(line);
  }
}

if (!customElements.get("eui-score")) customElements.define("eui-score", EuiScore);
