// The studio's toolbox and menus (studio.js): their labels for a screen
// reader and for a Mac, the sections that fold, the drum palette, the
// intervals and the instruments; what they show of the score as it changes
// (showState, fillFields) and the score's settings their fields change
// (onField).

// The editor's words in the page's language (#508).
const V = new URL(import.meta.url).search;
const { tr } = await import(`./words.js${V}`);

/** The Playback and Recording panels' width, as the CSS has it. */
const PANEL_WIDTH = 340;

/** The sections open until the person folds or opens them: those written with all the time. */
export const OPEN_AT_FIRST = new Set(["mode", "duration", "notes", "pitch"]);

/** Whether the toolbox's section `name` is open: as the person left it (`folded`, name → folded), or as at first. */
export function sectionOpen(name, folded) {
  return name in folded ? !folded[name] : OPEN_AT_FIRST.has(name);
}

/** The section whose tools a selection needs, or null: the bars' for bars, the words' on a line of chord names. */
export function neededSection(score, sel) {
  if (!score || !sel) return null;
  if (score.staves[sel.staff]?.chords) return "words";
  return sel.bars ? "bars-and-staves" : null;
}

/** A note value's name, in the page's language: "quarter", "eighth"… */
function valueWord(base) {
  return { 1: tr("whole"), 2: tr("half"), 4: tr("quarter"), 8: tr("eighth"), 16: tr("16th"), 32: tr("32nd") }[base];
}

/** An interval's name (score-model.js's INTERVALS), in the page's language. */
export function intervalName(name) {
  const names = {
    "minor second": tr("minor second"),
    "major second": tr("major second"),
    "minor third": tr("minor third"),
    "major third": tr("major third"),
    "perfect fourth": tr("perfect fourth"),
    "augmented fourth": tr("augmented fourth"),
    "perfect fifth": tr("perfect fifth"),
    "minor sixth": tr("minor sixth"),
    "major sixth": tr("major sixth"),
    "minor seventh": tr("minor seventh"),
    "major seventh": tr("major seventh"),
    octave: tr("octave"),
  };
  return names[name] ?? name;
}

/** The drum palette's names (score-model.js's DRUMS), in the page's language; those said alike, as they are. */
function drumWord(drum) {
  const names = {
    bd: tr("Kick"),
    sn: tr("Snare"),
    ss: tr("Side stick"),
    hh: tr("Hi-hat"),
    hho: tr("Open hi-hat"),
    hhp: tr("Pedal hi-hat"),
    rb: tr("Ride bell"),
    tomh: tr("High tom"),
    tommh: tr("Mid tom"),
    tomml: tr("Low-mid tom"),
    toml: tr("Low tom"),
    tomfh: tr("Floor tom"),
    tomfl: tr("Low floor tom"),
    hc: tr("Hand clap"),
    tamb: tr("Tambourine"),
  };
  return names[drum.name] ?? drum.label;
}

/**
 * An instrument's name (score-model.js's INSTRUMENTS, the templates' staves) as
 * the page's language shows it; the score itself keeps the English one it writes.
 */
export function instrumentName(name) {
  const names = {
    "Piano": tr("Piano"),
    "Electric piano": tr("Electric piano"),
    "Harpsichord": tr("Harpsichord"),
    "Organ": tr("Organ"),
    "Accordion": tr("Accordion"),
    "Celesta": tr("Celesta"),
    "Violin": tr("Violin"),
    "Viola": tr("Viola"),
    "Cello": tr("Cello"),
    "Double bass": tr("Double bass"),
    "Strings": tr("Strings"),
    "Harp": tr("Harp"),
    "Piccolo": tr("Piccolo"),
    "Flute": tr("Flute"),
    "Recorder": tr("Recorder"),
    "Oboe": tr("Oboe"),
    "English horn": tr("English horn"),
    "Clarinet in B♭": tr("Clarinet in B♭"),
    "Clarinet in A": tr("Clarinet in A"),
    "Bassoon": tr("Bassoon"),
    "Soprano sax": tr("Soprano sax"),
    "Alto sax": tr("Alto sax"),
    "Tenor sax": tr("Tenor sax"),
    "Baritone sax": tr("Baritone sax"),
    "Trumpet in B♭": tr("Trumpet in B♭"),
    "Trumpet in C": tr("Trumpet in C"),
    "Horn in F": tr("Horn in F"),
    "Trombone": tr("Trombone"),
    "Tuba": tr("Tuba"),
    "Guitar": tr("Guitar"),
    "Steel-string guitar": tr("Steel-string guitar"),
    "Electric guitar": tr("Electric guitar"),
    "Bass guitar": tr("Bass guitar"),
    "Banjo": tr("Banjo"),
    "Voice": tr("Voice"),
    "Soprano": tr("Soprano"),
    "Alto": tr("Alto"),
    "Tenor": tr("Tenor"),
    "Bass": tr("Bass"),
    "Timpani": tr("Timpani"),
    "Glockenspiel": tr("Glockenspiel"),
    "Xylophone": tr("Xylophone"),
    "Marimba": tr("Marimba"),
    "Vibraphone": tr("Vibraphone"),
    "Tubular bells": tr("Tubular bells"),
    "Drum kit": tr("Drum kit"),
    "Melody": tr("Melody"),
    "Violin I": tr("Violin I"),
    "Violin II": tr("Violin II"),
  };
  return names[name] ?? name;
}

