// The Sound lane under the MIDI view (#670): a mode of the automation lane
// (automation-ui.js, its Curve menu's "Keyswitches and programs"). One
// staff's keyswitches and program changes as flags on two rows, and on a
// third, pale, what its articulation map sends; and the maps' dialog.
// What they are and how they are sent is sound.js's.
//
//   const lane = soundLane({ root, rollHost, rollScroll, st, edit, say, redraw, laneNow });
//   lane.show(true);                      // its bar, in the automation lane's
//   lane.html(lane, { label, colour, geo });  // the lane, as SVG
//
// A click on the Keyswitches row (or the Programs row) places one there,
// with the note (or the program) set in the bar, on a 32nd grid (Alt:
// anywhere); a flag dragged moves; a click chooses one, and the bar's
// values then change it; a double click, or a right click, takes it away.

const SEARCH = new URL(import.meta.url).search;
const M = await import(`./score-model.js${SEARCH}`);
const A = await import(`./automation.js${SEARCH}`);
const Snd = await import(`./sound.js${SEARCH}`);
const { tr } = await import(`./words.js${SEARCH}`);

/** Where this browser keeps the maps its person made, for any score. */
const KEPT = "eui-score-articulation-maps";

/** The maps kept in this browser: [{ id, map }]; none when the browser keeps nothing. */
export function browserMaps() {
  try {
    const list = JSON.parse(localStorage.getItem(KEPT) || "[]");
    if (!Array.isArray(list)) return [];
    return list.map((item) => ({ id: String(item?.id ?? ""), map: Snd.normalizeMap(item?.map) })).filter((item) => /^[A-Za-z0-9_-]{1,40}$/.test(item.id) && item.map);
  } catch (error) {
    return [];
  }
}

function keepBrowserMaps(list) {
  try {
    localStorage.setItem(KEPT, JSON.stringify(list.slice(0, 50)));
    return true;
  } catch (error) {
    return false;
  }
}

const escape = (text) => String(text).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const numberOr = (value, fallback = null) => (String(value ?? "").trim() === "" ? fallback : Number(value));

