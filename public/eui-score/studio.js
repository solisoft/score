// The score editor of the playground: a menu bar, a toolbox, the score, and
// its LilyPond source under it.
//
// The score is a model (score-model.js); every edit changes the model, the
// model writes the LilyPond, eui-score (WebAssembly) engraves it and says
// where each note is drawn. A source the model cannot hold — repeats, two
// voices on a staff… — is still engraved and its text can be edited; the
// notice says what it uses, and the score tools wait.
//
// The page's markup (app/views/playground/show.html.slv) carries the
// controls: `data-act` on what does something, `data-field` on what holds a
// setting. Nothing here is set up twice: `startStudio` runs from the page's
// inline module script, once per visit.

// Served immutable: this module's version goes to the ones it loads.
const V = new URL(import.meta.url).search;
const { loaded, toMidi, toPdf, download, engine } = await import(`./eui-score.js${V}`);
const M = await import(`./score-model.js${V}`);
const P = await import(`./player.js${V}`);
const { editor_view_lit, score_json } = engine;

const COLOURS = { selection: "#b4373a", head: "#e0662a", cursor: "#2563c9", playing: "#0f9d47" };
const DRAFT = "eui-score-studio-draft";
const KEY_DURATIONS = { 2: 32, 3: 16, 4: 8, 5: 4, 6: 2, 7: 1 };
const LETTERS = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };

