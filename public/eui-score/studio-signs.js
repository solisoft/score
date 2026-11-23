// The studio's signs moved by hand (studio.js, #1020): a dynamic, a hairpin,
// an articulation, a fingering, words, a slur, a phrasing slur or a tie is
// selected by a press on it, then dragged — or nudged, Alt+arrows — to where
// it reads best; a curve's four control points and a hairpin's two ends are
// handles of their own. What is moved is written as LilyPond writes it
// (score-model.js, setSignTweak): `-\tweak Grob.extra-offset`, `-\shape`,
// `shorten-pair`, to a tenth of a staff space.
//
// The engraver says where each sign is (`st.view.signs`, wasm/src/editor.rs)
// and moves it by the tweak of its grob: two signs of one grob on a note —
// an accent and a staccato, two texts — move together, so one of them takes
// the drag and the other says so.

// The editor's words in the page's language (#508).
const V = new URL(import.meta.url).search;
const { tr } = await import(`./words.js${V}`);

/** A press becomes a drag once the pointer has gone this far, in pixels: a double press still opens a word. */
const DRAG_FROM = 4;
/** Nudges closer together than this are one step to undo, in milliseconds. */
const NUDGE_ONE_STEP = 1000;
const CURVES = ["slur", "phrase", "tie"];

