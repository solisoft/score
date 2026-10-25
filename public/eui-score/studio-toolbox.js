// The studio's toolbox and menus (studio.js): their labels for a screen
// reader and for a Mac, the sections that fold, the drum palette, the
// intervals and the instruments; what they show of the score as it changes
// (showState, fillFields) and the score's settings their fields change
// (onField).

/** The toolbox and the menus set up; answers what shows the state in them, and what their fields change. */
export function install(ctx) {
  const { root, state, notice, st, M, K } = ctx;
  const { barNo, edit, changeBar, staffOf, range, showProgress, renderMix } = ctx.call;

  // A button drawn with a sign (𝅘𝅥, ♭, ↑, 3) tells a screen reader what it
  // does: its title, without the key in brackets.
  for (const button of root.querySelectorAll("button[title]")) {
    if (!button.hasAttribute("aria-label") && !/\p{L}{2}/u.test(button.textContent)) button.setAttribute("aria-label", button.title.replace(/\s*\(.*\)\s*$/, ""));
  }

  // On a Mac, the menus and the tools' tips say ⌘ and ⌥ where they say Ctrl and Alt.
  const mac = K.isMac();
  if (mac) {
    for (const kbd of root.querySelectorAll(".studio-dropdown-items kbd")) kbd.textContent = K.keyLabel(kbd.textContent, true);
    for (const el of root.querySelectorAll("[title]")) el.title = K.keyLabel(el.title, true);
  }

  // The toolbox's sections fold, and stay as the person left them.
  const FOLDED = "eui-score-studio-folded";
  let folded = {};
  try {
    folded = JSON.parse(localStorage.getItem(FOLDED) || "{}");
  } catch (error) {}
  for (const section of root.querySelectorAll("details[data-section]")) {
    if (folded[section.dataset.section]) section.open = false;
    section.addEventListener("toggle", () => {
      folded[section.dataset.section] = !section.open;
      try {
        localStorage.setItem(FOLDED, JSON.stringify(folded));
      } catch (error) {}
    });
  }

  // The drum palette, for a drum staff: a button for each drum of the kit.
  const drumRow = root.querySelector("[data-drums]");
  for (const drum of M.DRUMS) {
    const button = Object.assign(document.createElement("button"), { type: "button", className: "tool", textContent: drum.label, title: `${drum.label} (${drum.name})` });
    button.dataset.act = "drum";
    button.dataset.name = drum.name;
    drumRow?.append(button);
  }

  // The intervals to transpose by; a major second by default.
  const intervalMenu = root.querySelector("[data-transpose-interval]");
  if (intervalMenu) {
    M.INTERVALS.forEach((it, k) => intervalMenu.append(new Option(it.name, String(k))));
    intervalMenu.value = String(M.INTERVALS.findIndex((it) => it.name === "major second"));
  }

  // The instrument menus, from INSTRUMENTS by family; the new staff's offers
  // the piano's lower staff too, in the bass clef.
  for (const select of root.querySelectorAll("[data-instruments]")) {
    const families = new Map();
    M.INSTRUMENTS.forEach((it, k) => {
      if (!families.has(it.family)) families.set(it.family, Object.assign(document.createElement("optgroup"), { label: it.family }));
      const group = families.get(it.family);
      group.append(new Option(it.name, String(k)));
      if (select.dataset.instruments === "new" && it.name === "Piano") group.append(new Option("Piano, lower staff", `${k}|bass`));
    });
    select.append(...families.values());
    // A second staff is most often a melody instrument: the violin, as before.
    if (select.dataset.instruments === "new") select.value = String(M.INSTRUMENTS.findIndex((it) => it.name === "Violin"));
  }

  function showState() {
    root.classList.toggle("studio-input", st.input.on);
    root.classList.toggle("studio-text-only", !st.score);
    // File ▸ Print as PDF names the paper the PDF is printed on: the score's \paper.
    const paper = root.querySelector("[data-pdf-paper]");
    if (paper) paper.textContent = M.paperLabel(st.text);
    notice.hidden = (Boolean(st.score) || !st.unsupported.length) && !(st.score && st.lostNotice);
    if (!st.score && st.unsupported.length) {
      notice.textContent = `This piece uses ${st.unsupported.join(", ")}: the score editor does not edit those yet. It is engraved, and its text below can be edited.`;
    } else if (st.score && st.lostNotice) notice.textContent = st.lostNotice;
    for (const button of root.querySelectorAll('[data-act="duration"]')) button.classList.toggle("on", Number(button.dataset.base) === st.input.base);
    root.querySelector('.studio-toolbox [data-act="dot"]')?.classList.toggle("on", st.input.dots > 0);
    // The toolbox's toggles show their state; the menus' items of the same name do not.
    root.querySelector('.studio-toolbox [data-act="mode-input"]')?.classList.toggle("on", st.input.on);
    root.querySelector('.studio-toolbox [data-act="mode-select"]')?.classList.toggle("on", !st.input.on);
    const voiceNow = st.score ? M.voiceOf(st.score, staffOf()) : 0;
    for (const button of root.querySelectorAll('.studio-toolbox [data-act="voice"]')) button.classList.toggle("on", Number(button.dataset.voice) === voiceNow);
    // A drum staff writes with drums, the others with letters.
    const onDrums = Boolean(st.score) && M.isDrums(st.score, staffOf());
    if (drumRow) drumRow.hidden = !onDrums;
    for (const button of root.querySelectorAll('[data-act="letter"]')) button.hidden = onDrums;
    // The toggles say whether they are on.
    for (const button of root.querySelectorAll('.studio-toolbox :is([data-act="duration"], [data-act="dot"], [data-act^="mode-"], [data-act="voice"])')) {
      button.setAttribute("aria-pressed", String(button.classList.contains("on")));
    }
    for (const button of root.querySelectorAll('[data-act="undo"]')) button.disabled = !st.past.length;
    for (const button of root.querySelectorAll('[data-act="redo"]')) button.disabled = !st.future.length;
    const handle = st.playing?.handle;
    root.querySelector(".studio-play").textContent = !st.playing ? "▶ Play" : !handle ? "■ Stop" : handle.paused ? "▶ Play" : "❚❚ Pause";
    root.querySelector('.studio-menu[data-act="stop"]').hidden = !handle;
    renderMix();
    root.querySelector("[data-zoom-label]").textContent = `${Math.round(st.zoom * 100)} %`;
    for (const tool of root.querySelectorAll(".studio-toolbox .tool, .studio-toolbox input, .studio-toolbox select")) tool.disabled = !st.score;
    fillFields();
    // What is selected, in words.
    const value = `${({ 1: "whole", 2: "half", 4: "quarter", 8: "eighth", 16: "16th", 32: "32nd" })[st.input.base]}${st.input.dots ? ", dotted" : ""}`;
    if (st.playing) showProgress();
    else if (st.input.on) state.textContent = `Note input${M.isLower(st.score, st.input.staff) ? ` · voice ${M.voiceOf(st.score, st.input.staff)}` : ""} · ${value} · A–G write, 0 rest, Esc to stop`;
    else {
      const r = range();
      if (!r) state.textContent = st.score ? "Click a note to select it · N to write notes" : "Text only";
      else if (r.a !== r.b) state.textContent = `${r.b - r.a + 1} selected`;
      else {
        const ev = r.staff.events[r.a];
        const len = ({ 1: "whole", 2: "half", 4: "quarter", 8: "eighth", 16: "16th", 32: "32nd" })[ev.base] + (ev.dots ? " dotted" : "") + (ev.tuplet ? ` (${ev.tuplet.n}-tuplet)` : "");
        state.textContent = (M.isLower(st.score, r.s) ? `Voice ${M.voiceOf(st.score, r.s)} · ` : "") + (ev.rest ? `Rest · ${len}` : `${ev.pitches.length > 1 ? "Chord" : "Note"} ${ev.pitches.map((p, k) => (k === st.sel.head ? `[${M.pitchName(p.d, p.alter)}]` : M.pitchName(p.d, p.alter))).join(" ")} · ${len}`);
      }
    }
  }

  let filling = false;
  function fillFields() {
    if (!st.score) return;
    filling = true;
    const set = (field, value) => {
      const el = root.querySelector(`[data-field="${field}"]`);
      if (el && document.activeElement !== el) el.value = value ?? "";
    };
    const staff = st.score.staves[M.upperOf(st.score, staffOf())] ?? st.score.staves[0];
    set("title", st.score.header.title);
    set("subtitle", st.score.header.subtitle);
    set("composer", st.score.header.composer);
    for (const field of ["piece", "opus", "copyright"]) set(field, st.score.header[field]);
    set("key", String(st.score.key));
    set("time", M.timeText(st.score));
    fillPickup();
    set("bpm", st.score.tempo?.bpm || "");
    set("tempo-text", st.score.tempo?.text || "");
    set("group", st.score.group);
    const paper = st.score.paper?.size ?? "a4";
    set("paper-size", paper.replace(/landscape$/, ""));
    set("paper-orientation", paper.endsWith("landscape") ? "landscape" : "portrait");
    set("staff-size", String(st.score.paper?.staffSize ?? 20));
    const even = root.querySelector('[data-field="even-pages"]');
    if (even) even.checked = st.score.paper?.evenPages === true;
    set("systems-per-page", st.score.paper?.systemsPerPage ? String(st.score.paper.systemsPerPage) : "");
    for (const [key] of M.PAGE_LINES) set(`page-${key}`, M.pageLineText(st.score.paper?.marks?.[key]));
    set("staff-name", staff.name);
    set("staff-short", staff.short);
    set("staff-clef", staff.clef);
    set("staff-key", staff.key == null ? "" : String(staff.key));
    fillChanges(set);
    // An instrument the menu does not offer (from a source) shows as itself.
    const instrument = root.querySelector('[data-field="staff-instrument"]');
    if (instrument && document.activeElement !== instrument) {
      const k = M.instrumentOf(st.score, staffOf());
      instrument.querySelector("[data-other]")?.remove();
      if (k < 0) {
        const other = new Option(`Other: ${staff.instrument}`, "other");
        other.dataset.other = "";
        instrument.prepend(other);
      }
      instrument.value = k < 0 ? "other" : String(k);
    }
    filling = false;
  }

  /** The pickup field: its value as \\partial writes it, a length the menu does not offer shown as itself. */
  function fillPickup() {
    const field = root.querySelector('[data-field="pickup"]');
    if (!field || document.activeElement === field) return;
    const value = st.score.pickup > 0 ? M.pickupText(st.score.pickup) : "";
    field.querySelector("[data-other]")?.remove();
    if (![...field.options].some((o) => o.value === value)) {
      const other = new Option(`Other: \\partial ${value}`, value);
      other.dataset.other = "";
      field.append(other);
    }
    field.value = value;
  }

  const KEY_NAMES = ["C♭", "G♭", "D♭", "A♭", "E♭", "B♭", "F", "C", "G", "D", "A", "E", "B", "F♯", "C♯"];

  /** The changes section: the bar's own changes, and what is in force there otherwise. */
  function fillChanges(set) {
    const b = changeBar();
    const section = root.querySelector("[data-changes]");
    if (!section) return;
    const on = b != null && b > 0;
    section.querySelector("[data-change-bar]").textContent = b == null ? "—" : String(barNo(b));
    section.querySelector("[data-change-hint]").textContent = b == null
      ? "Select a bar, or put the cursor in it: what changes here goes on to the next change."
      : b === 0 ? `Bar ${barNo(0)} is the piece's start${st.score.pickup ? ", its pickup" : ""}: its key, metre and tempo are in File ▸ Score properties, its clef under This staff.` : "What changes here goes on to the next change.";
    for (const el of section.querySelectorAll("[data-field]")) el.disabled = !on;
    if (!on) return;
    const s = staffOf();
    const c = M.changeAt(st.score, b);
    const was = { key: M.keyOf(st.score, s, M.barStart(st.score, b - 1)), time: M.timeAt(st.score, b - 1), clef: M.clefAt(st.score, s, b - 1), tempo: M.tempoAt(st.score, b - 1) };
    const first = (field, text) => {
      const option = section.querySelector(`[data-field="${field}"] option[value=""]`);
      if (option) option.textContent = `As before: ${text}`;
    };
    first("change-key", `${KEY_NAMES[was.key + 7]} major`);
    first("change-time", was.time.join("/"));
    first("change-clef", was.clef.replace("_8", " 8"));
    section.querySelector('[data-field="change-bpm"]').placeholder = was.tempo?.bpm ? `as before: ${was.tempo.bpm}` : "as before";
    set("change-key", c?.key == null ? "" : String(c.key));
    set("change-time", c?.time ? c.time.join("/") : "");
    set("change-bpm", c?.tempo?.bpm || "");
    set("change-tempo-text", c?.tempo?.text || "");
    set("change-clef", (st.score.staves[M.upperOf(st.score, s)].clefs ?? []).find((x) => x.bar === b)?.clef ?? "");
    const double = section.querySelector('[data-field="change-double"]');
    if (double) double.checked = c?.line === "||";
  }

  function onField(event) {
    const el = event.target.closest("[data-field]");
    if (!el || filling || el.dataset.field === "new-staff") return;
    const value = el.value;
    edit((score) => {
      const staff = score.staves[M.upperOf(score, staffOf())] ?? score.staves[0];
      switch (el.dataset.field) {
        case "title": case "subtitle": case "composer": case "piece": case "opus": case "copyright": score.header[el.dataset.field] = value; break;
        case "systems-per-page": M.setSystemsPerPage(score, value); break;
        case "page-oddHeader": case "page-evenHeader": case "page-oddFooter": case "page-evenFooter": M.setPageLine(score, el.dataset.field.slice(5), value); break;
        case "key": M.setKey(score, Number(value)); break;
        case "time": M.setMetre(score, value); break;
        case "pickup": M.setPickup(score, M.pickupOf(value)); break;
        case "bpm": score.tempo = { ...(score.tempo ?? { text: "", base: 4 }), bpm: Number(value) || 0 }; break;
        case "tempo-text": score.tempo = { ...(score.tempo ?? { base: 4, bpm: 0 }), text: value }; break;
        case "group": score.group = value; break;
        case "paper-size": case "paper-orientation": {
          const size = root.querySelector('[data-field="paper-size"]').value;
          const wide = root.querySelector('[data-field="paper-orientation"]').value === "landscape";
          M.setPaper(score, { size: size + (wide ? "landscape" : ""), staffSize: score.paper?.staffSize ?? null });
          break;
        }
        case "staff-size": M.setPaper(score, { size: score.paper?.size ?? "a4", staffSize: Number(value) }); break;
        case "even-pages": M.setEvenPages(score, el.checked); break;
        case "staff-name": staff.name = value; break;
        case "staff-short": staff.short = value; break;
        case "staff-clef": staff.clef = value; break;
        case "staff-key": M.setStaffKey(score, staffOf(), value === "" ? score.key : Number(value)); break;
        case "change-key": M.setKeyAt(score, changeBar(), value === "" ? null : Number(value)); break;
        case "change-time": {
          const b = changeBar();
          const [n, d] = value ? value.split("/").map(Number) : M.timeAt(score, b - 1);
          M.setTimeAt(score, b, n, d);
          break;
        }
        case "change-bpm": case "change-tempo-text": {
          const b = changeBar();
          const here = M.changeAt(score, b)?.tempo ?? { text: "", base: M.tempoAt(score, b - 1)?.base || 4, bpm: 0 };
          M.setTempoAt(score, b, el.dataset.field === "change-bpm" ? { ...here, bpm: Number(value) || 0 } : { ...here, text: value });
          break;
        }
        case "change-clef": M.setClefAt(score, staffOf(), changeBar(), value || null); break;
        case "change-double": M.setDoubleBar(score, changeBar(), el.checked); break;
        case "staff-instrument": if (value !== "other") M.setInstrument(score, staffOf(), Number(value)); break;
      }
    });
  }

  return { mac, showState, onField };
}