export function startStudio(root, options = {}) {
  const $ = (selector) => root.querySelector(selector);
  const sheet = $("[data-sheet]");
  const sourceBox = $("[data-source]");
  const status = $("[data-status]");
  const state = $("[data-state]");
  const notice = $("[data-notice]");
  // The engraving goes in its own box: redrawing it leaves the words being
  // typed — absolutely placed beside it — where they are, focused.
  const svgHost = document.createElement("div");
  svgHost.className = "studio-svg";
  svgHost.append(...sheet.childNodes);
  sheet.appendChild(svgHost);
  // Over the drawing: the selected bars, and the edges of each repeat to drag.
  const overlay = document.createElement("div");
  overlay.className = "studio-overlay";
  sheet.appendChild(overlay);

  // The playhead: a band over the column being played, every staff of it.
  const playhead = document.createElement("div");
  playhead.className = "studio-playhead";
  playhead.hidden = true;
  sheet.appendChild(playhead);

  const st = {
    score: null, // the model, or null when the text is all there is
    text: sourceBox.value,
    unsupported: [],
    items: [], // item number → { staff, index }
    view: null,
    sel: null, // { staff, t0, t1, head } — times, so an edit that merges rests keeps it
    input: { on: false, t: 0, staff: 0, base: 4, dots: 0, last: null },
    past: [],
    future: [],
    clip: null,
    zoom: 1,
    playing: null,
    drag: null,
  };
  // For a console or a test: the studio's state, on its element.
  root.studio = st;

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

  // ---- Model ↔ text ----------------------------------------------------------

  function readText(text) {
    st.text = text;
    try {
      const result = M.fromParsed(JSON.parse(score_json(text)));
      st.score = result.score ?? null;
      st.unsupported = result.unsupported ?? [];
    } catch (error) {
      st.score = null;
      st.unsupported = [];
    }
  }

  function writeText() {
    if (!st.score) return;
    const { source, items } = M.toLilyPond(st.score);
    st.text = source;
    st.items = items;
    if (sourceBox.value !== source) sourceBox.value = source;
  }

  function snapshot() {
    return JSON.stringify({ score: st.score, text: st.text, sel: st.sel, input: st.input });
  }

  function restore(snap) {
    const s = JSON.parse(snap);
    st.score = s.score;
    st.text = s.text;
    st.sel = s.sel;
    st.input = s.input;
    st.unsupported = [];
    if (st.score) writeText();
    else {
      sourceBox.value = st.text;
      readText(st.text);
    }
  }

  /** Runs `fn` on the model as one undoable edit; a refusal leaves everything as it was. */
  function edit(fn, { keepFuture = false } = {}) {
    if (!st.score) return say("The score tools wait: this piece is edited in its text below.", true);
    const before = snapshot();
    try {
      fn(st.score);
    } catch (error) {
      restore(before);
      return say(error.message ?? String(error), true);
    }
    writeText();
    // Nothing changed: no step to undo.
    if (st.text === JSON.parse(before).text) {
      draw();
      return true;
    }
    try {
      JSON.parse(editor_view_lit(st.text, 600, 7, "{}"));
    } catch (error) {
      restore(before);
      return say(`The engraver refuses that: ${error.message ?? error}`, true);
    }
    st.past.push(before);
    if (st.past.length > 300) st.past.shift();
    if (!keepFuture) st.future = [];
    if (status.dataset.fresh !== "1") say("");
    delete status.dataset.fresh;
    saveDraft();
    draw();
    return true;
  }

  function undo() {
    if (!st.past.length) return;
    st.future.push(snapshot());
    restore(st.past.pop());
    saveDraft();
    draw();
  }

  function redo() {
    if (!st.future.length) return;
    st.past.push(snapshot());
    restore(st.future.pop());
    saveDraft();
    draw();
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT, st.text);
    } catch (error) {}
  }

  function load(text, message) {
    st.past.push(snapshot());
    st.future = [];
    sourceBox.value = text;
    readText(text);
    if (st.score) writeText();
    st.sel = null;
    st.input = { ...st.input, on: false, t: 0, staff: 0, last: null };
    saveDraft();
    draw();
    if (message) say(message);
  }

  // ---- Selection, in times -------------------------------------------------------

  /** The bar the changes section acts on: the cursor's, or the selection's first; null when none. */
  function changeBar() {
    if (!st.score) return null;
    if (st.input.on) return Math.min(M.barAt(st.score, st.input.t), M.barsOf(st.score) - 1);
    if (!st.sel) return null;
    return st.sel.bars?.[0] ?? M.barAt(st.score, Math.min(st.sel.t0, st.sel.t1));
  }

  function staffOf() {
    return st.input.on ? st.input.staff : st.sel?.staff ?? 0;
  }

  /** The selected events' indices, first and last, or null. */
  function range() {
    if (!st.sel || !st.score) return null;
    const staff = st.score.staves[st.sel.staff];
    if (!staff) return null;
    const at = M.starts(staff);
    const indexAt = (t) => {
      let found = -1;
      at.forEach((start, i) => {
        if (start <= t) found = i;
      });
      return found;
    };
    const a = indexAt(st.sel.t0);
    const b = indexAt(st.sel.t1);
    return a < 0 ? null : { s: st.sel.staff, a: Math.min(a, b), b: Math.max(a, b), staff };
  }

  function select(s, index, head = -1, extend = false) {
    const staff = st.score?.staves[s];
    if (!staff) {
      st.sel = null;
      return draw();
    }
    const t = M.starts(staff)[index];
    if (extend && st.sel && st.sel.staff === s) st.sel = { ...st.sel, t1: t, head: -1 };
    else st.sel = { staff: s, t0: t, t1: t, head };
    say("");
    draw();
  }

  /** The one event the tools act on: the selection's first, or the note just written. */
  function target() {
    if (st.input.on && st.input.last) {
      const staff = st.score.staves[st.input.last.staff];
      const i = M.eventAt(staff, st.input.last.t);
      if (i >= 0) return { s: st.input.last.staff, i, head: -1 };
    }
    const r = range();
    return r ? { s: r.s, i: r.a, head: st.sel.head } : null;
  }

  function need() {
    const t = target();
    if (!t) throw new Error("Select a note first — click it, or press N to write notes");
    return t;
  }

  /** The selection kept on the event that now starts at `t`. */
  function keepOn(s, t) {
    st.sel = { staff: s, t0: t, t1: t, head: st.sel?.head ?? -1 };
  }

  // ---- Note input ---------------------------------------------------------------

  function inputTicks() {
    return M.notated(st.input.base, st.input.dots);
  }

  function setInput(on) {
    if (on && st.score) {
      const r = range();
      st.input.staff = r ? r.s : 0;
      st.input.t = r ? M.starts(r.staff)[r.a] : 0;
      st.input.last = null;
    }
    st.input.on = Boolean(on && st.score);
    draw();
  }

  /** Writes a note (pitch step) or a rest (null) at the cursor, and moves on. */
  function inputWrite(step, add) {
    edit((score) => {
      const s = st.input.staff;
      if (add) {
        // The note just written; else the note at the cursor, or the one before it.
        const staff = score.staves[s];
        const at = M.starts(staff);
        const last = st.input.last && M.eventAt(score.staves[st.input.last.staff], st.input.last.t);
        let lane = s;
        let i = -1;
        if (st.input.last && last >= 0) [lane, i] = [st.input.last.staff, last];
        else {
          const here = at.findLastIndex((t) => t <= st.input.t);
          const before = at.findLastIndex((t) => t < st.input.t);
          i = staff.events[here] && !staff.events[here].rest && at[here] === st.input.t ? here : before;
        }
        if (i < 0 || score.staves[lane].events[i].rest) throw new Error("Shift+letter adds to a note's chord: write a note, or put the cursor on one");
        M.letter(score, lane, i, step, true);
        st.input.last = { staff: lane, t: M.starts(score.staves[lane])[i] };
        return;
      }
      const staff = score.staves[s];
      M.ensureLength(score, st.input.t + 1);
      let i = M.eventAt(staff, st.input.t);
      const ev = staff.events[i];
      if (ev?.tuplet) {
        // Into a tuplet's slot: the slot keeps its value.
        if (step === null) M.remove(score, s, i);
        else {
          if (!ev.rest) M.remove(score, s, i);
          i = M.eventAt(staff, st.input.t);
          M.letter(score, s, i, step);
        }
        const len = M.ticksOf(staff.events[M.eventAt(staff, st.input.t)]);
        st.input.last = step === null ? null : { staff: s, t: st.input.t };
        st.input.t += len;
      } else {
        const near = M.previousPitch(score, s, i < 0 ? staff.events.length : i);
        const content = step === null ? { rest: true } : { rest: false, pitches: [M.nearestPitch(step, near, M.keyOf(score, s))] };
        M.write(score, s, st.input.t, inputTicks(), content);
        st.input.last = step === null ? null : { staff: s, t: st.input.t };
        st.input.t += inputTicks();
      }
      // Always room to write into.
      M.ensureLength(score, st.input.t + 1);
    });
  }

  function inputBack() {
    edit((score) => {
      const staff = score.staves[st.input.staff];
      const at = M.starts(staff);
      const i = at.findLastIndex((t) => t < st.input.t);
      if (i < 0) return;
      M.remove(score, st.input.staff, i);
      st.input.t = at[i];
      st.input.last = null;
    });
  }

  function inputTuplet(n) {
    edit((score) => {
      const s = st.input.staff;
      const staff = score.staves[s];
      const i = M.eventAt(staff, st.input.t);
      if (i >= 0 && staff.events[i].tuplet) throw new Error("already in a tuplet");
      M.tupletAt(score, s, st.input.t, inputTicks(), n);
    });
  }

  // ---- Actions ------------------------------------------------------------------

  function act(name, data = {}) {
    switch (name) {
      case "new": return load(M.toLilyPond(M.newScore()).source, "A new score.");
      case "undo": return undo();
      case "redo": return redo();
      case "play": return togglePlay();
      case "zoom-in": st.zoom = Math.min(2, Math.round((st.zoom + 0.1) * 10) / 10); return draw();
      case "zoom-out": st.zoom = Math.max(0.5, Math.round((st.zoom - 0.1) * 10) / 10); return draw();
      case "save-ly": return download(st.text, `${fileName()}.ly`, "text/x-lilypond");
      case "save-pdf": return toPdf(st.text, title()).then((pdf) => download(pdf, `${fileName()}.pdf`, "application/pdf")).catch((e) => say(e.message ?? String(e), true));
      case "save-midi": return toMidi(st.text).then((m) => download(m, `${fileName()}.mid`, "audio/midi")).catch((e) => say(e.message ?? String(e), true));
      case "mode-select": return setInput(false);
      case "mode-input": return setInput(true);
      case "duration": return duration(Number(data.base), st.input.on ? st.input.dots : 0);
      case "dot": return toggleDot();
      case "letter": {
        const add = data.add || root.querySelector("[data-chord-mode]")?.checked;
        if (st.input.on) return inputWrite(Number(data.step), add);
        return edit((score) => {
          const t = need();
          M.letter(score, t.s, t.i, Number(data.step), add, t.head);
        });
      }
      case "rest":
        if (st.input.on) return inputWrite(null);
        return edit((score) => {
          const r = range() ?? (() => { throw new Error("Select a note first"); })();
          for (let i = r.b; i >= r.a; i--) M.remove(score, r.s, i, r.a === r.b ? st.sel.head : -1);
        });
      case "move": return edit((score) => {
        const r = range();
        if (st.input.on || !r || r.a === r.b) {
          const t = need();
          M.move(score, t.s, t.i, data.how, Number(data.by), t.head);
          return;
        }
        for (let i = r.a; i <= r.b; i++) if (!r.staff.events[i].rest) M.move(score, r.s, i, data.how, Number(data.by));
      });
      case "alter": return edit((score) => {
        const t = need();
        M.setAlter(score, t.s, t.i, Number(data.alter), t.head);
      });
      case "tuplet":
        if (st.input.on) return inputTuplet(Number(data.n));
        return edit((score) => {
          const t = need();
          M.makeTuplet(score, t.s, t.i, Number(data.n));
        });
      case "untuplet": return edit((score) => {
        const t = need();
        const i = M.removeTuplet(score, t.s, t.i);
        keepOn(t.s, M.starts(score.staves[t.s])[i]);
      });
      case "tie":
        if (st.input.on && st.input.last) {
          // In note input, T writes the same note again, tied.
          return edit((score) => {
            const { staff: s, t } = st.input.last;
            const i = M.eventAt(score.staves[s], t);
            const ev = score.staves[s].events[i];
            M.write(score, s, st.input.t, inputTicks(), { rest: false, pitches: ev.pitches.map((p) => ({ ...p })) });
            M.toggleTie(score, s, M.eventAt(score.staves[s], t));
            st.input.last = { staff: s, t: st.input.t };
            st.input.t += inputTicks();
            M.ensureLength(score, st.input.t + 1);
          });
        }
        return edit((score) => {
          const t = need();
          M.toggleTie(score, t.s, t.i);
        });
      case "slur": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select the notes to slur: click the first, Shift+click the last"); })();
        M.toggleSlur(score, r.s, r.a, r.b);
      });
      case "hairpin": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select the notes the hairpin spans"); })();
        M.setHairpin(score, r.s, r.a, r.b, data.kind);
      });
      case "art": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select a note first"); })();
        for (let i = r.a; i <= r.b; i++) if (!r.staff.events[i].rest || data.name === "fermata") M.toggleArticulation(score, r.s, i, data.name);
      });
      case "dynamic": return edit((score) => {
        const t = need();
        M.setDynamic(score, t.s, t.i, data.name);
      });
      case "lyrics": return openWords("lyric");
      case "chord": return openWords("chord");
      case "repeat": return edit((score) => {
        const [a, b] = selectedBars();
        M.toggleRepeat(score, a, b);
        say(`Bars ${a + 1}–${b + 1}${(score.repeats ?? []).some((r) => r.from === a && r.to === b) ? " repeated" : ": repeat taken away"}`);
      });
      case "ending": return edit((score) => {
        const [a, b] = selectedBars();
        const ending = M.endingFromBars(score, a, b);
        const r = score.repeats.find((x) => x.to < a && M.repeatEnd(x) >= b);
        const at = (k) => r.to + 2 + r.endings.slice(0, k).reduce((x, y) => x + y, 0);
        const bars = (k) => (r.endings[k] > 1 ? `bars ${at(k)}–${at(k) + r.endings[k] - 1}` : `bar ${at(k)}`);
        say(ending === 1
          ? `Ending 1: ${bars(0)} · ending 2: ${bars(1)} — drag the 2. handle to change it`
          : `Ending ${ending + 1}: ${bars(ending)}`);
      });
      case "endings": return edit((score) => {
        const [a, b] = selectedBars();
        M.addEndings(score, a, b);
      });
      case "unrepeat": return edit((score) => M.removeRepeat(score, selectedBars()[0]));
      case "add-bar": return edit((score) => M.addBars(score, 1));
      case "remove-bar": return edit((score) => M.removeLastBar(score));
      case "add-staff": return edit((score) => {
        const [k, clef] = root.querySelector('[data-field="new-staff"]').value.split("|");
        const it = M.INSTRUMENTS[Number(k)] ?? M.INSTRUMENTS[0];
        M.addStaff(score, { instrument: it.sound, name: it.name, short: it.short, clef: clef || it.clef || "treble" });
        st.sel = { staff: score.staves.length - 1, t0: 0, t1: 0, head: -1 };
      });
      case "voice": return toVoice(Number(data.voice));
      case "voice-remove": return edit((score) => {
        const s = staffOf();
        const upper = M.upperOf(score, s);
        M.removeVoice(score, s);
        // The lanes after the one taken away move up by one.
        const moved = (lane) => (lane === upper + 1 ? upper : lane > upper + 1 ? lane - 1 : lane);
        if (st.sel) st.sel = { ...st.sel, staff: moved(st.sel.staff), head: -1 };
        st.input.staff = moved(st.input.staff);
        say("Voice 2 taken away");
      });
      case "remove-staff": return edit((score) => {
        M.removeStaff(score, staffOf());
        st.sel = null;
        st.input.staff = 0;
      });
      case "copy": return copy(false);
      case "cut": return copy(true);
      case "paste": return paste();
      case "next": case "previous": return step(name === "next" ? 1 : -1, data.extend);
      case "head-up": case "head-down": return chordHead(name === "head-up" ? 1 : -1);
    }
  }

  /** The bars the selection (or the input cursor) spans, first and last. */
  function selectedBars() {
    if (st.input.on) {
      const b = M.barAt(st.score, st.input.t);
      return [b, b];
    }
    if (!st.sel) throw new Error("Select the bars — drag across them, or click the first and Shift+click the last");
    if (st.sel.bars) return st.sel.bars;
    const a = M.barAt(st.score, Math.min(st.sel.t0, st.sel.t1));
    const b = M.barAt(st.score, Math.max(st.sel.t0, st.sel.t1));
    return [a, b];
  }

  function duration(base, dots) {
    st.input.base = base;
    st.input.dots = dots;
    if (st.input.on || !range()) return draw();
    edit((score) => {
      const t = need();
      const start = M.starts(score.staves[t.s])[t.i];
      M.setDuration(score, t.s, t.i, base, dots);
      keepOn(t.s, start);
    });
  }

  function toggleDot() {
    if (st.input.on || !range()) {
      st.input.dots = st.input.dots ? 0 : 1;
      return draw();
    }
    const t = target();
    const ev = st.score.staves[t.s].events[t.i];
    duration(ev.base, ev.dots ? 0 : 1);
  }

  function step(by, extend) {
    if (!st.score) return;
    if (st.input.on) {
      const staff = st.score.staves[st.input.staff];
      const at = M.starts(staff);
      const i = at.findLastIndex((t) => t <= st.input.t);
      const next = Math.max(0, Math.min(at.length - 1, i + by));
      st.input.t = at[next];
      st.input.last = null;
      return draw();
    }
    const r = range();
    if (!r) return select(0, 0);
    const edge = extend ? M.starts(r.staff).indexOf(st.sel.t1) : by > 0 ? r.b : r.a;
    const next = Math.max(0, Math.min(r.staff.events.length - 1, edge + by));
    select(r.s, next, -1, extend);
  }

  function chordHead(by) {
    const t = target();
    if (!t) return;
    const ev = st.score.staves[t.s].events[t.i];
    if (ev.pitches.length < 2) return;
    const head = st.sel?.head ?? -1;
    const next = head < 0 ? (by > 0 ? ev.pitches.length - 1 : 0) : Math.max(0, Math.min(ev.pitches.length - 1, head + by));
    st.sel = { ...st.sel, head: next };
    draw();
  }

  function copy(cut) {
    const r = range();
    if (!r) return say("Select what to copy", true);
    try {
      st.clip = M.copy(st.score, r.s, r.a, r.b);
      say(`${r.b - r.a + 1} copied`);
    } catch (error) {
      return say(error.message, true);
    }
    if (cut) edit((score) => {
      for (let i = r.b; i >= r.a; i--) M.remove(score, r.s, i);
    });
  }

  function paste() {
    if (!st.clip) return say("Nothing copied yet", true);
    const s = st.input.on ? st.input.staff : st.sel?.staff;
    const t = st.input.on ? st.input.t : st.sel?.t0;
    if (s == null || t == null) return say("Select where to paste", true);
    edit((score) => {
      M.paste(score, s, t, st.clip);
      const end = t + st.clip.reduce((sum, p) => sum + p.ticks, 0);
      if (st.input.on) st.input.t = end;
    });
  }

  // ---- Lyrics and chord symbols ----------------------------------------------------

  let wordsBox = null;

  function openWords(kind) {
    let t = target();
    if (!t || !st.score) return say("Select a note first", true);
    closeWords();
    if (kind === "lyric") {
      const staff = st.score.staves[t.s];
      const skip = M.melismata(staff);
      if (staff.events[t.i].rest) return say("A syllable goes under a note: select a note", true);
      if (skip[t.i]) {
        // A note held from an earlier one (a tie, a slur) sings that note's syllable.
        let i = t.i;
        while (i > 0 && skip[i]) i--;
        t = { ...t, i };
        st.sel = { staff: t.s, t0: M.starts(staff)[i], t1: M.starts(staff)[i], head: -1 };
        say("That note is held from the one before (tie or slur): its syllable goes here.");
        draw();
      }
    }
    const ev = st.score.staves[t.s].events[t.i];
    const box = Object.assign(document.createElement("input"), { type: "text", className: `studio-words studio-words-${kind}` });
    box.value = kind === "lyric" ? ev.lyric?.text ?? "" : ev.chord ?? "";
    box.placeholder = kind === "lyric" ? "syllable" : "Am7";
    box.setAttribute("aria-label", kind === "lyric" ? "Syllable — Space next note, - hyphen, Enter done" : "Chord symbol — Space next note, Enter done");
    sheet.appendChild(box);
    wordsBox = { box, kind, s: t.s, t: M.starts(st.score.staves[t.s])[t.i] };
    placeWords();
    box.focus();
    box.select();
    box.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeWords();
        sheet.focus();
      } else if (event.key === "Enter") {
        event.preventDefault();
        commitWords();
        closeWords();
        sheet.focus();
      } else if (event.key === " " || event.key === "Tab" || (event.key === "-" && kind === "lyric")) {
        event.preventDefault();
        commitWords({ hyphen: event.key === "-" });
        nextWords();
      }
    });
    box.addEventListener("blur", () => setTimeout(() => {
      if (wordsBox?.box === box && document.activeElement !== box) {
        commitWords();
        closeWords();
      }
    }, 0));
  }

  function commitWords(extra = {}) {
    if (!wordsBox) return;
    const { box, kind, s, t } = wordsBox;
    const value = box.value;
    edit((score) => {
      const i = M.eventAt(score.staves[s], t);
      if (kind === "lyric") {
        if (score.staves[s].events[i].rest) return;
        M.setLyric(score, s, i, value, Boolean(extra.hyphen));
      } else M.setChordSymbol(score, s, i, value);
    });
  }

  function nextWords() {
    if (!wordsBox) return;
    const { kind, s, t } = wordsBox;
    const staff = st.score.staves[s];
    const at = M.starts(staff);
    let i = M.eventAt(staff, t) + 1;
    // Lyrics skip rests, tied-to notes and the notes under a slur (as
    // LilyPond sets them); a chord symbol goes on any note.
    const skip = M.melismata(staff);
    while (i < staff.events.length && (staff.events[i].rest || (kind === "lyric" && skip[i]))) i++;
    if (i >= staff.events.length) return closeWords();
    st.sel = { staff: s, t0: at[i], t1: at[i], head: -1 };
    draw();
    const ev = staff.events[i];
    wordsBox.t = at[i];
    wordsBox.box.value = kind === "lyric" ? ev.lyric?.text ?? "" : ev.chord ?? "";
    placeWords();
    wordsBox.box.focus();
    wordsBox.box.select();
  }

  /** Where the drawing is: its origin in the sheet's pixels, and its scale. */
  function geometry() {
    const svg = svgHost.querySelector("svg");
    if (!svg || !st.view) return null;
    const rect = svg.getBoundingClientRect();
    const frame = sheet.getBoundingClientRect();
    const scale = rect.width / st.view.width;
    const y0 = st.view.y0 ?? 0;
    return {
      scale,
      rect,
      // A point of the drawing, in the sheet's pixels.
      at: (x, y) => ({ x: rect.left - frame.left + sheet.scrollLeft + x * scale, y: rect.top - frame.top + sheet.scrollTop + (y - y0) * scale }),
    };
  }

  function closeWords() {
    wordsBox?.box.remove();
    wordsBox = null;
  }

  function placeWords() {
    if (!wordsBox || !st.view) return;
    const k = st.items.findIndex((it) => it.staff === wordsBox.s && M.starts(st.score.staves[it.staff])[it.index] === wordsBox.t);
    const item = st.view.items.find((it) => it.item === k);
    const g = geometry();
    if (!item || !g) return;
    const [x0, y0, , y1] = item.box;
    const corner = g.at(x0, wordsBox.kind === "lyric" ? y1 : y0);
    wordsBox.box.style.left = `${corner.x - 6}px`;
    wordsBox.box.style.top = wordsBox.kind === "lyric" ? `${corner.y + 8}px` : `${Math.max(0, corner.y - 36)}px`;
  }

  // ---- Drawing ------------------------------------------------------------------

  function lit() {
    const items = {};
    const heads = [];
    const itemOf = (s, i) => st.items.findIndex((it) => it.staff === s && it.index === i);
    const r = range();
    if (r && !st.input.on) {
      for (let i = r.a; i <= r.b; i++) items[itemOf(r.s, i)] = COLOURS.selection;
      if (st.sel.head >= 0 && r.a === r.b) heads.push([itemOf(r.s, r.a), st.sel.head, COLOURS.head]);
    }
    if (st.input.on && st.score) {
      const staff = st.score.staves[st.input.staff];
      const i = M.starts(staff).findLastIndex((t) => t <= st.input.t);
      if (i >= 0) items[itemOf(st.input.staff, i)] = COLOURS.cursor;
    }
    if (st.playing?.now) for (const k of st.playing.now) items[k] = COLOURS.playing;
    return JSON.stringify({ items, heads });
  }

  async function draw() {
    await loaded();
    // Drawn: the text, with the second voice's bars opened where the page writes in them.
    let shown = st.text;
    if (st.score) {
      const { source, items } = M.toLilyPond(st.score, { open: openBars() });
      st.items = items;
      shown = source;
    }
    const width = Math.max(320, Math.floor(sheet.clientWidth - 2));
    const space = 8 * st.zoom;
    try {
      st.view = JSON.parse(editor_view_lit(shown, width, space, st.score ? lit() : "{}"));
      svgHost.innerHTML = st.view.svg;
      sheet.classList.remove("studio-sheet-refused");
    } catch (error) {
      st.view = null;
      svgHost.innerHTML = "";
      sheet.classList.add("studio-sheet-refused");
      say(error.message ?? String(error), true);
    }
    if (wordsBox) placeWords();
    placeOverlay();
    placePlayhead();
    showState();
  }

  /** The bars of a second voice the cursor or the selection is in: written even while they are rests. */
  function openBars() {
    const s = st.input.on ? st.input.staff : st.sel?.staff;
    if (s == null || !M.isLower(st.score, s)) return [];
    const [t0, t1] = st.input.on ? [st.input.t, st.input.t] : [Math.min(st.sel.t0, st.sel.t1), Math.max(st.sel.t0, st.sel.t1)];
    const last = M.barsOf(st.score) - 1;
    const out = [];
    for (let bar = Math.min(M.barAt(st.score, t0), last); bar <= Math.min(M.barAt(st.score, t1), last); bar++) out.push({ staff: s, bar });
    return out;
  }

  /** The cursor or the selection moved to the other voice of its staff, at the same time; voice 2 made when needed. */
  function toVoice(voice) {
    if (!st.score) return;
    const s = staffOf();
    const upper = M.upperOf(st.score, s);
    let lane = upper;
    if (voice === 2) {
      lane = M.lowerOf(st.score, upper);
      if (lane < 0) {
        // A voice of rests: nothing in the text changes, so no step to undo.
        lane = M.addVoice(st.score, upper);
        if (st.input.on && st.input.staff > upper) st.input.staff++;
      }
    }
    if (st.input.on) {
      st.input.staff = lane;
      st.input.last = null;
    } else if (st.sel) {
      const at = M.starts(st.score.staves[lane]);
      const t = Math.min(st.sel.t0, st.sel.t1);
      const start = Math.max(...at.filter((x) => x <= t));
      st.sel = { staff: lane, t0: start, t1: start, head: -1 };
    } else {
      st.sel = { staff: lane, t0: 0, t1: 0, head: -1 };
    }
    say(voice === 2 ? "Voice 2: notes written now go under voice 1, stems down" : "Voice 1");
    draw();
  }

  function showState() {
    root.classList.toggle("studio-input", st.input.on);
    root.classList.toggle("studio-text-only", !st.score);
    notice.hidden = Boolean(st.score) || !st.unsupported.length;
    if (!st.score && st.unsupported.length) {
      notice.textContent = `This piece uses ${st.unsupported.join(", ")}: the score editor does not edit those yet. It is engraved, and its text below can be edited.`;
    }
    for (const button of root.querySelectorAll('[data-act="duration"]')) button.classList.toggle("on", Number(button.dataset.base) === st.input.base);
    root.querySelector('[data-act="dot"]')?.classList.toggle("on", st.input.dots > 0);
    root.querySelector('[data-act="mode-input"]')?.classList.toggle("on", st.input.on);
    root.querySelector('[data-act="mode-select"]')?.classList.toggle("on", !st.input.on);
    const second = st.score ? M.isLower(st.score, staffOf()) : false;
    root.querySelector('[data-act="voice"][data-voice="1"]')?.classList.toggle("on", Boolean(st.score) && !second);
    root.querySelector('[data-act="voice"][data-voice="2"]')?.classList.toggle("on", second);
    root.querySelector('[data-act="undo"]').disabled = !st.past.length;
    root.querySelector('[data-act="redo"]').disabled = !st.future.length;
    root.querySelector('[data-act="play"]').textContent = st.playing ? "■ Stop" : "▶ Play";
    root.querySelector("[data-zoom-label]").textContent = `${Math.round(st.zoom * 100)} %`;
    for (const tool of root.querySelectorAll(".studio-toolbox .tool, .studio-toolbox input, .studio-toolbox select")) tool.disabled = !st.score;
    fillFields();
    // What is selected, in words.
    const value = `${({ 1: "whole", 2: "half", 4: "quarter", 8: "eighth", 16: "16th", 32: "32nd" })[st.input.base]}${st.input.dots ? ", dotted" : ""}`;
    if (st.playing) showProgress();
    else if (st.input.on) state.textContent = `Note input${M.isLower(st.score, st.input.staff) ? " · voice 2" : ""} · ${value} · A–G write, 0 rest, Esc to stop`;
    else {
      const r = range();
      if (!r) state.textContent = st.score ? "Click a note to select it · N to write notes" : "Text only";
      else if (r.a !== r.b) state.textContent = `${r.b - r.a + 1} selected`;
      else {
        const ev = r.staff.events[r.a];
        const len = ({ 1: "whole", 2: "half", 4: "quarter", 8: "eighth", 16: "16th", 32: "32nd" })[ev.base] + (ev.dots ? " dotted" : "") + (ev.tuplet ? ` (${ev.tuplet.n}-tuplet)` : "");
        state.textContent = (M.isLower(st.score, r.s) ? "Voice 2 · " : "") + (ev.rest ? `Rest · ${len}` : `${ev.pitches.length > 1 ? "Chord" : "Note"} ${ev.pitches.map((p, k) => (k === st.sel.head ? `[${M.pitchName(p.d, p.alter)}]` : M.pitchName(p.d, p.alter))).join(" ")} · ${len}`);
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
    set("key", String(st.score.key));
    set("time", `${st.score.time[0]}/${st.score.time[1]}`);
    set("bpm", st.score.tempo?.bpm || "");
    set("tempo-text", st.score.tempo?.text || "");
    set("group", st.score.group);
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

  const KEY_NAMES = ["C♭", "G♭", "D♭", "A♭", "E♭", "B♭", "F", "C", "G", "D", "A", "E", "B", "F♯", "C♯"];

  /** The changes section: the bar's own changes, and what is in force there otherwise. */
  function fillChanges(set) {
    const b = changeBar();
    const section = root.querySelector("[data-changes]");
    if (!section) return;
    const on = b != null && b > 0;
    section.querySelector("[data-change-bar]").textContent = b == null ? "—" : String(b + 1);
    section.querySelector("[data-change-hint]").textContent = b == null
      ? "Select a bar, or put the cursor in it: what changes here goes on to the next change."
      : b === 0 ? "Bar 1 is the piece's start: its key, metre and tempo are under Score, its clef under This staff." : "What changes here goes on to the next change.";
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
        case "title": case "subtitle": case "composer": score.header[el.dataset.field] = value; break;
        case "key": M.setKey(score, Number(value)); break;
        case "time": { const [n, d] = value.split("/").map(Number); M.setTime(score, n, d); break; }
        case "bpm": score.tempo = { ...(score.tempo ?? { text: "", base: 4 }), bpm: Number(value) || 0 }; break;
        case "tempo-text": score.tempo = { ...(score.tempo ?? { base: 4, bpm: 0 }), text: value }; break;
        case "group": score.group = value; break;
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

  function say(message, error = false) {
    // Said during an edit: it outlives the edit's own clearing.
    status.dataset.fresh = "1";
    queueMicrotask(() => delete status.dataset.fresh);
    status.textContent = message;
    status.classList.toggle("studio-error", error);
    return false;
  }

  function title() {
    return st.score?.header.title || (st.text.match(/title\s*=\s*"([^"]*)"/)?.[1] ?? "score");
  }

  function fileName() {
    return title().trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "score";
  }

  // ---- Pointer ------------------------------------------------------------------

  /** The drawing's point under the pointer. */
  function point(event) {
    const g = geometry();
    if (!g) return null;
    return { x: (event.clientX - g.rect.left) / g.scale, y: (event.clientY - g.rect.top) / g.scale + (st.view.y0 ?? 0), scale: g.scale };
  }

  /** The bar under a point of the drawing, and the staff it is nearest: { bar, staff } or null. */
  function barHit(p) {
    for (const b of st.view.bars ?? []) {
      const [x0, y0, x1, y1] = b.box;
      // Above and below the staves too, where the chord names and the words are.
      const pad = (y1 - y0) * 0.35;
      if (p.x < x0 - 2 || p.x > x1 + 4 || p.y < y0 - pad || p.y > y1 + pad) continue;
      const tops = b.staves;
      let staff = 0;
      tops.forEach((top, k) => {
        if (Math.abs(p.y - (top + 16)) < Math.abs(p.y - (tops[staff] + 16))) staff = k;
      });
      const lanes = M.staffLanes(st.score);
      return { bar: b.bar, staff: lanes[Math.min(staff, lanes.length - 1)] };
    }
    return null;
  }

  /** Bars `a`…`b` of staff `s` selected, all their notes. */
  function selectBars(s, a, b) {
    const staff = st.score.staves[s];
    const [from, to] = [Math.min(a, b), Math.max(a, b)];
    const at = M.starts(staff);
    const last = Math.max(...at.filter((t) => t < M.barStart(st.score, to + 1)));
    st.sel = { staff: s, t0: M.barStart(st.score, from), t1: last, head: -1, bars: [from, to] };
    say("");
    draw();
  }

  /** The bar line nearest x, as the bar that starts (`side` "start") or ends ("end") there. */
  function nearestBarLine(p, side) {
    let best = null;
    for (const b of st.view.bars ?? []) {
      const [x0, y0, x1, y1] = b.box;
      const x = side === "start" ? x0 : x1;
      const d = Math.hypot(p.x - x, p.y < y0 ? y0 - p.y : p.y > y1 ? p.y - y1 : 0);
      if (!best || d < best.d) best = { bar: b.bar, d };
    }
    return best?.bar ?? null;
  }

  /** The note under the pointer: the nearest notehead within a few pixels, else the nearest note or rest. */
  function hit(p) {
    const away = (b) => Math.hypot(Math.max(b[0] - p.x, 0, p.x - b[2]), Math.max(b[1] - p.y, 0, p.y - b[3]));
    const reach = 6 / p.scale;
    let best = null;
    for (const it of st.view.items) {
      for (const h of it.heads) {
        const d = away(h.box);
        if (d <= reach && (!best || d < best.d)) best = { item: it.item, head: h.index, d };
      }
    }
    if (best) return best;
    for (const it of st.view.items) {
      const d = away(it.box);
      if (d <= 2 * reach && (!best || d < best.d)) best = { item: it.item, head: -1, d };
    }
    return best;
  }

  sheet.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".studio-words")) return;
    sheet.focus({ preventScroll: true });
    if (!st.score || !st.view) return;
    const p = point(event);
    // A repeat's edge, taken to be moved.
    const grip = event.target.closest(".studio-grip");
    if (grip) {
      st.grip = { i: Number(grip.dataset.repeat), edge: grip.dataset.edge, base: snapshot(), moved: false };
      sheet.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    const found = p && hit(p);
    if (!found) {
      // The empty part of a bar: it is selected, and a drag selects the bars it crosses.
      const on = p && !st.input.on ? barHit(p) : null;
      if (on) {
        const keep = event.shiftKey && st.sel?.bars && st.sel.staff === on.staff;
        const from = keep ? st.sel.bars[0] : on.bar;
        st.barDrag = { s: on.staff, a: from };
        selectBars(on.staff, from, on.bar);
        sheet.setPointerCapture(event.pointerId);
        return;
      }
      if (!st.input.on) {
        st.sel = null;
        draw();
      }
      return;
    }
    const { staff: s, index: i } = st.items[found.item] ?? {};
    if (s == null) return;
    const ev = st.score.staves[s].events[i];
    if (st.input.on) {
      st.input.staff = s;
      st.input.t = M.starts(st.score.staves[s])[i];
      st.input.last = null;
      return draw();
    }
    const chord = ev.pitches.length > 1;
    select(s, i, chord ? found.head : -1, event.shiftKey);
    if (!ev.rest && !event.shiftKey) {
      const head = found.head >= 0 ? found.head : 0;
      st.drag = { x: event.clientX, y: event.clientY, at: p, scale: p.scale, s, t: M.starts(st.score.staves[s])[i], head: chord ? head : -1, by: 0, chromatic: event.shiftKey, base: snapshot() };
      sheet.setPointerCapture(event.pointerId);
    }
  });

  sheet.addEventListener("pointermove", (event) => {
    if (st.barDrag) {
      const on = point(event) && barHit(point(event));
      if (on && on.bar !== st.sel?.bars?.[1]) selectBars(st.barDrag.s, st.barDrag.a, on.bar);
      return;
    }
    if (st.grip) return moveGrip(event);
    if (!st.drag) return;
    // Sideways from a note, not up or down: the drag selects bars instead.
    const across = Math.abs(event.clientX - st.drag.x);
    if (st.drag.by === 0 && across > 14 && across > 2 * Math.abs(event.clientY - st.drag.y)) {
      const on = barHit(st.drag.at);
      if (on) {
        st.drag = null;
        st.barDrag = { s: on.staff, a: on.bar };
        const now = barHit(point(event)) ?? on;
        return selectBars(on.staff, on.bar, now.bar);
      }
    }
    const half = 4 * st.zoom * st.drag.scale;
    const by = Math.round((st.drag.y - event.clientY) / half);
    if (by === st.drag.by) return;
    // Each step a fresh copy of the score as it was at the press.
    const from = JSON.parse(st.drag.base).score;
    const i = M.eventAt(from.staves[st.drag.s], st.drag.t);
    try {
      for (let k = 0; k < Math.abs(by); k++) M.move(from, st.drag.s, i, event.shiftKey ? "semitone" : "step", Math.sign(by), st.drag.head);
    } catch (error) {
      return;
    }
    st.drag.by = by;
    st.score = from;
    writeText();
    sheet.classList.add("studio-dragging");
    draw();
  });

  /** A repeat's edge dragged to the bar line nearest the pointer — a preview, kept on release. */
  function moveGrip(event) {
    const p = point(event);
    if (!p) return;
    const { i, edge, base } = st.grip;
    const score = JSON.parse(base).score;
    const r = score.repeats[i];
    const bar = nearestBarLine(p, edge === "from" ? "start" : "end");
    if (bar == null) return;
    const next = {};
    if (edge === "from") next.from = bar;
    else if (edge === "to") next.to = bar;
    else {
      const k = Number(edge.split(":")[1]);
      const start = r.to + 1 + r.endings.slice(0, k).reduce((x, y) => x + y, 0);
      next.endings = r.endings.map((n, j) => (j === k ? bar - start + 1 : n));
    }
    try {
      M.setRepeat(score, i, next);
    } catch (error) {
      return say(error.message, true);
    }
    st.grip.moved = true;
    st.score = score;
    writeText();
    say("");
    draw();
  }

  const endDrag = () => {
    if (st.barDrag) {
      st.barDrag = null;
      return;
    }
    if (st.grip) {
      const grip = st.grip;
      st.grip = null;
      if (grip.moved) {
        st.past.push(grip.base);
        st.future = [];
        saveDraft();
        draw();
      }
      return;
    }
    const drag = st.drag;
    st.drag = null;
    sheet.classList.remove("studio-dragging");
    if (drag && drag.by !== 0) {
      st.past.push(drag.base);
      st.future = [];
      saveDraft();
      draw();
    }
  };
  sheet.addEventListener("pointerup", endDrag);
  sheet.addEventListener("pointercancel", endDrag);

  // ---- Keyboard -------------------------------------------------------------------

  root.addEventListener("keydown", (event) => {
    const field = event.target.closest("input, textarea, select");
    if (field) return;
    const key = event.key;
    const mod = event.ctrlKey || event.metaKey;
    const run = (name, data) => {
      event.preventDefault();
      act(name, data);
    };
    if (mod && key.toLowerCase() === "z") return run(event.shiftKey ? "redo" : "undo");
    if (mod && key.toLowerCase() === "y") return run("redo");
    if (mod && key.toLowerCase() === "c") return run("copy");
    if (mod && key.toLowerCase() === "x") return run("cut");
    if (mod && key.toLowerCase() === "v") return run("paste");
    if (mod && key.toLowerCase() === "l") return run("lyrics");
    if (mod && key.toLowerCase() === "k") return run("chord");
    // Ctrl+Alt+1, 2: the voice, as MuseScore has it; event.code, since Alt changes the key.
    if (mod && event.altKey && ["Digit1", "Digit2", "Numpad1", "Numpad2"].includes(event.code)) return run("voice", { voice: event.code.slice(-1) });
    if (mod && ["3", "5", "6", "7"].includes(key)) return run("tuplet", { n: key });
    if (key === " " && !event.target.closest("button")) return run("play");
    if (mod) return;
    if (key === "Escape") {
      event.preventDefault();
      if (st.input.on) return setInput(false);
      st.sel = null;
      return draw();
    }
    if (key === "n" || key === "N") return run(st.input.on ? "mode-select" : "mode-input");
    if (key === "ArrowRight" || key === "ArrowLeft") return run(key === "ArrowRight" ? "next" : "previous", { extend: event.shiftKey });
    if ((key === "ArrowUp" || key === "ArrowDown") && event.altKey) return run(key === "ArrowUp" ? "head-up" : "head-down");
    if (key === "ArrowUp" || key === "ArrowDown") {
      return run("move", { how: event.shiftKey ? "semitone" : "step", by: key === "ArrowUp" ? 1 : -1 });
    }
    if (KEY_DURATIONS[key]) return run("duration", { base: KEY_DURATIONS[key] });
    if (key === ".") return run("dot");
    const letter = LETTERS[key.toLowerCase()];
    if (letter !== undefined && !event.altKey) return run("letter", { step: letter, add: event.shiftKey });
    if (key === "0") return run("rest");
    if (key === "]") return run("add-bar");
    if (key === "Delete" || (key === "Backspace" && !st.input.on)) return run("rest");
    if (key === "Backspace" && st.input.on) {
      event.preventDefault();
      return inputBack();
    }
    if (key === "+") return run("alter", { alter: Math.min(2, currentAlter() + 1) });
    if (key === "-") return run("alter", { alter: Math.max(-2, currentAlter() - 1) });
    if (key === "=") return run("alter", { alter: 0 });
    if (key === "l" || key === "L") return run("lyrics");
    if (key === "k" || key === "K") return run("chord");
    if (key === "t" || key === "T") return run("tie");
    if (key === "s" || key === "S") return run("slur");
  });

  // Ctrl+arrows move by octaves; the browser keeps Ctrl+↑ for itself otherwise.
  root.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && (event.key === "ArrowUp" || event.key === "ArrowDown") && !event.target.closest("input, textarea, select")) {
      event.preventDefault();
      act("move", { how: "octave", by: event.key === "ArrowUp" ? 1 : -1 });
    }
  });

  function currentAlter() {
    const t = target();
    if (!t) return 0;
    const ev = st.score.staves[t.s].events[t.i];
    return (ev.pitches[t.head >= 0 ? t.head : 0] ?? { alter: 0 }).alter;
  }

  // ---- The controls ---------------------------------------------------------------

  root.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-act]");
    if (!button || button.disabled) return;
    const typing = button.dataset.act === "lyrics" || button.dataset.act === "chord";
    if (!button.closest(".studio-menubar") && !typing) sheet.focus({ preventScroll: true });
    act(button.dataset.act, { ...button.dataset, add: event.shiftKey });
  });

  root.addEventListener("change", (event) => {
    const el = event.target;
    if (el.matches('[data-act="example"]') && el.value) {
      const path = `${options.examples ?? "/examples"}/${el.value}/source.ly`;
      el.value = "";
      fetch(path).then((r) => r.text()).then((text) => load(text, "Example opened.")).catch(() => say("Could not open that example", true));
      return;
    }
    if (el.matches('[data-act="open"]') && el.files?.[0]) {
      el.files[0].text().then((text) => load(text, `${el.files[0].name} opened.`));
      el.value = "";
      return;
    }
    if (el.matches("select[data-field], input[type=number][data-field], input[type=checkbox][data-field]")) onField(event);
  });
  root.addEventListener("input", (event) => {
    if (event.target.matches('input[type="text"][data-field]')) onField(event);
  });

  let typing = null;
  sourceBox.addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      st.past.push(snapshot());
      st.future = [];
      readText(sourceBox.value);
      if (st.score) {
        // Keep what was typed; the model rewrites it on the next edit.
        st.items = M.toLilyPond(st.score).items;
      }
      saveDraft();
      draw();
    }, 250);
  });

  // Left alone, typed LilyPond is rewritten as the model writes it: one
  // notation, and every note where the score's tools expect it.
  sourceBox.addEventListener("change", () => {
    if (!st.score) return;
    writeText();
    saveDraft();
    draw();
  });

  new ResizeObserver(() => draw()).observe(sheet);

  // ---- Playing --------------------------------------------------------------------
  //
  // player.js plays the MIDI with MuseScore_General. The MIDI is written from
  // the score with every repeat played out, and `passes` says when each bar
  // sounds on each pass: the notes light up on the second time through too.

  async function togglePlay() {
    if (st.playing) return stopPlay();
    // Inside the click, before anything waits: a browser starts sound only
    // from a gesture, and a gesture does not outlive a download.
    P.unlock();
    const passes = st.score ? M.playback(st.score) : [];
    // From the selection's bar (its first pass), or from the start.
    const from = changeBar();
    const at = from == null ? 0 : (passes.find((p) => p.bar === from)?.start ?? 0);
    let bytes;
    try {
      // 100 a quarter when the source sets no tempo, as the model counts.
      bytes = await toMidi(st.score ? M.toLilyPond(st.score, { unfold: true }).source : st.text, { bpm: 100, beat: 4 });
    } catch (error) {
      return say(error.message ?? String(error), true);
    }
    const playing = { handle: null, passes, times: noteTimes(passes), now: [], lit: -1, frame: 0, timer: 0 };
    st.playing = playing;
    showState();
    if (!P.isReady()) say("Loading the sounds…");
    let handle;
    try {
      handle = await P.play(bytes, {
        at,
        onStop: () => st.playing === playing && stopPlay(),
        onProgress: (f) => st.playing === playing && say(`Loading the sounds… ${Math.round(100 * f)} % (38 MB, once)`),
      });
    } catch (error) {
      if (st.playing === playing) stopPlay();
      return say("The sounds could not be loaded.", true);
    }
    if (!handle || st.playing !== playing) return;
    playing.handle = handle;
    say("Playing — Space to stop");
    playing.timer = setInterval(showProgress, 200);
    const follow = () => {
      if (st.playing !== playing) return;
      light(handle.time);
      playing.frame = requestAnimationFrame(follow);
    };
    follow();
  }

  /** Lights the notes that started last, at `sec`; draws only when they change. */
  function light(sec) {
    const playing = st.playing;
    const times = playing.times;
    let k = -1;
    while (k + 1 < times.length && times[k + 1].sec <= sec + 0.01) k++;
    if (k === playing.lit) return;
    playing.lit = k;
    playing.now = k < 0 ? [] : times[k].items;
    draw().then(followPlaying);
  }

  function stopPlay() {
    const playing = st.playing;
    st.playing = null;
    if (playing) {
      clearInterval(playing.timer);
      cancelAnimationFrame(playing.frame);
      if (playing.handle) playing.handle.stop();
      else P.stop(); // still loading: it must not start after all
    }
    progress.hidden = true;
    playhead.hidden = true;
    say("");
    draw();
  }

  // The bar under the menu: how far the music has played, the bar it is in;
  // a click on it plays from there.
  const progress = document.createElement("div");
  progress.className = "studio-progress";
  progress.hidden = true;
  progress.innerHTML = '<div class="studio-progress-fill"></div><span class="studio-progress-text"></span>';
  root.querySelector(".studio-menubar").after(progress);
  progress.addEventListener("click", (event) => {
    const handle = st.playing?.handle;
    if (!handle?.duration) return;
    const rect = progress.getBoundingClientRect();
    handle.time = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * handle.duration;
  });

  const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

  function showProgress() {
    const handle = st.playing?.handle;
    if (!handle) return;
    const total = handle.duration || 0;
    const now = Math.min(Math.max(0, handle.time || 0), total);
    progress.hidden = false;
    progress.querySelector(".studio-progress-fill").style.width = total ? `${(100 * now) / total}%` : "0";
    const pass = M.passAt(st.playing.passes, now);
    const bars = pass && st.score ? ` · bar ${pass.bar + 1} of ${M.barsOf(st.score)}` : "";
    progress.querySelector(".studio-progress-text").textContent = `${clock(now)} / ${clock(total)}${bars}`;
    state.textContent = `Playing${bars} · ${clock(now)} / ${clock(total)} — Space to stop`;
  }

  /** The selected bars' boxes, and a handle on every edge of every repeat. */
  function placeOverlay() {
    overlay.innerHTML = "";
    const g = geometry();
    if (!g || !st.score || st.input.on) return;
    const boxOf = (bar) => st.view.bars?.find((b) => b.bar === bar)?.box;
    const add = (className, x0, y0, x1, y1, props = {}) => {
      const a = g.at(x0, y0);
      const b = g.at(x1, y1);
      const el = Object.assign(document.createElement("div"), { className, ...props });
      Object.assign(el.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${Math.max(2, b.x - a.x)}px`, height: `${b.y - a.y}px` });
      overlay.appendChild(el);
      return el;
    };
    if (st.sel?.bars) {
      for (let bar = st.sel.bars[0]; bar <= st.sel.bars[1]; bar++) {
        const box = boxOf(bar);
        if (box) add("studio-bar-selected", box[0], box[1], box[2] + 3, box[3]);
      }
    }
    (st.score.repeats ?? []).forEach((r, i) => {
      const grip = (bar, side, edge, label) => {
        const box = boxOf(bar);
        if (!box) return;
        const x = side === "start" ? box[0] : box[2] + 2;
        const el = add("studio-grip", x - 5 / g.scale, box[1], x + 5 / g.scale, box[3], { title: `${label} — drag to another bar line` });
        el.dataset.repeat = String(i);
        el.dataset.edge = edge;
        el.innerHTML = `<span>${label}</span>`;
      };
      grip(r.from, "start", "from", "𝄆");
      grip(r.to, "end", "to", r.endings.length ? "𝄇 1." : "𝄇");
      let end = r.to;
      r.endings.forEach((n, k) => {
        end += n;
        grip(end, "end", `ending:${k}`, `${k + 1}.`);
      });
    });
  }

  /** The band over what is sounding: as wide as its notes, as tall as its system. */
  function placePlayhead() {
    const now = st.playing?.now;
    if (!now?.length || !st.view) {
      playhead.hidden = true;
      return;
    }
    const boxes = st.view.items.filter((it) => now.includes(it.item)).map((it) => it.box);
    if (!boxes.length) {
      playhead.hidden = true;
      return;
    }
    // The system: every item whose box overlaps these notes' height band.
    const x0 = Math.min(...boxes.map((b) => b[0]));
    const x1 = Math.max(...boxes.map((b) => b[2]));
    let y0 = Math.min(...boxes.map((b) => b[1]));
    let y1 = Math.max(...boxes.map((b) => b[3]));
    for (const it of st.view.items) {
      const [, a, , b] = it.box;
      if (b >= y0 - 40 && a <= y1 + 40) {
        y0 = Math.min(y0, a);
        y1 = Math.max(y1, b);
      }
    }
    const g = geometry();
    if (!g) return;
    const a = g.at(x0 - 4, y0 - 10);
    const b = g.at(x1 + 4, y1 + 10);
    Object.assign(playhead.style, { left: `${a.x}px`, width: `${b.x - a.x}px`, top: `${a.y}px`, height: `${b.y - a.y}px` });
    playhead.hidden = false;
  }

  /** Keeps the note being played in sight. */
  function followPlaying() {
    const lit = playhead.hidden ? null : playhead;
    if (!lit) return;
    const box = lit.getBoundingClientRect();
    const frame = sheet.getBoundingClientRect();
    const top = Math.max(frame.top, 120);
    if (box.top < top || box.bottom > Math.min(frame.bottom, innerHeight)) lit.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /** When notes start, in seconds, on every pass: [{ sec, items }], in order. */
  function noteTimes(passes) {
    if (!st.score) return [];
    const at = new Map();
    const starts = st.score.staves.map((staff) => M.starts(staff));
    st.items.forEach(({ staff, index }, item) => {
      if (st.score.staves[staff].events[index].rest) return;
      for (const sec of M.playedAt(st.score, passes, starts[staff][index])) {
        const key = Math.round(sec * 1000);
        if (!at.has(key)) at.set(key, { sec, items: [] });
        at.get(key).items.push(item);
      }
    });
    return [...at.values()].sort((a, b) => a.sec - b.sec);
  }

  // ---- Start ---------------------------------------------------------------------

  let start = sourceBox.value;
  const fromExample = new URLSearchParams(location.search).has("source");
  if (!fromExample) {
    try {
      const draft = localStorage.getItem(DRAFT);
      if (draft) start = draft;
    } catch (error) {}
  }
  sourceBox.value = start;
  // The engraver reads the source: nothing is read before it has loaded.
  loaded().then(() => {
    readText(start);
    if (st.score) writeText();
    return draw();
  }).then(() => {
    if (!fromExample && start !== sourceBox.defaultValue) say("Your last score, kept in this browser. New starts afresh.");
    else say("Click a note to select it, or press N and type A–G to write.");
  });
  return st;
}
