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
//
// Its Curve menu offers the usual controllers, then any other by its
// number (CC 0–127, #670), then "Keyswitches and programs": the Sound lane
// (sound-ui.js) in its place, for a virtual instrument.

const SEARCH = new URL(import.meta.url).search;
const M = await import(`./score-model.js${SEARCH}`);
const R = await import(`./piano-roll.js${SEARCH}`);
const A = await import(`./automation.js${SEARCH}`);
const P = await import(`./player.js${SEARCH}`);
const { soundLane } = await import(`./sound-ui.js${SEARCH}`);
// The lane's words in the page's language (#508).
const { tr } = await import(`./words.js${SEARCH}`);

/**
 * `st` is the studio's state; `edit(fn)` makes one undoable edit;
 * `redraw()` draws the roll again; `recordingNow(stamp)` is the tick heard
 * when a message came, while recording (null otherwise); `learnt()` the
 * MIDI-learn controls (midi-sync.js), whose knobs are not recorded.
 */
export function automationLane({ root = null, rollHost, rollScroll, st, edit, say, redraw, recordingNow, learnt = () => [] }) {
  st.cc = { lane: null, id: "1", chosen: -1, drag: null };
  const bar = Object.assign(document.createElement("div"), { className: "studio-cc-bar" });
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", tr("Automation"));
  bar.innerHTML = `<span class="studio-velocity-what">${tr("Automation")}</span><label class="studio-cc-field">${tr("Staff")} <select data-cc-lane aria-label="${tr("The staff whose curve is drawn")}"></select></label><label class="studio-cc-field">${tr("Curve")} <select data-cc-id aria-label="${tr("The controller drawn")}"></select></label><label class="studio-cc-field" data-cc-other hidden>CC <input type="number" min="1" max="119" step="1" value="21" data-cc-number aria-label="${tr("The controller's number, 1 to 119")}"></label><button type="button" class="studio-menu" data-cc-clear>${tr("Clear the curve")}</button><span class="studio-roll-hint" data-cc-hint>${tr("Click to add a point, drag one to move it, double-click to take it away; Alt places it off the grid.")}</span>`;
  rollHost.append(bar);
  const laneBox = bar.querySelector("[data-cc-lane]");
  const idBox = bar.querySelector("[data-cc-id]");
  const otherBox = bar.querySelector("[data-cc-other]");
  const numberBox = bar.querySelector("[data-cc-number]");
  // Keyswitches and program changes (#670): the Sound lane, in the curve's place.
  const sound = soundLane({ root: root ?? rollHost, rollHost, rollScroll, st, edit, say, redraw, laneNow: () => laneNow() });

  /** The Curve menu: the usual controllers, the lane's others, another, the Sound lane. */
  function curveOptions(lane) {
    const ids = A.CONTROLLERS.map((c) => c.id);
    const more = Object.keys(A.curvesOf(st.score)[lane] ?? {}).filter((id) => !ids.includes(id));
    if (A.controller(st.cc.id) && !ids.includes(st.cc.id) && !more.includes(st.cc.id)) more.push(st.cc.id);
    more.sort((a, b) => Number(a) - Number(b));
    const option = (id) => {
      const c = A.controller(id);
      return `<option value="${c.id}">${A.controllerName(c.id)}${c.number != null && c.name ? ` (CC ${c.number})` : ""}</option>`;
    };
    return [...ids, ...more].map(option).join("") + `<option value="other">${tr("Another controller…")}</option><option value="sound">${tr("Keyswitches and programs")}</option>`;
  }

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
    const menu = curveOptions(lane);
    if (idBox.dataset.key !== menu) {
      idBox.dataset.key = menu;
      idBox.innerHTML = menu;
    }
    if (otherBox.hidden) idBox.value = st.cc.id;
    const isSound = st.cc.id === "sound";
    bar.querySelector("[data-cc-clear]").hidden = isSound;
    bar.querySelector("[data-cc-hint]").hidden = isSound;
    sound.show(isSound);
    if (lane == null) return "";
    const name = list.find((c) => c.lane === lane)?.name ?? "";
    if (isSound) {
      st.cc.geo = geo();
      return `<div class="studio-cc">${sound.html(lane, { label: name, colour: R.laneColour(st.score, lane), geo: st.cc.geo })}</div>`;
    }
    const muted = st.cc.id === "64" && A.notatedPedal(st.score, lane) ? tr("This staff's pedal marks (\\sustainOn) play: this curve is not heard.") : "";
    st.cc.geo = geo();
    return `<div class="studio-cc">${A.drawLane(st.score, st.cc.geo, st.cc.id, points(), { label: name, colour: R.laneColour(st.score, lane), chosen: st.cc.chosen, muted })}</div>`;
  }

  function commit(next, words) {
    const lane = laneNow();
    const id = st.cc.id;
    if (edit((score) => A.setCurve(score, lane, id, next))) say(tr("{change} — Ctrl+Z takes it back.", { change: words }));
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
    commit(A.withoutPoint(st.cc.id, list, k), tr("Point taken away"));
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
    const name = A.controllerName(st.cc.id);
    commit(next, point ? tr("{name}: {value}", { name, value: A.valueText(st.cc.id, point[1]) }) : name);
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
    // Another controller: its number asked for beside the menu, its curve drawn once it is given.
    otherBox.hidden = idBox.value !== "other";
    if (idBox.value === "other") return numberBox.focus();
    st.cc.id = idBox.value;
    st.cc.chosen = -1;
    redraw();
  });
  numberBox.addEventListener("change", () => {
    const id = A.idOfNumber(Number(numberBox.value));
    if (!id) return say(tr("A curve follows a controller from 1 to 119: bank select (0, 32) and the data entry go with a program change."), true);
    otherBox.hidden = true;
    st.cc.id = id;
    st.cc.chosen = -1;
    redraw();
  });
  bar.querySelector("[data-cc-clear]").addEventListener("click", () => {
    if (!st.score || !A.curveOf(st.score, laneNow(), st.cc.id).length) return say(tr("This curve has no point."));
    st.cc.chosen = -1;
    commit([], tr("{name} cleared", { name: A.controllerName(st.cc.id) }));
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
