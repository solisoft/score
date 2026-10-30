// The studio's words (studio.js): lyrics, chord symbols, figures, chord
// diagrams and texts, typed in a box over the note.

// A chord diagram starts from the shape of the chord sounding there (#440).
const Voicings = await import(`./voicings.js${new URL(import.meta.url).search}`);

/** Answers the words box: lyrics, chord symbols, figures, texts typed over the score. */
export function install(ctx) {
  const { root, sheet, st, M } = ctx;
  const { edit, target, geometry, draw, say } = ctx.call;

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
    if (kind === "fret" && st.score.staves[t.s].events[t.i].rest) return say("A chord diagram goes over a note: select a note", true);
    // A chord symbol over a staff under a line of chord names goes on the line, at that time; figures on the figured bass under it.
    const time = M.starts(st.score.staves[t.s])[t.i];
    const line = kind === "chord" ? M.chordLineOver(st.score, t.s) : kind === "figure" ? M.figureLineUnder(st.score, t.s) : -1;
    if (kind === "figure" && line < 0) return say("Add a figured bass under the staff first: Insert › A figured bass under the staff", true);
    const lane = line >= 0 ? line : t.s;
    const at = M.eventAt(st.score.staves[lane], time);
    const ev = at >= 0 ? st.score.staves[lane].events[at] : null;
    // A chord symbol written on the note itself (^"Am7"), under a line of
    // chord names: it is the one shown and edited, and it moves onto the
    // line when typed, a chord name like the others (#416).
    const noteChord = kind === "chord" && line >= 0 ? st.score.staves[t.s].events[t.i].chord || null : null;
    const box = Object.assign(document.createElement("input"), { type: "text", className: `studio-words studio-words-${kind}` });
    box.value = noteChord ?? (ev ? wordsOf(ev, kind) : "");
    // A new diagram: the shape of the chord symbol sounding over the note, to keep or change.
    const shape = kind === "fret" && !box.value ? Voicings.guitarShape(Voicings.chordAt(st.score, time)) : null;
    if (shape) {
      box.value = M.fretText(Voicings.fretSpecOf(shape));
      say(`The ${shape.name} shape, from the chord symbol: Enter puts it, or click the frets to change it.`);
    }
    box.placeholder = { lyric: "syllable", chord: "Am7", text: "solo", expression: "dolce", figure: "6 4", fret: "x32010" }[kind];
    box.setAttribute("aria-label", {
      lyric: "Syllable — Space next note, - hyphen, Enter done",
      chord: "Chord symbol — Space next note, Enter done",
      text: "Staff text — Enter done",
      expression: "Expression, in italics — Enter done",
      figure: "Figures, as 6 4 or 7+ — Space next beat, Enter done",
      fret: "Guitar chord, low E first: x32010 — Enter done",
    }[kind]);
    sheet.appendChild(box);
    // A chord diagram's frets, clicked under its box (#434).
    const grid = kind === "fret" ? fretGrid(box) : null;
    if (grid) sheet.appendChild(grid);
    wordsBox = { box, grid, kind, s: lane, t: time, anchor: t.s, noteChord: noteChord ? { s: t.s, i: t.i } : null };
    // The note palette steps out of the box's way while it is open.
    ctx.call.placeOverlay();
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
      } else if ((event.key === " " && (kind === "lyric" || kind === "chord" || kind === "figure")) || event.key === "Tab" || (event.key === "-" && kind === "lyric")) {
        event.preventDefault();
        commitWords({ hyphen: event.key === "-", next: true });
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

  // ---- A chord diagram's grid (#434) -------------------------------------------------

  const STRINGS = ["low E", "A", "D", "G", "B", "high E"];

  /**
   * A chord diagram drawn large under its box (#434, #436): six strings and
   * five frets, from the first or, for a shape up the neck, from its lowest
   * fret, numbered. A click on a fret puts a finger there, again takes it
   * away; over the nut, open (o) and not played (x) in turn. The box's text
   * follows, and the grid follows the text.
   */
  function fretGrid(box) {
    const grid = Object.assign(document.createElement("div"), { className: "studio-fret-grid" });
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "Chord diagram: click a fret to put a finger there, over the nut for open or not played");
    const frets = () => {
      try {
        return M.fretSpec(box.value).split("|")[0].split(";").filter(Boolean);
      } catch {
        return ["o", "o", "o", "o", "o", "o"];
      }
    };
    // The first fret shown: 1, or the lowest fingered one of a shape reaching past the fifth.
    const firstOf = (items) => {
      const fingered = items.filter((f) => /^\d+$/.test(f)).map(Number).filter((f) => f > 0);
      return fingered.length && Math.max(...fingered) > 5 ? Math.min(...fingered) : 1;
    };
    let first = 0;
    const build = (from) => {
      first = from;
      grid.replaceChildren();
      grid.classList.toggle("studio-fret-grid-up", from > 1);
      const label = Object.assign(document.createElement("span"), { className: "studio-fret-first", textContent: from > 1 ? `${from}fr` : "" });
      grid.appendChild(label);
      for (const fret of ["nut", ...[0, 1, 2, 3, 4].map((k) => String(from + k))]) {
        for (let string = 0; string < 6; string++) {
          const button = Object.assign(document.createElement("button"), { type: "button" });
          button.dataset.string = String(string);
          button.dataset.fret = fret;
          button.setAttribute("aria-label", fret === "nut" ? `${STRINGS[string]} string: open or not played` : `${STRINGS[string]} string, fret ${fret}`);
          grid.appendChild(button);
        }
      }
    };
    const show = () => {
      const items = frets();
      if (firstOf(items) !== first) build(firstOf(items));
      for (const button of grid.querySelectorAll("button")) {
        const { string, fret } = button.dataset;
        const now = items[Number(string)];
        if (fret === "nut") button.textContent = now === "x" ? "×" : now === "o" ? "○" : "";
        else button.setAttribute("aria-pressed", String(now === fret));
      }
    };
    // The box keeps the focus: a click on the grid is not a step out of it.
    grid.addEventListener("pointerdown", (event) => event.preventDefault());
    grid.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      const items = frets();
      const string = Number(button.dataset.string);
      const fret = button.dataset.fret;
      if (fret === "nut") items[string] = items[string] === "o" ? "x" : "o";
      else items[string] = items[string] === fret ? "o" : fret;
      box.value = M.fretText(`${items.join(";")};`);
      show();
      box.focus();
    });
    box.addEventListener("input", show);
    show();
    return grid;
  }

  /** The verse the lyrics box writes: the Verse menu's, 1 the first. */
  function verse() {
    return Number(root.querySelector("[data-verse]")?.value) || 1;
  }

  /** What a words box shows for `ev`: its syllable, chord symbol, staff text or expression. */
  function wordsOf(ev, kind) {
    if (kind === "lyric") return M.syllableOf(ev, verse())?.text ?? "";
    if (kind === "chord") return ev.chord ?? "";
    if (kind === "figure") return ev.figure ?? "";
    if (kind === "fret") return ev.fret ? M.fretText(ev.fret) : "";
    return M.textOf(ev, kind === "text" ? "staff" : "expression");
  }

  function commitWords(extra = {}) {
    if (!wordsBox) return;
    const { box, kind, s, t, noteChord } = wordsBox;
    const value = box.value;
    wordsBox.noteChord = null;
    edit((score) => {
      // The note's own chord symbol leaves it: the line holds it now. A
      // value the line refuses refuses the whole edit, the note's kept.
      if (noteChord) M.setChordSymbol(score, noteChord.s, noteChord.i, "");
      const i = M.eventAt(score.staves[s], t);
      if (kind === "lyric") {
        if (score.staves[s].events[i].rest) return;
        M.setLyric(score, s, i, value, Boolean(extra.hyphen), false, verse());
      } else if (kind === "chord" && M.isChords(score, s)) {
        // On a line of chord names: from this beat on, the line cut there.
        if (value.trim() || i >= 0) M.setChordAt(score, s, t, value);
      } else if (kind === "chord") M.setChordSymbol(score, s, i, value);
      else if (kind === "figure") {
        if (value.trim() || i >= 0) M.setFigureAt(score, s, t, value);
      } else if (kind === "fret") M.setFretDiagram(score, s, i, value);
      else M.setText(score, s, i, kind === "text" ? "staff" : "expression", value);
    });
  }

  function nextWords() {
    if (!wordsBox) return;
    const { kind, s, t } = wordsBox;
    const staff = st.score.staves[s];
    const at = M.starts(staff);
    if (M.isChords(st.score, s) || M.isFigures(st.score, s)) {
      // A line of chord names goes beat by beat, the staff under it selected where a note starts.
      const next = M.nextBeat(st.score, t);
      if (next >= M.lengthOf(staff)) return closeWords();
      const under = st.score.staves[wordsBox.anchor];
      const k = M.eventAt(under, next);
      if (k >= 0) st.sel = { staff: wordsBox.anchor, t0: next, t1: next, head: -1 };
      draw();
      const i = M.eventAt(staff, next);
      wordsBox.t = next;
      wordsBox.box.value = i >= 0 ? wordsOf(staff.events[i], kind) : "";
      placeWords();
      wordsBox.box.focus();
      wordsBox.box.select();
      return;
    }
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
    wordsBox.box.value = wordsOf(ev, kind);
    placeWords();
    wordsBox.box.focus();
    wordsBox.box.select();
  }

  function closeWords() {
    wordsBox?.box.remove();
    wordsBox?.grid?.remove();
    wordsBox = null;
    // The note palette, hidden while the words were typed, comes back.
    ctx.call.placeOverlay();
  }

  /** Whether words are being typed over the score (the palette stays out of their way). */
  function wordsOpen() {
    return wordsBox !== null;
  }

  function placeWords() {
    if (!wordsBox || !st.view) return;
    const k = st.items.findIndex((it) => it.staff === wordsBox.s && M.starts(st.score.staves[it.staff])[it.index] === wordsBox.t);
    // A beat of a line of chord names with nothing drawn: over the staff's note sounding then.
    const under = (it) => {
      if (it.staff !== wordsBox.anchor || it.staff === wordsBox.s) return false;
      const at = M.starts(st.score.staves[it.staff]);
      return at[it.index] <= wordsBox.t && at[it.index] + M.ticksOf(st.score.staves[it.staff].events[it.index]) > wordsBox.t;
    };
    const item = st.view.items.find((it) => it.item === k) ?? st.view.items.find((it) => under(st.items[it.item] ?? {}));
    const g = geometry();
    if (!item || !g) return;
    const [x0, y0, , y1] = item.box;
    const below = wordsBox.kind === "lyric" || wordsBox.kind === "expression" || wordsBox.kind === "figure";
    const corner = g.at(x0, below ? y1 : y0);
    wordsBox.box.style.left = `${corner.x - 6}px`;
    // A later verse's box a line lower, as its words stand.
    const line = wordsBox.kind === "lyric" ? (verse() - 1) * 26 * st.zoom : 0;
    wordsBox.box.style.top = below ? `${corner.y + 8 + line}px` : `${Math.max(0, corner.y - 36)}px`;
    if (wordsBox.grid) {
      // Under its box; on a score too short for it there, beside the box, kept inside the sheet (#438).
      const boxTop = parseFloat(wordsBox.box.style.top);
      const under = boxTop + wordsBox.box.offsetHeight + 4;
      const room = sheet.scrollTop + sheet.clientHeight - 4 - wordsBox.grid.offsetHeight;
      const beside = under > room;
      wordsBox.grid.style.left = beside ? `${parseFloat(wordsBox.box.style.left) + wordsBox.box.offsetWidth + 6}px` : wordsBox.box.style.left;
      wordsBox.grid.style.top = `${beside ? Math.max(0, Math.min(boxTop, room)) : under}px`;
    }
  }

  /** A word double-clicked on the score: its note selected, its box opened there with its value (#434). */
  function openWordAt(s, i, kind, verseNumber = 1) {
    const staff = st.score?.staves[s];
    if (!staff?.events[i]) return;
    const t = M.starts(staff)[i];
    st.sel = { staff: s, t0: t, t1: t, head: -1 };
    const verses = root.querySelector("[data-verse]");
    if (kind === "lyric" && verses) verses.value = String(verseNumber);
    draw();
    openWords(kind);
  }

  return { openWords, openWordAt, placeWords, wordsOpen };
}