export function soundLane({ root, rollHost, rollScroll, st, edit, say, redraw, laneNow }) {
  st.ks = { chosen: null, drag: null, editing: null };
  const bar = Object.assign(document.createElement("div"), { className: "studio-cc-bar studio-ks-bar", hidden: true });
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", tr("Sound"));
  bar.innerHTML = [
    `<span class="studio-velocity-what">${tr("Sound")}</span>`,
    `<label class="studio-cc-field">${tr("Keyswitch")} <input type="number" min="0" max="127" step="1" value="12" data-ks-key aria-label="${tr("The keyswitch's note, 0 to 127")}"> <output data-ks-key-name>C0</output></label>`,
    `<label class="studio-cc-field">${tr("Program")} <input type="number" min="0" max="127" step="1" value="0" data-ks-program aria-label="${tr("The program, 0 to 127")}"></label>`,
    `<label class="studio-cc-field">${tr("Bank")} <input type="number" min="0" max="127" step="1" placeholder="MSB" data-ks-msb aria-label="${tr("The bank's MSB (CC 0), or nothing")}"> <input type="number" min="0" max="127" step="1" placeholder="LSB" data-ks-lsb aria-label="${tr("The bank's LSB (CC 32), or nothing")}"></label>`,
    `<label class="studio-cc-field">${tr("Articulation map")} <select data-ks-map aria-label="${tr("The articulation map this staff follows")}"></select></label>`,
    `<button type="button" class="studio-menu" data-ks-edit>${tr("Edit the maps…")}</button>`,
    `<button type="button" class="studio-menu" data-ks-clear>${tr("Clear the staff's markers")}</button>`,
    `<span class="studio-roll-hint">${tr("Click the Keyswitches or Programs row to place one with the values here; drag to move, double-click to take away. Sent to the device of Sound to and in Save as MIDI, never engraved.")}</span>`,
  ].join("");
  rollHost.append(bar);
  const field = (name) => bar.querySelector(`[data-ks-${name}]`);
  const mapBox = field("map");

  /** The staff's markers as kept, or as a drag shows them. */
  const view = (lane) => (st.ks.drag ? { ...Snd.soundOf(st.score, lane), [st.ks.drag.row]: st.ks.drag.view ?? st.ks.drag.list } : Snd.soundOf(st.score, lane));

  /** The map menu: none, the score's maps, then the template and this browser's, to add. */
  function mapOptions(lane) {
    const maps = Snd.mapsOf(st.score);
    const chosen = Snd.soundOf(st.score, lane).map;
    const own = Object.entries(maps).map(([id, map]) => `<option value="${escape(id)}">${escape(map.name)}</option>`).join("");
    const kept = browserMaps().map(({ id, map }) => `<option value="browser:${escape(id)}">${escape(map.name)}</option>`).join("");
    const html = `<option value="">${tr("None")}</option>${own ? `<optgroup label="${tr("In this score")}">${own}</optgroup>` : ""}<optgroup label="${tr("Add to this score")}"><option value="template">${escape(tr(Snd.TEMPLATE.name))}</option>${kept}</optgroup>`;
    return { html, chosen: chosen && maps[chosen] ? chosen : "" };
  }

  function show(on) {
    bar.hidden = !on;
    if (!on && dialog.open) dialog.close();
  }

  /** The lane as SVG, for lane `lane`, its bar's menus brought up to date. */
  function html(lane, { label = "", colour, geo }) {
    const { html: options, chosen } = mapOptions(lane);
    if (mapBox.dataset.key !== options) {
      mapBox.dataset.key = options;
      mapBox.innerHTML = options;
    }
    mapBox.value = chosen;
    st.ks.geo = geo;
    st.ks.lane = lane;
    if (dialog.open) renderDialog();
    return Snd.drawLane(st.score, geo, lane, { label, colour, chosen: st.ks.chosen, view: view(lane) });
  }

  function commit(fn, words) {
    if (edit(fn)) say(tr("{change} — Ctrl+Z takes it back.", { change: words }));
  }

  const keyNow = () => Math.max(0, Math.min(127, Math.round(Number(field("key").value) || 0)));
  const programNow = () => {
    const program = Math.max(0, Math.min(127, Math.round(Number(field("program").value) || 0)));
    return [program, numberOr(field("msb").value), numberOr(field("lsb").value)];
  };
  const showKeyName = () => {
    field("key-name").textContent = Snd.keyText(keyNow()).split(" ")[0];
  };

  /** The bar's values from marker `index` of `row`, chosen. */
  function loadMarker(row, marker) {
    if (row === "keys") {
      field("key").value = marker[1];
      showKeyName();
    } else {
      field("program").value = marker[1];
      field("msb").value = marker[2] ?? "";
      field("lsb").value = marker[3] ?? "";
    }
  }

  function at(event) {
    const box = rollScroll.querySelector(".ks-strip").getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  const words = (row, marker) => (row === "keys" ? tr("Keyswitch {key}", { key: Snd.keyText(marker[1]) }) : tr("Program change {program}", { program: Snd.programText(marker) }));

  rollHost.addEventListener("pointerdown", (event) => {
    if (!event.target.closest?.(".ks-strip") || !st.score || event.button === 2) return;
    rollHost.focus({ preventScroll: true });
    const p = at(event);
    const row = Snd.rowAt(p.y);
    if (row !== "keys" && row !== "programs") return;
    const lane = laneNow();
    const list = Snd.soundOf(st.score, lane)[row];
    let index = Snd.markerAt(st.ks.geo, list, p.x);
    let start = list;
    if (index < 0) {
      const tick = A.tickOfX(st.ks.geo, p.x, event.altKey ? 1 : M.WHOLE / 32);
      const marker = row === "keys" ? [tick, keyNow()] : [tick, ...programNow()];
      start = row === "keys" ? Snd.normalizeKeys([...list, marker]) : Snd.normalizePrograms([...list, marker]);
      index = start.findIndex(([t]) => t === tick);
    } else loadMarker(row, list[index]);
    st.ks.chosen = { row, index };
    st.ks.drag = { row, lane, list: start, index, view: null };
    rollHost.setPointerCapture?.(event.pointerId);
    redraw();
  });

  rollHost.addEventListener("pointermove", (event) => {
    const d = st.ks.drag;
    if (!d) return;
    const tick = A.tickOfX(st.ks.geo, at(event).x, event.altKey ? 1 : M.WHOLE / 32);
    const moved = d.list.map((m, k) => (k === d.index ? [tick, ...m.slice(1)] : m));
    // A marker already at that tick gives way to the one dragged.
    const kept = moved.filter((m, k) => k === d.index || m[0] !== tick);
    d.view = d.row === "keys" ? Snd.normalizeKeys(kept) : Snd.normalizePrograms(kept);
    st.ks.chosen = { row: d.row, index: d.view.findIndex(([t]) => t === tick) };
    redraw();
  });

  const end = () => {
    const d = st.ks.drag;
    if (!d) return;
    st.ks.drag = null;
    const next = d.view ?? d.list;
    const was = Snd.soundOf(st.score, d.lane)[d.row];
    if (JSON.stringify(next) === JSON.stringify(was)) return redraw();
    const marker = next[Math.max(0, st.ks.chosen?.index ?? 0)];
    commit((score) => Snd.setSound(score, d.lane, { [d.row]: next }), marker ? words(d.row, marker) : tr("Sound"));
  };
  rollHost.addEventListener("pointerup", end);
  rollHost.addEventListener("pointercancel", end);

  function removeAt(event) {
    const p = at(event);
    const row = Snd.rowAt(p.y);
    if (row !== "keys" && row !== "programs") return false;
    const lane = laneNow();
    const list = Snd.soundOf(st.score, lane)[row];
    const index = Snd.markerAt(st.ks.geo, list, p.x);
    if (index < 0) return false;
    st.ks.chosen = null;
    commit((score) => Snd.setSound(score, lane, { [row]: list.filter((_, k) => k !== index) }), row === "keys" ? tr("Keyswitch taken away") : tr("Program change taken away"));
    return true;
  }
  rollHost.addEventListener("dblclick", (event) => {
    if (event.target.closest?.(".ks-strip") && st.score) removeAt(event);
  });
  rollHost.addEventListener("contextmenu", (event) => {
    if (!event.target.closest?.(".ks-strip") || !st.score) return;
    if (removeAt(event)) event.preventDefault();
  });

  // The bar's values change the marker chosen.
  bar.addEventListener("input", (event) => {
    if (event.target === field("key")) showKeyName();
  });
  bar.addEventListener("change", (event) => {
    const target = event.target;
    if (!st.score) return;
    const lane = laneNow();
    if (target === mapBox) return chooseMap(lane, mapBox.value);
    const chosen = st.ks.chosen;
    if (!chosen) return;
    const list = Snd.soundOf(st.score, lane)[chosen.row];
    const marker = list[chosen.index];
    if (!marker) return;
    if (chosen.row === "keys" && target === field("key")) {
      const next = list.map((m, k) => (k === chosen.index ? [m[0], keyNow()] : m));
      commit((score) => Snd.setSound(score, lane, { keys: next }), words("keys", next[chosen.index]));
    } else if (chosen.row === "programs" && [field("program"), field("msb"), field("lsb")].includes(target)) {
      const next = list.map((m, k) => (k === chosen.index ? [m[0], ...programNow()] : m));
      commit((score) => Snd.setSound(score, lane, { programs: Snd.normalizePrograms(next) }), words("programs", Snd.normalizePrograms(next)[chosen.index]));
    }
  });
  bar.querySelector("[data-ks-clear]").addEventListener("click", () => {
    if (!st.score) return;
    const lane = laneNow();
    const { keys, programs } = Snd.soundOf(st.score, lane);
    if (!keys.length && !programs.length) return say(tr("This staff has no keyswitch or program change."));
    st.ks.chosen = null;
    commit((score) => Snd.setSound(score, lane, { keys: [], programs: [] }), tr("Keyswitches and program changes cleared"));
  });
  bar.querySelector("[data-ks-edit]").addEventListener("click", () => openDialog());

  /** A map for lane `lane`: none, one of the score's, or the template or a browser's map, added to the score first. */
  function chooseMap(lane, value) {
    if (value === "template" || value.startsWith("browser:")) {
      const source = value === "template" ? Snd.templateMap() : browserMaps().find((item) => `browser:${item.id}` === value)?.map;
      if (!source) return redraw();
      // The same map already in the score: that one.
      const same = Object.entries(Snd.mapsOf(st.score)).find(([, map]) => JSON.stringify(map) === JSON.stringify(source));
      const id = same?.[0] ?? Snd.newMapId(st.score);
      st.ks.editing = id;
      return commit((score) => {
        if (!same) Snd.setMap(score, id, source);
        Snd.setSound(score, lane, { map: id });
      }, tr("Articulation map: {name}", { name: source.name }));
    }
    const name = Snd.mapsOf(st.score)[value]?.name;
    commit((score) => Snd.setSound(score, lane, { map: value || null }), name ? tr("Articulation map: {name}", { name }) : tr("No articulation map"));
  }

  // ---- The maps' dialog ------------------------------------------------------------------

  const dialog = Object.assign(document.createElement("dialog"), { className: "studio-ksmap" });
  dialog.setAttribute("aria-label", tr("Articulation maps"));
  root.append(dialog);

  function openDialog() {
    if (!st.score) return;
    const lane = laneNow();
    const maps = Snd.mapsOf(st.score);
    st.ks.editing = Snd.soundOf(st.score, lane).map ?? (maps[st.ks.editing] ? st.ks.editing : Object.keys(maps)[0] ?? null);
    renderDialog(true);
    if (!dialog.open) dialog.show();
    dialog.querySelector("select, input, button")?.focus();
  }

  const markOptions = (chosen) => Snd.MARKS.map((m) => `<option value="${m.id}"${m.id === chosen ? " selected" : ""}>${escape(Snd.markName(m.id))}</option>`).join("");
  const num = (name, value, label, min = 0, max = 127) => `<input type="number" min="${min}" max="${max}" step="1" value="${value ?? ""}" data-ksd="${name}" aria-label="${escape(label)}">`;

  let drawnKey = "";

  /** The dialog drawn again — only when what it shows changed (the roll redraws often: a field being typed in stays). */
  function renderDialog(force = false) {
    if (!st.score) return;
    const lane = st.ks.lane ?? laneNow();
    const maps = Snd.mapsOf(st.score);
    const id = maps[st.ks.editing] ? st.ks.editing : null;
    const map = id ? maps[id] : null;
    const options = Snd.optionsOf(st.score);
    const staff = M.channels(st.score).find((c) => c.lane === lane)?.name ?? "";
    const kept = browserMaps();
    const key = JSON.stringify([lane, maps, id, options, staff, kept.map((item) => [item.id, item.map.name])]);
    if (!force && key === drawnKey) return;
    drawnKey = key;
    const parts = [];
    parts.push(`<div class="mixer-head"><h3>${tr("Articulation maps")}</h3><span class="mixer-note">${tr("Kept with the score. Sent to the device of Sound to and in Save as MIDI, never engraved.")}</span><button type="button" class="tool" data-ksd-act="close" aria-label="${tr("Close the articulation maps")}">✕</button></div>`);
    parts.push(`<p class="ksmap-note">${tr("A map sends a keyswitch (or a controller) before each note that carries a mark, the first rule it carries; and the default when a note carries none again. A keyswitch placed by hand wins at its tick.")}</p>`);
    const own = Object.entries(maps).map(([key, m]) => `<option value="${escape(key)}"${key === id ? " selected" : ""}>${escape(m.name)}</option>`).join("");
    parts.push(`<div class="ksmap-row"><label>${tr("Map")} <select data-ksd="pick">${own || `<option value="">${tr("None yet")}</option>`}</select></label><button type="button" class="studio-menu" data-ksd-act="new">${tr("New map")}</button><button type="button" class="studio-menu" data-ksd-act="template">${tr("From the template")}</button>${kept.length ? `<label>${tr("From this browser")} <select data-ksd="browser"><option value="">…</option>${kept.map((item) => `<option value="${escape(item.id)}">${escape(item.map.name)}</option>`).join("")}</select></label>` : ""}</div>`);
    parts.push(`<p class="ksmap-note">${escape(tr(Snd.TEMPLATE.description))}</p>`);
    if (map) {
      parts.push(`<div class="ksmap-row"><label>${tr("Name")} <input type="text" maxlength="60" value="${escape(map.name)}" data-ksd="name"></label><button type="button" class="studio-menu" data-ksd-act="use">${tr("Use for {staff}", { staff: escape(staff) })}</button><button type="button" class="studio-menu" data-ksd-act="keep">${tr("Keep in this browser")}</button><button type="button" class="studio-menu" data-ksd-act="delete">${tr("Delete the map")}</button></div>`);
      const d = map.default ?? {};
      parts.push(`<div class="ksmap-row"><strong>${tr("Default")}</strong><label>${tr("Keyswitch")} ${num("default-key", d.key, tr("The default keyswitch's note"))}</label><label>CC ${num("default-cc", d.cc, tr("The default's controller"))}</label><label>${tr("Value")} ${num("default-value", d.value, tr("The default's controller value"))}</label></div>`);
      const rows = map.rules
        .map((r, k) => `<tr><td><select data-ksd="mark" data-rule="${k}" aria-label="${tr("The mark")}">${markOptions(r.mark)}</select></td><td>${num("key", r.key, tr("The keyswitch's note")).replace("data-ksd", `data-rule="${k}" data-ksd`)}</td><td>${num("cc", r.cc, tr("The controller")).replace("data-ksd", `data-rule="${k}" data-ksd`)}</td><td>${num("value", r.value, tr("The controller's value")).replace("data-ksd", `data-rule="${k}" data-ksd`)}</td><td><button type="button" class="tool" data-ksd-act="up" data-rule="${k}" aria-label="${tr("Before the rule above")}"${k === 0 ? " disabled" : ""}>↑</button><button type="button" class="tool" data-ksd-act="remove" data-rule="${k}" aria-label="${tr("Take the rule away")}">✕</button></td></tr>`)
        .join("");
      parts.push(`<table class="ksmap-rules"><thead><tr><th>${tr("Mark")}</th><th>${tr("Keyswitch")}</th><th>CC</th><th>${tr("Value")}</th><th></th></tr></thead><tbody>${rows}</tbody></table>`);
      parts.push(`<div class="ksmap-row"><button type="button" class="studio-menu" data-ksd-act="add">${tr("Add a rule")}</button></div>`);
    }
    parts.push(`<div class="ksmap-row"><strong>${tr("Sending")}</strong><label>${tr("Ahead of the note (ms)")} ${num("lead", options.lead, tr("How early a keyswitch or a program change goes, in ms"), 0, Snd.LEAD_MAX)}</label><label>${tr("Keyswitch velocity")} ${num("velocity", options.velocity, tr("The keyswitch's velocity, 1 to 127"), 1, 127)}</label></div>`);
    const focused = document.activeElement && dialog.contains(document.activeElement) ? document.activeElement : null;
    const where = focused ? [focused.dataset.ksd ?? focused.dataset.ksdAct, focused.dataset.rule] : null;
    dialog.innerHTML = parts.join("");
    if (where) dialog.querySelector(`[data-ksd="${where[0]}"]${where[1] != null ? `[data-rule="${where[1]}"]` : ""}, [data-ksd-act="${where[0]}"]${where[1] != null ? `[data-rule="${where[1]}"]` : ""}`)?.focus();
  }

  /** The map edited, changed by `fn(map)`: kept in the score. */
  function changeMap(fn, words) {
    const id = st.ks.editing;
    const map = Snd.mapsOf(st.score)[id];
    if (!map) return;
    const next = structuredClone(map);
    fn(next);
    commit((score) => Snd.setMap(score, id, next), words);
  }

  dialog.addEventListener("change", (event) => {
    const target = event.target.closest("[data-ksd]");
    if (!target || !st.score) return;
    const name = target.dataset.ksd;
    const rule = target.dataset.rule != null ? Number(target.dataset.rule) : null;
    const value = target.value;
    if (name === "pick") {
      st.ks.editing = value || null;
      return renderDialog();
    }
    if (name === "browser") {
      const item = browserMaps().find((x) => x.id === value);
      if (!item) return;
      const id = Snd.mapsOf(st.score)[item.id] ? Snd.newMapId(st.score) : item.id;
      st.ks.editing = id;
      return commit((score) => Snd.setMap(score, id, item.map), tr("Articulation map added: {name}", { name: item.map.name }));
    }
    if (name === "lead" || name === "velocity") return commit((score) => Snd.setOptions(score, { [name]: value }), name === "lead" ? tr("Keyswitches {ms} ms ahead", { ms: Snd.optionsOf({ meta: { ksopt: { lead: value } } }).lead }) : tr("Keyswitch velocity {velocity}", { velocity: Snd.optionsOf({ meta: { ksopt: { velocity: value } } }).velocity }));
    if (name === "name") return changeMap((map) => (map.name = value), tr("Map renamed"));
    if (name.startsWith("default-")) {
      return changeMap((map) => {
        const field = name.slice("default-".length);
        map.default = { ...(map.default ?? {}), [field]: numberOr(value) };
      }, tr("Default changed"));
    }
    if (rule != null) {
      return changeMap((map) => {
        if (!map.rules[rule]) return;
        map.rules[rule][name === "mark" ? "mark" : name] = name === "mark" ? value : numberOr(value);
      }, tr("Rule changed"));
    }
  });

  dialog.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ksd-act]");
    if (!button || !st.score) return;
    const act = button.dataset.ksdAct;
    const rule = button.dataset.rule != null ? Number(button.dataset.rule) : null;
    const lane = st.ks.lane ?? laneNow();
    if (act === "close") return dialog.close();
    if (act === "new" || act === "template") {
      const id = Snd.newMapId(st.score);
      const map = act === "template" ? Snd.templateMap() : { name: tr("New map"), default: { key: 12 }, rules: [{ mark: "staccato", key: 13 }] };
      st.ks.editing = id;
      return commit((score) => {
        Snd.setMap(score, id, map);
        if (!Snd.soundOf(score, lane).map) Snd.setSound(score, lane, { map: id });
      }, tr("Articulation map added: {name}", { name: map.name }));
    }
    const id = st.ks.editing;
    const map = Snd.mapsOf(st.score)[id];
    if (!map) return;
    if (act === "use") return commit((score) => Snd.setSound(score, lane, { map: id }), tr("Articulation map: {name}", { name: map.name }));
    if (act === "delete") {
      st.ks.editing = null;
      return commit((score) => Snd.setMap(score, id, null), tr("Articulation map deleted: {name}", { name: map.name }));
    }
    if (act === "keep") {
      const list = browserMaps().filter((item) => item.id !== id);
      const done = keepBrowserMaps([{ id, map }, ...list]);
      renderDialog();
      redraw();
      return say(done ? tr("Kept in this browser: {name}, for your other scores.", { name: map.name }) : tr("This browser keeps nothing here (a private window?)."), !done);
    }
    if (act === "add") {
      const used = new Set(map.rules.map((r) => r.mark));
      const mark = Snd.MARKS.find((m) => !used.has(m.id))?.id ?? "staccato";
      const key = Math.min(127, Math.max(map.default?.key ?? 12, ...map.rules.map((r) => r.key ?? 0)) + 1);
      return changeMap((next) => next.rules.push({ mark, key }), tr("Rule added"));
    }
    if (act === "remove" && rule != null) return changeMap((next) => next.rules.splice(rule, 1), tr("Rule taken away"));
    if (act === "up" && rule > 0) return changeMap((next) => next.rules.splice(rule - 1, 2, next.rules[rule], next.rules[rule - 1]), tr("Rule moved up"));
  });

  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    dialog.close();
  });

  return { html, show, openDialog };
}