/** The instrument menus' families (score-model.js's INSTRUMENTS), in the page's language. */
function familyWord(family) {
  const names = {
    Keyboards: tr("Keyboards"),
    Strings: tr("Strings"),
    Woodwinds: tr("Woodwinds"),
    Brass: tr("Brass"),
    Guitars: tr("Guitars"),
    Voices: tr("Voices"),
    Percussion: tr("Percussion"),
  };
  return names[family] ?? family;
}

/** A major key by its sharps (+) or flats (−), from C♭ (−7) to C♯ (7), in the page's language. */
function keyWord(fifths) {
  return [
    tr("C♭ major"), tr("G♭ major"), tr("D♭ major"), tr("A♭ major"), tr("E♭ major"), tr("B♭ major"), tr("F major"),
    tr("C major"), tr("G major"), tr("D major"), tr("A major"), tr("E major"), tr("B major"), tr("F♯ major"), tr("C♯ major"),
  ][fifths + 7];
}

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

  // The toolbox's sections fold, and stay as the person left them; until
  // then, those written with all the time are open and the rest folded
  // (sectionOpen). Only a fold by hand is kept: a section opened for a
  // selection (showState) is not.
  const FOLDED = "eui-score-studio-folded";
  let folded = {};
  try {
    folded = JSON.parse(localStorage.getItem(FOLDED) || "{}");
  } catch (error) {}
  const sections = [...root.querySelectorAll("details[data-section]")];
  for (const section of sections) {
    section.open = sectionOpen(section.dataset.section, folded);
    section.querySelector("summary").addEventListener("click", () => {
      // Clicked, it is about to change: folded if it was open.
      folded[section.dataset.section] = section.open;
      try {
        localStorage.setItem(FOLDED, JSON.stringify(folded));
      } catch (error) {}
    });
  }
  let neededBefore = null;
  // What scrolls into the toolbox's view (a button tabbed to, or clicked by
  // a test) stops under the sticky Mode and Duration, not behind them.
  const toolbox = root.querySelector(".studio-toolbox");
  const sticky = root.querySelector(".tool-sticky");
  if (toolbox && sticky && typeof ResizeObserver === "function") {
    const headSize = new ResizeObserver(() => { toolbox.style.scrollPaddingTop = `${sticky.offsetHeight}px`; });
    headSize.observe(sticky);
    ctx.observers.push(headSize);
  }

  // The Playback and Recording panels (#419) open under the arrow that
  // opens them; on a phone, as a sheet from the bottom (the CSS's).
  const narrow = matchMedia("(max-width: 899px)");
  for (const panel of root.querySelectorAll(".studio-panel[popover]")) {
    panel.addEventListener("beforetoggle", (event) => {
      if (event.newState !== "open") return;
      const opener = root.querySelector(`[popovertarget="${panel.id}"]`)?.closest(".studio-split");
      if (!opener || narrow.matches) {
        panel.style.removeProperty("top");
        panel.style.removeProperty("left");
        return;
      }
      const at = opener.getBoundingClientRect();
      const width = Math.min(PANEL_WIDTH, innerWidth - 16);
      panel.style.top = `${Math.round(at.bottom + 6)}px`;
      panel.style.left = `${Math.round(Math.max(8, Math.min(at.left, innerWidth - width - 8)))}px`;
    });
  }
  // The editor's own keys and presses come first (Escape stops note input; a
  // press on the score selects): they close an open panel too, back on its arrow.
  const openPanel = () => root.querySelector(".studio-panel:popover-open");
  document.addEventListener("keydown", (event) => {
    const panel = event.key === "Escape" && openPanel();
    if (!panel) return;
    event.stopPropagation();
    event.preventDefault();
    panel.hidePopover();
    root.querySelector(`[popovertarget="${panel.id}"]`)?.focus();
  }, { capture: true, signal: ctx.signal });
  document.addEventListener("pointerdown", (event) => {
    const panel = openPanel();
    if (panel && !panel.contains(event.target) && !event.target.closest?.(`[popovertarget="${panel.id}"]`)) panel.hidePopover();
  }, { capture: true, signal: ctx.signal });

  // The drum palette, for a drum staff: a button for each drum of the kit.
  const drumRow = root.querySelector("[data-drums]");
  for (const drum of M.DRUMS) {
    const label = drumWord(drum);
    const button = Object.assign(document.createElement("button"), { type: "button", className: "tool", textContent: label, title: `${label} (${drum.name})` });
    button.dataset.act = "drum";
    button.dataset.name = drum.name;
    drumRow?.append(button);
  }

  // The intervals to transpose by; a major second by default.
  const intervalMenu = root.querySelector("[data-transpose-interval]");
  if (intervalMenu) {
    M.INTERVALS.forEach((it, k) => intervalMenu.append(new Option(intervalName(it.name), String(k))));
    intervalMenu.value = String(M.INTERVALS.findIndex((it) => it.name === "major second"));
  }

  // The instrument menus, from INSTRUMENTS by family; the new staff's offers
  // the piano's lower staff too, in the bass clef.
  for (const select of root.querySelectorAll("[data-instruments]")) {
    const families = new Map();
    M.INSTRUMENTS.forEach((it, k) => {
      if (!families.has(it.family)) families.set(it.family, Object.assign(document.createElement("optgroup"), { label: familyWord(it.family) }));
      const group = families.get(it.family);
      // Shown in the page's language; the score writes the English (\instrumentName).
      group.append(new Option(instrumentName(it.name), String(k)));
      if (select.dataset.instruments === "new" && it.name === "Piano") group.append(new Option(tr("Piano, lower staff"), `${k}|bass`));
    });
    select.append(...families.values());
    // A second staff is most often a melody instrument: the violin, as before.
    if (select.dataset.instruments === "new") select.value = String(M.INSTRUMENTS.findIndex((it) => it.name === "Violin"));
  }

  function showState() {
    root.classList.toggle("studio-input", st.input.on);
    root.classList.toggle("studio-playing", Boolean(st.playing));
    // The tools a selection needs, opened when it comes to them.
    const needed = neededSection(st.score, st.sel);
    if (needed !== neededBefore && needed) {
      const section = sections.find((it) => it.dataset.section === needed);
      if (section) section.open = true;
    }
    neededBefore = needed;
    root.classList.toggle("studio-text-only", !st.score);
    // File ▸ Print as PDF names the paper the PDF is printed on: the score's \paper.
    const paper = root.querySelector("[data-pdf-paper]");
    if (paper) paper.textContent = M.paperLabel(st.text);
    notice.hidden = (Boolean(st.score) || !st.unsupported.length) && !(st.score && st.lostNotice);
    if (!st.score && st.unsupported.length) {
      notice.textContent = tr("This piece uses {what}: the score editor does not edit those yet. It is engraved, and its text below can be edited.", { what: st.unsupported.join(", ") });
    } else if (st.score && st.lostNotice) notice.textContent = st.lostNotice;
    for (const button of root.querySelectorAll('[data-act="duration"]')) button.classList.toggle("on", Number(button.dataset.base) === st.input.base);
    const dot = root.querySelector('.studio-toolbox [data-act="dot"]');
    if (dot) {
      dot.classList.toggle("on", st.input.dots > 0);
      // Two dots drawn on the button when the value has two (#469).
      dot.textContent = st.input.dots >= 2 ? "••" : "•";
    }
    // The toolbox's toggles show their state; the menus' items of the same name do not.
    for (const [act, on] of [["mode-input", st.input.on], ["mode-select", !st.input.on]]) {
      const button = root.querySelector(`.studio-toolbox [data-act="${act}"]`);
      button?.classList.toggle("on", on);
      button?.setAttribute("aria-pressed", String(on));
    }
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
    root.querySelector(".studio-play").textContent = !st.playing ? tr("▶ Play") : !handle ? tr("■ Stop") : handle.paused ? tr("▶ Play") : tr("❚❚ Pause");
    root.querySelector('.studio-menu[data-act="stop"]').hidden = !handle;
    renderMix();
    root.querySelector("[data-zoom-label]").textContent = `${Math.round(st.zoom * 100)} %`;
    for (const tool of root.querySelectorAll(".studio-toolbox .tool, .studio-toolbox input, .studio-toolbox select")) tool.disabled = !st.score;
    fillFields();
    // What is selected, in words.
    const value = `${valueWord(st.input.base)}${st.input.dots ? `,${M.dotsWord(st.input.dots)}` : ""}`;
    if (st.playing) showProgress();
    else if (st.input.on) {
      const inPart = M.partOfLane(st.score, st.input.staff);
      const where = inPart ? tr("part {n}", { n: "I".repeat(inPart) }) : M.isLower(st.score, st.input.staff) ? tr("voice {n}", { n: M.voiceOf(st.score, st.input.staff) }) : "";
      state.textContent = [tr("Note input"), where, value, tr("A–G or a click write, 0 or R rest, Esc to stop")].filter(Boolean).join(" · ");
    } else {
      const r = range();
      if (!r) state.textContent = st.score ? tr("Click a note to select it · N to write notes") : tr("Text only");
      else if (r.a !== r.b) state.textContent = tr("{n} selected", { n: r.b - r.a + 1 });
      else {
        const ev = r.staff.events[r.a];
        const len = valueWord(ev.base) + M.dotsWord(ev.dots) + (ev.tuplet ? ` ${tr("({n}-tuplet)", { n: ev.tuplet.n })}` : "");
        // On a \\partCombine staff, the part: Part I, Part II.
        const part = M.partOfLane(st.score, r.s);
        const voice = part ? `${tr("Part {n}", { n: "I".repeat(part) })} · ` : M.isLower(st.score, r.s) ? `${tr("Voice {n}", { n: M.voiceOf(st.score, r.s) })} · ` : "";
        const pitches = ev.pitches.map((p, k) => (k === st.sel.head ? `[${M.pitchName(p.d, p.alter)}]` : M.pitchName(p.d, p.alter))).join(" ");
        state.textContent = voice + (ev.rest ? tr("Rest · {value}", { value: len }) : ev.pitches.length > 1 ? tr("Chord {pitches} · {value}", { pitches, value: len }) : tr("Note {pitches} · {value}", { pitches, value: len }));
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
        const other = new Option(tr("Other: {instrument}", { instrument: staff.instrument }), "other");
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
      const other = new Option(tr("Other: {pickup}", { pickup: `\\partial ${value}` }), value);
      other.dataset.other = "";
      field.append(other);
    }
    field.value = value;
  }

  /** The changes section: the bar's own changes, and what is in force there otherwise. */
  function fillChanges(set) {
    const b = changeBar();
    const section = root.querySelector("[data-changes]");
    if (!section) return;
    const on = b != null && b > 0;
    section.querySelector("[data-change-bar]").textContent = b == null ? "—" : String(barNo(b));
    section.querySelector("[data-change-hint]").textContent = b == null
      ? tr("Select a bar, or put the cursor in it: what changes here goes on to the next change.")
      : b === 0
        ? st.score.pickup
          ? tr("Bar {n} is the piece's start, its pickup: its key, metre and tempo are in File ▸ Score properties, its clef under This staff.", { n: barNo(0) })
          : tr("Bar {n} is the piece's start: its key, metre and tempo are in File ▸ Score properties, its clef under This staff.", { n: barNo(0) })
        : tr("What changes here goes on to the next change.");
    for (const el of section.querySelectorAll("[data-field]")) el.disabled = !on;
    if (!on) return;
    const s = staffOf();
    const c = M.changeAt(st.score, b);
    const was = { key: M.keyOf(st.score, s, M.barStart(st.score, b - 1)), time: M.timeAt(st.score, b - 1), clef: M.clefAt(st.score, s, b - 1), tempo: M.tempoAt(st.score, b - 1) };
    const first = (field, text) => {
      const option = section.querySelector(`[data-field="${field}"] option[value=""]`);
      if (option) option.textContent = tr("As before: {was}", { was: text });
    };
    first("change-key", keyWord(was.key));
    first("change-time", was.time.join("/"));
    // The clef as the menu names it where the page has words of its own; else as LilyPond does.
    const clefOption = globalThis.EUI_WORDS ? section.querySelector(`[data-field="change-clef"] option[value="${CSS.escape(was.clef)}"]`) : null;
    first("change-clef", clefOption?.textContent ?? was.clef.replace("_8", " 8"));
    section.querySelector('[data-field="change-bpm"]').placeholder = was.tempo?.bpm ? tr("as before: {bpm}", { bpm: was.tempo.bpm }) : tr("as before");
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
        case "bpm": score.tempo = { ...(score.tempo ?? { text: "" }), base: score.tempo?.base || 4, bpm: Number(value) || 0 }; break;
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
          M.setTempoAt(score, b, el.dataset.field === "change-bpm" ? { ...here, base: here.base || 4, bpm: Number(value) || 0 } : { ...here, text: value });
          break;
        }
        case "change-clef": M.setClefAt(score, staffOf(), changeBar(), value || null); break;
        case "change-double": M.setDoubleBar(score, changeBar(), el.checked); break;
        case "staff-instrument": if (value !== "other") M.setInstrument(score, staffOf(), Number(value)); break;
      }
    });
  }

  return { mac, showState, onField, intervalName, instrumentName };
}
