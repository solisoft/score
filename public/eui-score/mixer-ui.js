// The mixer's panel: a strip per staff — volume, pan, mute, solo and its
// effects — and the master, with its level meter. The settings are mixer.js's;
// the studio keeps them in the score and hears them (studio.js, "Mixer").
//
//   const panel = mixerPanel({ root, tracks, mix, preview, commit, level });
//   panel.toggle();        // shown beside the score, or put away
//   panel.refresh();       // after an edit: the staves and the settings again
//
// `tracks()` → [{ lane, name, colour }]; `mix()` → the score's mixer;
// `instrument` (instruments-ui.js) → what each staff plays, in its strip;
// `preview(mix)` while a control moves (heard, not kept); `commit(lane,
// patch)` when it is let go (kept, one Undo away); `level()` → the master's
// peak (0–1), or null while nothing plays; `signal` ends its listener on the
// document, `end()` its meter, when the editor is gone.

const SEARCH = new URL(import.meta.url).search;
const X = await import(`./mixer.js${SEARCH}`);
const { tr } = await import(`./words.js${SEARCH}`);

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** A fader's dB as words: "-6.0 dB", "off" at the bottom. */
export function dbText(db) {
  return db <= X.VOLUME_MIN ? tr("off") : `${db > 0 ? "+" : ""}${Number(db).toFixed(1)} dB`;
}

/** A pan as words: "C", "L 40", "R 100". */
export function panText(pan) {
  const n = Math.round(Math.abs(pan) * 100);
  return n === 0 ? "C" : pan < 0 ? tr("L {n}", { n }) : tr("R {n}", { n });
}

/** The patch a control's new value makes: `field` "volume" or "eq.low"…, the value read as its kind. */
export function patchOf(field, value) {
  const [head, tail] = field.split(".");
  return tail ? { [head]: { [tail]: value } } : { [head]: value };
}

function range(lane, field, value, min, max, step, label, shown) {
  return `<label class="mixer-field"><span>${label}</span><input type="range" data-lane="${lane}" data-field="${field}" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${escape(label)}"><output>${shown}</output></label>`;
}

/** A room's name, as the reverb's list shows it. */
function roomName(id, room) {
  return { room: tr("Room"), chamber: tr("Chamber"), hall: tr("Hall"), cathedral: tr("Cathedral") }[id] ?? room.name;
}

function effects(lane, s) {
  const toggle = (fx, label) =>
    `<label class="mixer-fx-toggle"><input type="checkbox" data-lane="${lane}" data-field="${fx}.on"${s[fx].on ? " checked" : ""}> ${label}</label>`;
  const rooms = Object.entries(X.ROOMS)
    .map(([id, room]) => `<option value="${id}"${s.reverb.room === id ? " selected" : ""}>${roomName(id, room)}</option>`)
    .join("");
  return `<details class="mixer-fx"${s.eq.on || s.comp.on || s.reverb.on ? " open" : ""}><summary>${tr("Effects")}</summary>
    <div class="mixer-fx-group">${toggle("eq", "EQ")}
      ${range(lane, "eq.low", s.eq.low, -X.EQ_RANGE, X.EQ_RANGE, 0.5, tr("Low"), `${s.eq.low} dB`)}
      ${range(lane, "eq.mid", s.eq.mid, -X.EQ_RANGE, X.EQ_RANGE, 0.5, tr("Mid"), `${s.eq.mid} dB`)}
      ${range(lane, "eq.high", s.eq.high, -X.EQ_RANGE, X.EQ_RANGE, 0.5, tr("High"), `${s.eq.high} dB`)}</div>
    <div class="mixer-fx-group">${toggle("comp", tr("Compressor"))}
      ${range(lane, "comp.threshold", s.comp.threshold, -60, 0, 1, tr("Threshold"), `${s.comp.threshold} dB`)}
      ${range(lane, "comp.ratio", s.comp.ratio, 1, 20, 0.5, "Ratio", `${s.comp.ratio}:1`)}</div>
    <div class="mixer-fx-group">${toggle("reverb", tr("Reverb"))}
      <label class="mixer-field"><span>${tr("Room")}</span><select data-lane="${lane}" data-field="reverb.room" aria-label="${tr("Room")}">${rooms}</select></label>
      ${range(lane, "reverb.mix", s.reverb.mix, 0, 1, 0.01, tr("Amount"), `${Math.round(s.reverb.mix * 100)} %`)}</div>
  </details>`;
}

/** A track's strip, as HTML; `instrument` the part that says what it plays (instruments-ui.js, #391). */
export function trackHtml({ lane, name, colour }, s, instrument = "") {
  return `<section class="mixer-strip" data-strip="${lane}" aria-label="${escape(name)}">
    <header><i style="background:${colour}"></i><span title="${escape(name)}">${escape(name)}</span></header>
    <div class="mixer-ms">
      <button type="button" class="tool${s.mute ? " on" : ""}" data-lane="${lane}" data-toggle="mute" aria-pressed="${s.mute}" title="${escape(tr("Mute {name}", { name }))}">M</button>
      <button type="button" class="tool${s.solo ? " on" : ""}" data-lane="${lane}" data-toggle="solo" aria-pressed="${s.solo}" title="${escape(tr("Solo {name}", { name }))}">S</button>
    </div>
    ${range(lane, "volume", s.volume, X.VOLUME_MIN, X.VOLUME_MAX, 0.5, "Volume", dbText(s.volume))}
    ${range(lane, "pan", s.pan, -1, 1, 0.05, tr("Pan"), panText(s.pan))}
    ${instrument}
    ${effects(lane, s)}
  </section>`;
}

