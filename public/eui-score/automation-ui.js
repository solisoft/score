// The automation lane under the MIDI view, below the velocity strip: one
// staff's curve of one controller at a time, chosen in its bar; and the
// knobs, the pedal and the bend of the MIDI keyboard, kept while recording.
// The curves and how they are played are automation.js's.
//
//   const lane = automationLane({ rollHost, rollScroll, st, edit, say, redraw, recordingNow, learnt });
//   lane.html();     // the lane, as HTML, drawn after the velocity strip
//
// A click on the lane adds a point (on a 32nd grid; Alt, anywhere) and a
// drag moves it; a point dragged moves; a double click, or a right click,
// takes one away.

const SEARCH = new URL(import.meta.url).search;
const M = await import(`./score-model.js${SEARCH}`);
const R = await import(`./piano-roll.js${SEARCH}`);
const A = await import(`./automation.js${SEARCH}`);
const P = await import(`./player.js${SEARCH}`);

/**
 * `st` is the studio's state; `edit(fn)` makes one undoable edit;
 * `redraw()` draws the roll again; `recordingNow(stamp)` is the tick heard
 * when a message came, while recording (null otherwise); `learnt()` the
 * MIDI-learn controls (midi-sync.js), whose knobs are not recorded.
 */
export function automationLane({ rollHost, rollScroll, st, edit, say, redraw, recordingNow, learnt = () => [] }) {
  st.cc = { lane: null, id: "1", chosen: -1, drag: null };
  const bar = Object.assign(document.createElement("div"), { className: "studio-cc-bar" });
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Automation");
  const options = A.CONTROLLERS.map((c) => `<option value="${c.id}">${c.name}${c.number != null ? ` (CC ${c.number})` : ""}</option>`).join("");
  bar.innerHTML = `<span class="studio-velocity-what">Automation</span><label class="studio-cc-field">Staff <select data-cc-lane aria-label="The staff whose curve is drawn"></select></label><label class="studio-cc-field">Curve <select data-cc-id aria-label="The controller drawn">${options}</select></label><button type="button" class="studio-menu" data-cc-clear>Clear the curve</button><span class="studio-roll-hint">Click to add a point, drag one to move it, double-click to take it away; Alt places it off the grid.</span>`;
  rollHost.append(bar);
  const laneBox = bar.querySelector("[data-cc-lane]");
  const idBox = bar.querySelector("[data-cc-id]");

  /** The staves a curve can be drawn for: [{ lane, name }]. */
  const staves = () => (st.score ? M.channels(st.score) : []);

  /** The staff drawn: the one chosen, else the one the roll shows alone or the selection is in. */
  function laneNow() {
    const list = staves();
    if (!list.length) return null;
    const lanes = list.map((c) => c.lane);
    if (st.cc.lane != null && lanes.includes(st.cc.lane)) return st.cc.lane;
    const hint = st.rollLayout === "keys" && st.rollOnly != null ? st.rollOnly : (st.sel?.staff ?? 0);
    const upper = M.upperOf(st.score, Math.min(hint, st.score.staves.length - 1));
    return lanes.includes(upper) ? upper : lanes[0];
  }

  function geo() {
    return R.rollLayout(st.score, { layout: st.rollLayout, zoom: st.zoom, only: st.rollLayout === "keys" ? st.rollOnly : null });
  }

  const points = () => (st.cc.drag ? (st.cc.drag.view ?? st.cc.drag.points) : A.curveOf(st.score, laneNow(), st.cc.id));

  /** The lane as HTML, under the velocity strip. */
  function html() {
    if (!st.score) return "";
    const lane = laneNow();
    const list = staves();
    const key = JSON.stringify(list.map((c) => [c.lane, c.name]));
    if (laneBox.dataset.key !== key) {
      laneBox.dataset.key = key;
      laneBox.innerHTML = list.map((c) => `<option value="${c.lane}">${c.name.replace(/[&<>"]/g, "")}</option>`).join("");
    }
    if (lane != null) laneBox.value = String(lane);
    idBox.value = st.cc.id;
    if (lane == null) return "";
    const name = list.find((c) => c.lane === lane)?.name ?? "";
    const muted = st.cc.id === "64" && A.notatedPedal(st.score, lane) ? "This staff's pedal marks (\\sustainOn) play: this curve is not heard." : "";
    st.cc.geo = geo();
    return `<div class="studio-cc">${A.drawLane(st.score, st.cc.geo, st.cc.id, points(), { label: name, colour: R.laneColour(st.score, lane), chosen: st.cc.chosen, muted })}</div>`;
  }

  function commit(next, words) {
    const lane = laneNow();
    const id = st.cc.id;
    if (edit((score) => A.setCurve(score, lane, id, next))) say(`${words} — Ctrl+Z takes it back.`);
  }

  function at(event) {
    const box = rollScroll.querySelector(".cc-strip").getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function removeAt(event) {
    const p = at(event);
    const list = A.curveOf(st.score, laneNow(), st.cc.id);
    const k = A.pointAt(st.cc.geo, st.cc.id, list, p.x, p.y);
    if (k < 0) return false;
    st.cc.chosen = -1;
    commit(A.withoutPoint(st.cc.id, list, k), "Point taken away");
    return true;
  }

  rollHost.addEventListener("pointerdown", (event) => {
    if (!event.target.closest?.(".cc-strip") || !st.score || event.button === 2) return;
    rollHost.focus({ preventScroll: true });
    const p = at(event);
    const id = st.cc.id;
    const list = A.curveOf(st.score, laneNow(), id);
    let k = A.pointAt(st.cc.geo, id, list, p.x, p.y);
    let start = list;
    if (k < 0) {
      // A new point, dragged from where it is put.
      const tick = A.tickOfX(st.cc.geo, p.x, event.altKey ? 1 : M.WHOLE / 32);
      start = A.withPoint(id, list, tick, A.valueOfY(id, p.y));
      k = start.findIndex(([t]) => t === tick);
    }
    st.cc.chosen = k;
    st.cc.drag = { points: start, index: k, view: null };
    rollHost.setPointerCapture?.(event.pointerId);
    redraw();
  });

  rollHost.addEventListener("pointermove", (event) => {
    const d = st.cc.drag;
    if (!d) return;
    const p = at(event);
    const id = st.cc.id;
    const tick = A.tickOfX(st.cc.geo, p.x, event.altKey ? 1 : M.WHOLE / 32);
    const value = A.valueOfY(id, p.y);
    d.view = A.movePoint(id, d.points, d.index, tick, value);
    st.cc.chosen = d.view.findIndex(([t]) => t === tick);
    redraw();
  });

  const end = () => {
    const d = st.cc.drag;
    if (!d) return;
    st.cc.drag = null;
    const next = d.view ?? d.points;
    const was = A.curveOf(st.score, laneNow(), st.cc.id);
    if (JSON.stringify(next) === JSON.stringify(was)) return redraw();
    const point = next[Math.max(0, st.cc.chosen)];
    commit(next, `${A.controller(st.cc.id).name}${point ? `: ${A.valueText(st.cc.id, point[1])}` : ""}`);
  };
  rollHost.addEventListener("pointerup", end);
  rollHost.addEventListener("pointercancel", end);

  rollHost.addEventListener("dblclick", (event) => {
    if (event.target.closest?.(".cc-strip") && st.score) removeAt(event);
  });
  rollHost.addEventListener("contextmenu", (event) => {
    if (!event.target.closest?.(".cc-strip") || !st.score) return;
    if (removeAt(event)) event.preventDefault();
  });

  laneBox.addEventListener("change", () => {
    st.cc.lane = Number(laneBox.value);
    st.cc.chosen = -1;
    redraw();
  });
  idBox.addEventListener("change", () => {
    st.cc.id = idBox.value;
    st.cc.chosen = -1;
    redraw();
  });
  bar.querySelector("[data-cc-clear]").addEventListener("click", () => {
    if (!st.score || !A.curveOf(st.score, laneNow(), st.cc.id).length) return say("This curve has no point.");
    st.cc.chosen = -1;
    commit([], `${A.controller(st.cc.id).name} cleared`);
  });

  // ---- Recording ---------------------------------------------------------------------
  //
  // While recording, the keyboard's modulation wheel, expression, volume,
  // pan, sustain pedal and pitch bend are kept with the tick heard, for the
  // staff recorded into (finishRecording writes them with `A.writeRecorded`).
  // A knob learnt for a command (MIDI learn) is a command, not recorded.
  // The knobs are sounded live too (the bend already is, by midi-sync.js).

  const unhear = P.overhear?.((data, stamp) => {
    const rec = st.recording;
    if (!rec) return;
    const kind = data[0] & 0xf0;
    let id = null;
    let value = 0;
    if (kind === 0xe0) {
      id = "bend";
      value = ((data[2] << 7) | data[1]) - 8192;
    } else if (kind === 0xd0) {
      id = "pressure";
      value = data[1];
    } else if (kind === 0xb0) {
      id = A.idOfNumber(data[1]);
      value = data[2];
      if (!id || learnt().some(({ control }) => control.kind === "cc" && control.number === data[1] && control.channel === (data[0] & 15))) return;
      P.express?.(data);
    }
    if (!id) return;
    const tick = recordingNow(stamp);
    if (tick == null) return;
    rec.cc ??= {};
    (rec.cc[id] ??= []).push([Math.round(tick), value]);
  });

  return { html, stop: () => unhear?.() };
}