/** Answers the signs' selection, their drag and their handles. */
export function install(ctx) {
  const { sheet, st, M } = ctx;
  const { snapshot, writeText, saveDraft, draw, say, edit, placeOverlay } = ctx.call;

  /** What a sign is called, in the status line. */
  const NAMES = () => ({
    dynamic: tr("The dynamic"), hairpin: tr("The hairpin"), script: tr("The articulation"), finger: tr("The fingering"),
    text: tr("The text"), slur: tr("The slur"), phrase: tr("The phrasing slur"), tie: tr("The tie"),
  });

  // ---- Which sign --------------------------------------------------------------

  /** The note a drawn sign is written on: { staff, index, t, ev }, or null. */
  function noteOf(sign) {
    const at = st.items[sign.item];
    const staff = at && st.score?.staves[at.staff];
    const ev = staff?.events[at.index];
    return ev ? { staff: at.staff, index: at.index, t: M.starts(staff)[at.index], ev } : null;
  }

  /** Whether a drawn sign can be moved: one a tweak is written before, on a note of the model that has it. */
  const movable = (sign) => Boolean(sign.on) && M.hasSign(noteOf(sign)?.ev, sign.on);

  /**
   * The sign that takes the drag for `sign`: itself, or — two signs of one
   * grob on a note, which the engraver moves together — the one already
   * moved, else the first drawn.
   */
  function taker(sign) {
    const note = noteOf(sign);
    const group = (st.view?.signs ?? []).filter((other) => other.item === sign.item && other.grob === sign.grob && movable(other));
    const set = group.find((other) => M.signIsSet(note?.ev, other.on));
    return (set ?? group[0])?.on ?? sign.on;
  }

  /** The selected sign as it is now drawn (its piece, on its note), or null when it is gone. */
  function current() {
    const sel = st.sign;
    if (!sel || !st.score || !st.view) return null;
    return (st.view.signs ?? []).find((sign) => {
      const note = noteOf(sign);
      return note && sign.on === sel.on && sign.piece === sel.piece && note.staff === sel.staff && note.t === sel.t && movable(sign);
    }) ?? null;
  }

  /** A point of a curve drawn through its four control points. */
  function bezier(points, t) {
    const u = 1 - t;
    const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return [0, 1].map((axis) => points.reduce((sum, point, k) => sum + w[k] * point[axis], 0));
  }

  /** How far a point of the drawing is from a sign: from its curve, or from its box (0 inside). */
  function away(sign, p) {
    if (CURVES.includes(sign.kind) && sign.handles?.length === 4) {
      let best = Infinity;
      for (let k = 0; k <= 24; k++) {
        const [x, y] = bezier(sign.handles, k / 24);
        best = Math.min(best, Math.hypot(p.x - x, p.y - y));
      }
      return best;
    }
    const [x0, y0, x1, y1] = sign.box;
    return Math.hypot(Math.max(x0 - p.x, 0, p.x - x1), Math.max(y0 - p.y, 0, p.y - y1));
  }

  /** The sign under a point of the drawing, within `reach` pixels of the screen — never through a notehead. */
  function signHit(p, reach = 3) {
    if (!st.score || !st.view?.signs?.length) return null;
    const onHead = st.view.items.some((it) => it.heads.some(({ box }) => p.x >= box[0] && p.x <= box[2] && p.y >= box[1] && p.y <= box[3]));
    if (onHead) return null;
    let best = null;
    for (const sign of st.view.signs) {
      if (!movable(sign)) continue;
      const d = away(sign, p);
      if (d <= reach / p.scale && (!best || d < best.d)) best = { sign, d };
    }
    return best?.sign ?? null;
  }

  /** The handle of the selected sign under a point: its number (a curve's 0–3, a hairpin's 0 or 1), or -1. */
  function handleHit(sign, p, reach) {
    let best = -1;
    let least = reach / p.scale;
    (sign.handles ?? []).forEach((point, k) => {
      const d = point ? Math.hypot(p.x - point[0], p.y - point[1]) : Infinity;
      if (d <= least) [best, least] = [k, d];
    });
    return best;
  }

  // ---- Selecting ---------------------------------------------------------------

  /** `sign` selected: its box drawn, the notes let go, what can be done with it said. */
  function selectSign(sign) {
    const note = noteOf(sign);
    if (!note) return;
    const lit = Boolean(st.sel);
    st.sign = { staff: note.staff, t: note.t, on: sign.on, piece: sign.piece, kind: sign.kind };
    st.sel = null;
    const name = NAMES()[sign.kind];
    if (taker(sign) !== sign.on) say(tr("{sign} moves with the other sign of its kind on this note: drag that one.", { sign: name }));
    else if (sign.handles) say(tr("{sign}: drag it, or one of its handles; Alt+arrows nudge it, Backspace puts it back.", { sign: name }));
    else say(tr("{sign}: drag it, or nudge it with Alt+arrows; Backspace puts it back.", { sign: name }));
    if (lit) draw();
    else placeOverlay();
  }

  /** No sign selected any more; whether one was. */
  function dropSign() {
    const had = Boolean(st.sign);
    st.sign = null;
    return had;
  }

  // ---- Dragging ----------------------------------------------------------------

  /** The drag's next frame, when one is asked for. */
  let frame = 0;

  /**
   * A press on the score at `p`: on a sign, it is selected and may be
   * dragged — with a mouse or a pen at once, with a finger once it is
   * selected (a finger elsewhere scrolls the score, #454). Answers whether
   * the press was a sign's; if not, no sign is selected any more. At written
   * pitch too (#1023): a sign is on the same note there, and its tweak does
   * not move with the pitch.
   */
  function signPress(event, p) {
    if (!st.score || st.playing) {
      dropSign();
      return false;
    }
    const touch = event.pointerType === "touch";
    const now = current();
    // The selected sign first: a handle of it, then itself — a finger is wider than a pointer.
    const k = now && taker(now) === now.on ? handleHit(now, p, touch ? 18 : 8) : -1;
    const again = now && (k >= 0 || away(now, p) <= (touch ? 12 : 3) / p.scale) ? now : null;
    const sign = again ?? signHit(p, touch ? 8 : 3);
    if (!sign) {
      if (dropSign()) placeOverlay();
      return false;
    }
    const note = noteOf(sign);
    const blocked = taker(sign) !== sign.on;
    const set = M.signTweak(note.ev, sign.on);
    st.signDrag = {
      sign, staff: note.staff, index: note.index, on: sign.on, piece: sign.piece,
      mode: k < 0 ? "move" : sign.kind === "hairpin" ? "end" : "handle", k,
      x: event.clientX, y: event.clientY, cx: event.clientX, cy: event.clientY, scale: p.scale,
      // A finger selects first: only the sign already selected is dragged.
      still: blocked || (touch && !again), tap: touch && !again, set, base: null, text: st.text, shift: event.shiftKey, going: false,
    };
    if (!touch && !again) selectSign(sign);
    sheet.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return true;
  }

  /** The pointer moved with a sign taken: past a few pixels it is a drag, drawn once a frame. */
  function signMove(event) {
    const drag = st.signDrag;
    if (!drag) return;
    Object.assign(drag, { cx: event.clientX, cy: event.clientY, shift: event.shiftKey });
    if (!drag.going) {
      if (drag.still || Math.hypot(drag.cx - drag.x, drag.cy - drag.y) < DRAG_FROM) return;
      drag.going = true;
      drag.base = snapshot();
      sheet.classList.add("studio-sign-dragging");
    }
    frame ||= requestAnimationFrame(dragFrame);
  }

  /** The sign where the pointer has taken it: written from the score as it was at the press, and drawn. */
  function dragFrame(ending = null) {
    frame = 0;
    const drag = ending?.going ? ending : st.signDrag;
    if (!drag?.going) return;
    // Pixels of the screen to staff spaces: 8 a space at zoom 1, and the drawing's own scale.
    const space = 8 * st.zoom * drag.scale;
    let [dx, dy] = [(drag.cx - drag.x) / space, (drag.cy - drag.y) / space];
    // Shift: along one axis only, the one the pointer went further on.
    if (drag.shift) [dx, dy] = Math.abs(dx) >= Math.abs(dy) ? [dx, 0] : [0, dy];
    const { offset, shorten, shape } = drag.set;
    let next;
    if (drag.mode === "move") next = { offset: [offset[0] + dx, offset[1] - dy] };
    else if (drag.mode === "end") next = { shorten: drag.k === 0 ? [shorten[0] + dx, shorten[1]] : [shorten[0], shorten[1] - dx] };
    else {
      // The piece's four points as they were, this one moved; the pieces before it written too.
      const pieces = Array.from({ length: Math.max(shape.length, drag.piece + 1) }, (_, n) => (shape[n] ?? [[0, 0], [0, 0], [0, 0], [0, 0]]).map((point) => [...point]));
      const point = pieces[drag.piece][drag.k];
      pieces[drag.piece][drag.k] = [point[0] + dx, point[1] - dy];
      next = { shape: pieces };
    }
    const from = JSON.parse(drag.base).score;
    try {
      M.setSignTweak(from, drag.staff, drag.index, drag.on, next);
    } catch (error) {
      return;
    }
    const was = st.text;
    st.score = from;
    writeText();
    if (st.text !== was) draw();
  }

  /** The press is over: a drag is one step to undo; a press that never moved selected the sign. */
  function signEnd({ cancelled = false } = {}) {
    const drag = st.signDrag;
    if (!drag) return;
    st.signDrag = null;
    // Where the pointer was let go, not where the last frame drew it.
    if (frame) {
      cancelAnimationFrame(frame);
      dragFrame(drag);
    }
    sheet.classList.remove("studio-sign-dragging");
    if (!drag.going) {
      // A finger's tap selects; a scroll the browser took over selects nothing.
      if (drag.tap && !cancelled) selectSign(drag.sign);
      return;
    }
    if (st.text === drag.text) return draw();
    st.past.push(drag.base);
    st.future = [];
    saveDraft();
    const ev = st.score.staves[drag.staff]?.events[drag.index];
    const { offset } = M.signTweak(ev, drag.on);
    const name = NAMES()[drag.sign.kind];
    if (drag.mode === "move") say(tr("{sign} moved: {x} to the right, {y} up, in staff spaces. Backspace puts it back.", { sign: name, x: offset[0], y: offset[1] }));
    else if (drag.mode === "end") say(tr("{sign} drawn shorter or longer: it sounds as long as before. Backspace puts it back.", { sign: name }));
    else say(tr("{sign} reshaped. Backspace puts it back.", { sign: name }));
    draw();
  }

  // ---- Nudging, and back to where the engraver puts it ---------------------------

  /** The last nudge: which sign, when, and the step it made. */
  let nudged = null;

  /** The selected sign able to be moved, or null — said why not. */
  function toMove() {
    const sign = current();
    if (!sign) return null;
    if (taker(sign) !== sign.on) {
      say(tr("{sign} moves with the other sign of its kind on this note: drag that one.", { sign: NAMES()[sign.kind] }));
      return null;
    }
    return { sign, ...noteOf(sign) };
  }

  /** The selected sign a tenth of a staff space further: `dx` to the right, `dy` up. Nudges in a row are one step to undo. */
  function signNudge(dx, dy) {
    const on = toMove();
    if (!on) return false;
    const { offset } = M.signTweak(on.ev, on.sign.on);
    const next = { offset: [offset[0] + dx * M.SIGN_STEP, offset[1] + dy * M.SIGN_STEP] };
    const key = `${on.staff}:${on.t}:${on.sign.on}`;
    const now = performance.now();
    const more = nudged && nudged.key === key && now - nudged.at < NUDGE_ONE_STEP && st.past.at(-1) === nudged.step && st.text === nudged.text;
    if (more) {
      M.setSignTweak(st.score, on.staff, on.index, on.sign.on, next);
      writeText();
      saveDraft();
      draw();
    } else if (edit((score) => M.setSignTweak(score, on.staff, on.index, on.sign.on, next)) !== true) return false;
    nudged = { key, at: now, step: st.past.at(-1), text: st.text };
    return true;
  }

  /** The selected sign back where the engraver puts it, as it draws it. */
  function signReset() {
    const on = toMove();
    if (!on) return false;
    const name = NAMES()[on.sign.kind];
    if (!M.signIsSet(on.ev, on.sign.on)) return say(tr("{sign} is where the engraver puts it.", { sign: name }));
    nudged = null;
    if (edit((score) => M.resetSign(score, on.staff, on.index, on.sign.on)) === true) say(tr("{sign} is back where the engraver puts it.", { sign: name }));
    return true;
  }

  // ---- Over the drawing ----------------------------------------------------------

  /** The selected sign's dashed box, its handles and its way back, over the drawing (placeOverlay's `add`). */
  function placeSign(g, add) {
    // A note selected since: the sign is no longer.
    if (st.sel || st.input.on) st.sign = null;
    const sign = current();
    if (!sign) {
      if (!st.signDrag) st.sign = null;
      return;
    }
    const pad = 3 / g.scale;
    const [x0, y0, x1, y1] = sign.box;
    const mine = taker(sign) === sign.on;
    const box = add(`studio-sign-box${mine ? "" : " studio-sign-held"}`, x0 - pad, y0 - pad, x1 + pad, y1 + pad);
    box.dataset.sign = sign.on;
    box.dataset.kind = sign.kind;
    if (!mine) return;
    const half = 5 / g.scale;
    (sign.handles ?? []).forEach((point, k) => {
      if (!point) return;
      const title = sign.kind === "hairpin" ? tr("Drag: this end of the hairpin") : tr("Drag: this point of the curve");
      const handle = add(`studio-sign-handle${sign.kind === "hairpin" ? " studio-sign-end" : ""}`, point[0] - half, point[1] - half, point[0] + half, point[1] + half, { title });
      handle.dataset.handle = String(k);
    });
    if (st.signDrag?.going || !M.signIsSet(noteOf(sign)?.ev, sign.on)) return;
    // The way back, past the sign and its handles on the side away from its note: never over the notes.
    const ys = [y0, y1, ...(sign.handles ?? []).filter(Boolean).map((point) => point[1])];
    const note = st.view.items.find((it) => it.item === sign.item)?.box;
    const above = note ? (y0 + y1) / 2 < (note[1] + note[3]) / 2 : false;
    const edge = above ? Math.min(...ys) - pad : Math.max(...ys) + pad;
    const back = add(`studio-sign-back${above ? " studio-sign-back-above" : ""}`, x0 - pad, edge, x1 + pad, edge + 1 / g.scale);
    back.innerHTML = `<button type="button" data-act="sign-reset" title="${tr("Back where the engraver puts it (Backspace)")}">${tr("Automatic position")}</button>`;
    // A press on it is not a press on the score under it.
    back.firstChild.addEventListener("pointerdown", (event) => event.stopPropagation());
  }

  ctx.ends.push(() => frame && cancelAnimationFrame(frame));

  return { signPress, signMove, signEnd, signNudge, signReset, placeSign, dropSign, signSelected: () => Boolean(current()) };
}