/** The master's strip, as HTML: its fader, its meter, its effects. */
export function masterHtml(s) {
  return `<section class="mixer-strip mixer-master" data-strip="master" aria-label="Master">
    <header><span>Master</span></header>
    <div class="mixer-meter" role="meter" aria-label="${tr("Master level")}" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0"><div class="mixer-meter-fill"></div></div>
    ${range("master", "volume", s.volume, X.VOLUME_MIN, X.VOLUME_MAX, 0.5, "Volume", dbText(s.volume))}
    ${effects("master", s)}
  </section>`;
}

/** A control's value, as its field wants it. */
function valueOf(control) {
  if (control.type === "checkbox") return control.checked;
  if (control.tagName === "SELECT") return control.value;
  return Number(control.value);
}

/** What a control's output says. */
function shown(field, value) {
  if (field === "volume") return dbText(value);
  if (field === "pan") return panText(value);
  if (field === "comp.ratio") return `${value}:1`;
  if (field === "reverb.mix") return `${Math.round(value * 100)} %`;
  return `${value} dB`;
}

export function mixerPanel({ root, tracks, mix, preview, commit, level, instrument = null, signal = undefined }) {
  const panel = Object.assign(document.createElement("dialog"), { className: "studio-mixer" });
  panel.setAttribute("aria-label", tr("Mixer"));
  panel.innerHTML = `<div class="mixer-head"><h3>${tr("Mixer")}</h3><span class="mixer-note">${tr("Kept with the score; heard on Play and in Save the sound.")}</span><button type="button" class="tool" data-mixer-close aria-label="${tr("Close the mixer")}">✕</button></div><div class="mixer-strips" data-mixer-strips></div>`;
  root.append(panel);
  instrument?.bind(panel);
  const strips = panel.querySelector("[data-mixer-strips]");
  let key = "";
  let frame = 0;
  let held = false;

  // A staff's lane is a number; the master and an audio track (#390, "audio-1") go by name.
  const laneOf = (el) => (/^\d+$/.test(el.dataset.lane) ? Number(el.dataset.lane) : el.dataset.lane);

  function render() {
    const rows = tracks();
    const now = mix() ?? {};
    const parts = rows.map((t) => instrument?.html(t.lane) ?? "");
    const next = JSON.stringify([rows, now, parts]);
    if (next === key) return;
    key = next;
    strips.innerHTML = rows.map((t, k) => trackHtml(t, X.trackOf(now, t.lane), parts[k])).join("") + masterHtml(X.masterOf(now));
  }

  function meter() {
    frame = 0;
    // Swapped out by instant navigation, the dialog is still open: its meter stops all the same.
    if (!panel.open || !panel.isConnected) return;
    const peak = level?.() ?? 0;
    const fill = panel.querySelector(".mixer-meter-fill");
    if (fill) {
      // In dB, from -48 to 0: what the ear hears as loudness.
      const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
      const height = Math.max(0, Math.min(1, (db + 48) / 48));
      fill.style.height = `${(height * 100).toFixed(1)}%`;
      fill.classList.toggle("mixer-meter-clip", peak >= 1);
      fill.parentElement.setAttribute("aria-valuenow", peak.toFixed(2));
    }
    frame = requestAnimationFrame(meter);
  }

  panel.addEventListener("pointerdown", () => {
    held = true;
  });
  panel.ownerDocument.addEventListener("pointerup", () => {
    held = false;
  }, { signal });
  panel.addEventListener("input", (event) => {
    const control = event.target.closest("[data-field]");
    if (!control || control.type === "checkbox" || control.tagName === "SELECT") return;
    const value = valueOf(control);
    const out = control.parentElement.querySelector("output");
    if (out) out.textContent = shown(control.dataset.field, value);
    preview(X.patched(mix() ?? {}, laneOf(control), patchOf(control.dataset.field, value)) ?? {});
  });
  panel.addEventListener("change", (event) => {
    const control = event.target.closest("[data-field]");
    if (!control) return;
    commit(laneOf(control), patchOf(control.dataset.field, valueOf(control)));
  });
  panel.addEventListener("click", (event) => {
    if (event.target.closest("[data-mixer-close]")) return close();
    const button = event.target.closest("[data-toggle]");
    if (!button) return;
    const lane = laneOf(button);
    const field = button.dataset.toggle;
    commit(lane, { [field]: !X.trackOf(mix() ?? {}, lane)[field] });
  });
  // A double click on a fader puts it back to the middle.
  panel.addEventListener("dblclick", (event) => {
    const control = event.target.closest('input[type="range"][data-field]');
    if (!control) return;
    const field = control.dataset.field;
    const reset = field === "volume" || field === "pan" || field.startsWith("eq.") ? 0 : null;
    if (reset == null) return;
    commit(laneOf(control), patchOf(field, reset));
  });

  function open() {
    key = "";
    render();
    if (!panel.open) panel.show();
    if (!frame) frame = requestAnimationFrame(meter);
  }

  function close() {
    panel.close();
    cancelAnimationFrame(frame);
    frame = 0;
  }

  return {
    panel,
    open,
    close,
    /** The editor is gone (instant navigation): the meter stops. */
    end: close,
    toggle() {
      if (panel.open) close();
      else open();
      return panel.open;
    },
    /** The staves and the settings again, unless a control is being moved. */
    refresh() {
      if (panel.open && !held) render();
    },
    get isOpen() {
      return panel.open;
    },
  };
}
