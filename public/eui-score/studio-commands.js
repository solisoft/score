// The studio's commands (studio.js): `act`, what each control and each key
// does; the keyboard, the buttons and the menus that call it.

// Served immutable: this module's version goes to the ones it loads.
const V = new URL(import.meta.url).search;
/** The drum grid, the arpeggiator and the chord track (Edit menu), loaded the first time one is opened. */
const patternTools = () => import(`./pattern-tools.js${V}`);
/** Quantize, swing and humanize (Edit and Play menus), loaded the first time one is opened. */
const feelTools = () => import(`./feel-tools.js${V}`);
/** Chord shapes and voicings (Insert ▸ Guitar diagrams for the chord symbols), loaded the first time. */
const voicings = () => import(`./voicings.js${V}`);

/** The keys, the buttons and the menus wired; answers act, what each of them does. */
/** The windows wide enough for the source beside the score, as the CSS has it (#420). */
const SIDE_WIDTH = "(min-width: 1200px)";

export function install(ctx) {
  const { root, options, sheet, st, mac, newDialog, toPdf, download, M, P, K, X, musicXml } = ctx;
  const {
    openParts, barNo, edit, barsEdit, undo, redo, staffOf, range, hear, target, need, keepOn, inputTicks, setInput,
    inputWrite, inputBack, inputTuplet, selectedBarsOrNull, selectedBars, duration, toggleDot, step, chordHead, copy,
    insertCopied, paste, openWords, draw, place, toVoice, onField, share, refuse, say, title, fileName, openChosen,
    heardMidi, exportPractice, togglePlay, stopPlay, mixCommit, saveWav, saveSound, saveImage, setLoop, record
  } = ctx.call;

  // ---- Actions ------------------------------------------------------------------

  // What changes or moves to a note sounds it, as the person works.
  const SOUNDING = new Set(["letter", "drum", "move", "alter", "head-up", "head-down", "next", "previous"]);
  let patterns = null;
  let feel = null;

  // View ▸ Source beside the score (#420): the LilyPond text in a column on
  // the right of a wide screen, not under the score; kept in this browser.
  const SOURCE_SIDE = "eui-score-source-side";
  function placeSource(beside) {
    root.classList.toggle("studio-source-side", beside);
    const label = root.querySelector("[data-source-side-label]");
    if (label) label.firstChild.textContent = beside ? "Source under the score " : "Source beside the score ";
  }
  try {
    placeSource(localStorage.getItem(SOURCE_SIDE) === "1");
  } catch (error) {}

  function act(name, data = {}) {
    const done = doAct(name, data);
    if (SOUNDING.has(name)) Promise.resolve(done).then(hear);
    return done;
  }

  function doAct(name, data = {}) {
    switch (name) {
      case "new": return newDialog.showModal();
      case "properties": return root.querySelector("[data-properties]")?.showModal();
      case "midi-view": {
        if (!st.score) return say("The MIDI view needs the score tools: this piece is edited in its text.", true);
        st.mode = st.mode === "midi" ? "score" : "midi";
        const label = root.querySelector("[data-midi-label]");
        if (label) label.firstChild.textContent = st.mode === "midi" ? "Score view " : "MIDI view ";
        root.querySelector("[data-midi-button]")?.setAttribute("aria-pressed", String(st.mode === "midi"));
        say(st.mode === "midi" ? "MIDI view: drag across bars and tracks to select a section." : "Score view.");
        return draw();
      }
      case "roll-layout":
        st.rollLayout = data.layout === "keys" ? "keys" : "tracks";
        st.rollOnly = null;
        // A section on some tracks covers them all on one keyboard: the selection follows what is shown.
        if (st.rollLayout === "keys" && st.sel?.lanes) st.sel = null;
        return draw();
      case "insert-copied": return insertCopied();
      case "record": return record();
      case "midi-learn": return ctx.sync.open();
      case "set-loop": return setLoop(selectedBarsOrNull());
      case "clear-loop": return setLoop(null);
      case "source-side": {
        const beside = !root.classList.contains("studio-source-side");
        placeSource(beside);
        try {
          localStorage.setItem(SOURCE_SIDE, beside ? "1" : "0");
        } catch (error) {}
        const wide = matchMedia(SIDE_WIDTH).matches;
        return say(beside ? (wide ? "The source beside the score: View ▸ Source under the score puts it back." : "The source goes beside the score on a wider window; here it stays under it.") : "The source under the score.");
      }
      case "written": {
        if (!st.score) return say("Written pitch needs the score tools: this piece is edited in its text.", true);
        st.written = !st.written;
        root.querySelector("[data-written-label]").firstChild.textContent = st.written ? "Concert pitch " : "Written pitch ";
        const moved = M.staffLanes(st.score).some((s) => M.transpositionOf(st.score.staves[s]));
        say(st.written ? (moved ? "Written pitch: transposing instruments as their players read them. For reading only." : "Written pitch: no instrument here is written apart from how it sounds.") : "Concert pitch: as it sounds, and as it is written into.");
        return draw();
      }
      case "parts": return openParts();
      case "comment": {
        if (!options.onComment) return say("Comments are for scores saved in the app: open this one there to comment.", true);
        return options.onComment(place());
      }
      // Edit ▸ Drum grid…, Arpeggiate…, Chord track…: pattern-tools.js's dialogs.
      case "drum-grid": case "arpeggiate": case "chord-track":
        patterns ??= patternTools().then((T) => T.install({ root, st, M, P, edit, say, setLoop, togglePlay, stopPlay, range, selectedBarsOrNull, barNo }));
        return patterns.then((tools) => tools.open(name));
      // Edit ▸ Quantize…, Play ▸ Swing and humanize…: feel-tools.js's dialogs.
      case "quantize": case "swing":
        feel ??= feelTools().then((T) => T.install({ root, st, M, edit, say, range, barNo }));
        return feel.then((tools) => tools.open(name));
      case "break": {
        let bar;
        try {
          bar = selectedBars()[1];
        } catch (error) {
          return say("Select a bar first: the line or the page ends after it.", true);
        }
        const kind = (st.score?.breaks ?? {})[bar] === data.kind ? null : data.kind;
        if (edit((score) => M.setBreak(score, bar, kind))) say(kind ? `A new ${kind} after bar ${barNo(bar)}: the PDF is laid out so.` : `Bar ${barNo(bar)}: the line goes on.`);
        return;
      }
      case "undo": return undo();
      case "redo": return redo();
      case "play": return togglePlay();
      case "stop": return stopPlay();
      case "mute": case "solo": {
        // The mixer's own: kept in the score.
        const lane = Number(data.lane);
        return mixCommit(lane, { [name]: !X.trackOf(X.mixOf(st.score), lane)[name] });
      }
      case "mixer": return st.mixer.toggle();
      case "audio-tracks": return st.audio.toggle();
      case "mic-record": return st.audio.record();
      case "tuner": return st.audio.tuner();
      case "practice": return st.audio.practice();
      case "keys": {
        const sheetOfKeys = root.querySelector("[data-keys]");
        if (sheetOfKeys.open) sheetOfKeys.close();
        else sheetOfKeys.showModal();
        return;
      }
      case "zoom-in": st.zoom = Math.min(2, Math.round((st.zoom + 0.1) * 10) / 10); return draw();
      case "tools": {
        const open = root.classList.toggle("studio-tools-open");
        root.querySelector('[data-act="tools"]').setAttribute("aria-expanded", String(open));
        return;
      }
      case "zoom-out": st.zoom = Math.max(0.5, Math.round((st.zoom - 0.1) * 10) / 10); return draw();
      case "save-ly": return download(st.text, `${fileName()}.ly`, "text/x-lilypond");
      case "save-musicxml": {
        // Written from the editor's own score: a text it cannot read has none.
        if (!st.score) return say("MusicXML is written from the score the editor reads; this text holds what it does not edit.", true);
        return musicXml()
          .then((X) => download(X.toMusicXML(st.score), `${fileName()}.musicxml`, "application/vnd.recordare.musicxml+xml"))
          .catch((error) => say(error.message ?? String(error), true));
      }
      case "save-pdf": return toPdf(st.text, title()).then((pdf) => download(pdf, `${fileName()}.pdf`, "application/pdf")).catch((e) => refuse(e));
      // In the app, the owner goes to the score's sharing page, and someone it
      // is shared with copies its address in the app, which opens for those it
      // is shared with; elsewhere, a link that holds the score.
      case "share": return options.shareUrl ? location.assign(options.shareUrl) : share();
      case "transpose": {
        const it = M.INTERVALS[Number(root.querySelector("[data-transpose-interval]").value)];
        const way = Number(root.querySelector("[data-transpose-way]").value);
        const by = { steps: way * it.steps, semitones: way * it.semitones };
        const words = `${way > 0 ? "up" : "down"} a${/^[ao]/.test(it.name) ? "n" : ""} ${it.name}`;
        if (data.scope === "score") {
          if (edit((score) => M.transpose(score, by))) say(`The score, ${words}.`);
          return;
        }
        const r = range();
        if (!r) return say("Select the notes to transpose, or transpose the score", true);
        if (edit((score) => M.transpose(score, { ...by, s: r.s, a: r.a, b: r.b }))) say(`${r.b - r.a + 1} selected, ${words}.`);
        return;
      }
      case "save-midi": return heardMidi(st.score, undefined, { mix: X.mixOf(st.score), practice: exportPractice() }).then((m) => download(m, `${fileName()}.mid`, "audio/midi")).catch((e) => refuse(e));
      case "save-wav": return saveWav();
      case "save-mp3": return saveSound("mp3");
      case "save-stems": return saveSound("stems");
      case "save-svg": case "save-png": return saveImage(name === "save-png");
      case "mode-select": return setInput(false);
      case "mode-input": return setInput(true);
      case "duration": return duration(Number(data.base), st.input.on ? st.input.dots : 0);
      case "dot": return toggleDot();
      case "letter": {
        // Ticked, Add to the chord adds to the note just written; with none
        // yet, the letter writes the chord's first note (#422).
        const ticked = root.querySelector("[data-chord-mode]")?.checked && (!st.input.on || Boolean(st.input.last));
        const add = data.add || ticked;
        if (st.input.on) return inputWrite(Number(data.step), add);
        return edit((score) => {
          const t = need();
          M.letter(score, t.s, t.i, Number(data.step), add, t.head);
        });
      }
      case "drum": {
        const add = data.add || root.querySelector("[data-chord-mode]")?.checked;
        if (st.input.on) return inputWrite(data.name, add);
        return edit((score) => {
          const t = need();
          M.drumHit(score, t.s, t.i, data.name, add);
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
        // A note tied from one already moved has moved with it.
        for (let i = r.a; i <= r.b; i++) {
          if (!r.staff.events[i].rest && !(i > r.a && r.staff.events[i - 1].tie)) M.move(score, r.s, i, data.how, Number(data.by));
        }
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
      case "phrase": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select the notes of the phrase: click the first, Shift+click the last"); })();
        M.togglePhrase(score, r.s, r.a, r.b);
      });
      // An ottava line over the selection (again: taken away), or ended at its first note.
      case "ottava": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select the notes the line goes over"); })();
        M.setOttava(score, r.s, r.a, r.b, Number(data.value));
      });
      case "ottava-end": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select the note the line ends before"); })();
        M.endOttava(score, r.s, r.a);
      });
      // Stems up, down or as the voice wants over the selection; X flips them: up, down, back.
      case "stem": case "stem-flip": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select the notes whose stems to turn"); })();
        const now = M.stemAt(score, r.s, r.a);
        const dir = name === "stem" ? Number(data.dir) : now > 0 ? -1 : now < 0 ? 0 : 1;
        M.setStem(score, r.s, r.a, r.b, dir);
        say(["Stems down", "Stems as the voice wants", "Stems up"][dir + 1]);
      });
      // A beam written by hand over the selection (again: none), or broken before the selected note.
      case "beam": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select the notes to beam: click the first, Shift+click the last"); })();
        M.toggleBeam(score, r.s, r.a, r.b);
      });
      case "beam-break": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select the note the beam breaks before"); })();
        M.breakBeam(score, r.s, r.a);
      });
      // The selected notes spelled the other way: C♯ and D♭.
      case "enharmonic": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select the notes to spell the other way"); })();
        M.enharmonic(score, r.s, r.a, r.b, r.a === r.b ? st.sel.head : -1);
      });
      // The selected notes drawn on the staff above or below (\\change Staff), again to bring them back.
      case "cross": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select the notes to draw on the other staff"); })();
        M.setCross(score, r.s, r.a, r.b, Number(data.dir));
      });
      // A finger (1–5) or a string (1–6) on the selected notes — on the selected note of a chord.
      case "finger": case "string-number": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select a note first"); })();
        const head = r.a === r.b ? st.sel.head : -1;
        const circled = name === "string-number";
        for (let i = r.a; i <= r.b; i++) if (!r.staff.events[i].rest) M.setFingering(score, r.s, i, data.n, { head, circled });
      });
      case "finger-remove": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select a note first"); })();
        for (let i = r.a; i <= r.b; i++) M.removeFingerings(score, r.s, i);
      });
      case "hairpin": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select the notes the hairpin spans"); })();
        M.setHairpin(score, r.s, r.a, r.b, data.kind);
      });
      case "art": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select a note first"); })();
        for (let i = r.a; i <= r.b; i++) if (!r.staff.events[i].rest || data.name === "fermata") M.toggleArticulation(score, r.s, i, data.name);
      });
      case "breath": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select a note first"); })();
        M.toggleBreath(score, r.s, r.b, data.kind);
      });
      case "reminder": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select a note first"); })();
        const head = r.a === r.b ? st.sel.head : -1;
        for (let i = r.a; i <= r.b; i++) if (!r.staff.events[i].rest) M.toggleReminder(score, r.s, i, data.kind, head);
      });
      case "grace": return edit((score) => {
        const t = need();
        M.setGrace(score, t.s, t.i, data.kind);
      });
      case "grace-add": return edit((score) => {
        const t = need();
        M.addGrace(score, t.s, t.i);
      });
      case "grace-move": return edit((score) => {
        const t = need();
        M.moveGrace(score, t.s, t.i, "step", Number(data.by));
      });
      case "grace-remove": return edit((score) => {
        const t = need();
        M.removeGraces(score, t.s, t.i);
      });
      case "arpeggio": return edit((score) => {
        const t = need();
        M.toggleArpeggio(score, t.s, t.i);
      });
      case "gliss": return edit((score) => {
        const t = need();
        M.toggleGlissando(score, t.s, t.i);
      });
      case "tremolo": return edit((score) => {
        const t = need();
        M.setTremolo(score, t.s, t.i, Number(data.value));
      });
      case "dynamic": return edit((score) => {
        const t = need();
        M.setDynamic(score, t.s, t.i, data.name);
      });
      case "lyrics": return openWords("lyric");
      case "chord": return openWords("chord");
      // Figures on the figured bass under the staff, beat by beat; a guitar chord diagram over a note.
      case "figures": return openWords("figure");
      case "fret": return openWords("fret");
      // A diagram over the first note of each chord symbol, on the selected staff, in the selected bars or all.
      case "fret-all": return voicings().then((Voicings) => {
        const bars = selectedBarsOrNull();
        let count = 0;
        if (edit((score) => (count = Voicings.diagramsFromSymbols(score, staffOf(), bars ? { a: bars[0], b: bars[1] } : {})))) {
          say(`${count} guitar diagram${count === 1 ? "" : "s"} put, each in its chord's shape. Double-click one to change it.`);
        }
      });
      case "text": return openWords("text");
      case "expression": return openWords("expression");
      case "mark": return edit((score) => {
        const [b] = selectedBars();
        M.setMark(score, b, data.mark);
        const on = M.changeAt(score, b)?.mark === data.mark;
        say(`Bar ${barNo(b)}: ${on ? { letter: "a rehearsal letter", segno: "a segno", coda: "a coda" }[data.mark] : "mark taken away"}`);
      });
      case "jump": return edit((score) => {
        const [, b] = selectedBars();
        const jump = root.querySelector("[data-jump]").value;
        M.setJump(score, b, jump);
        say(M.changeAt(score, b)?.jump === jump ? `${M.JUMPS[jump]} at the end of bar ${barNo(b)} — Play takes it` : `Bar ${barNo(b)}: ${M.JUMPS[jump]} taken away`);
      });
      case "pedal": return edit((score) => {
        const t = need();
        M.setPedal(score, t.s, t.i, data.how);
      });
      // Edit ▸ Swap voices 1 and 2: crossed voices put back, high notes in voice 1 (#417).
      case "swap-voices": return edit((score) => {
        const [a, b] = selectedBars();
        M.swapVoices(score, staffOf(), a, b);
        say(`Voices 1 and 2 swapped in bar${a === b ? ` ${barNo(a)}` : `s ${barNo(a)}–${barNo(b)}`}`);
      });
      case "repeat": return edit((score) => {
        const [a, b] = selectedBars();
        M.toggleRepeat(score, a, b);
        say(`Bars ${barNo(a)}–${barNo(b)}${(score.repeats ?? []).some((r) => r.from === a && r.to === b) ? " repeated" : ": repeat taken away"}`);
      });
      case "ending": return edit((score) => {
        const [a, b] = selectedBars();
        const ending = M.endingFromBars(score, a, b);
        const r = score.repeats.find((x) => x.to < a && M.repeatEnd(x) >= b);
        const at = (k) => barNo(r.to + 1) + r.endings.slice(0, k).reduce((x, y) => x + y, 0);
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
      case "add-bar": return barsEdit((score) => {
        const at = M.barsOf(score);
        M.addBars(score, 1);
        return { at, removed: 0, added: 1 };
      });
      case "remove-bar": return barsEdit((score) => {
        const at = M.barsOf(score) - 1;
        M.removeLastBar(score);
        return { at, removed: 1, added: 0 };
      });
      case "insert-bar": return barsEdit((score) => {
        // Before the selected bars, or the cursor's; at the end with nothing selected.
        const at = st.sel || st.input.on ? selectedBars()[0] : M.barsOf(score);
        M.insertBars(score, at, 1);
        if (st.input.on) st.input.t = M.barStart(score, at);
        else if (st.sel) st.sel = { staff: st.sel.staff, t0: M.barStart(score, at), t1: M.barStart(score, at), head: -1 };
        say(`A bar put in as bar ${barNo(at)}`);
        return { at, removed: 0, added: 1 };
      });
      case "delete-bars": return barsEdit((score) => {
        const [a, b] = selectedBars();
        M.deleteBars(score, a, b);
        st.sel = null;
        if (st.input.on) st.input = { ...st.input, t: Math.min(st.input.t, M.barStart(score, Math.min(a, M.barsOf(score) - 1))), last: null };
        say(a === b ? `Bar ${barNo(a)} taken away` : `Bars ${barNo(a)}–${barNo(b)} taken away`);
        return { at: Math.min(a, b), removed: Math.abs(b - a) + 1, added: 0 };
      });
      // A line of chord names over the selected staff: K on its notes then types the chords, beat by beat.
      case "chord-line": return edit((score) => {
        const s = staffOf();
        M.addChordStaff(score, s);
        st.sel = { staff: s + 1, t0: 0, t1: 0, head: -1 };
        say("A line of chord names: select a note of the staff under it and press K, then Space for the next beat.");
      });
      // A figured bass under the selected staff: Figures on its notes then types them, beat by beat.
      case "figure-line": return edit((score) => {
        const s = staffOf();
        M.addFigureStaff(score, s);
        say("A figured bass: select a note of the staff over it, Insert › Figures, then Space for the next beat.");
      });
      // A finger (1–5) on the selected note's last grace note; again to take it away.
      case "grace-finger": return edit((score) => {
        const r = range() ?? (() => { throw new Error("Select the note after the grace note"); })();
        M.setGraceFingering(score, r.s, r.a, data.n);
      });
      case "add-staff": return edit((score) => {
        const [k, clef] = root.querySelector('[data-field="new-staff"]').value.split("|");
        const it = M.INSTRUMENTS[Number(k)] ?? M.INSTRUMENTS[0];
        const kit = it.drums ? { drums: true } : {};
        M.addStaff(score, { instrument: it.sound, name: it.name, short: it.short, clef: clef || it.clef || "treble", ...kit });
        const lane = score.staves.length - 1;
        st.sel = { staff: lane, t0: 0, t1: 0, head: -1 };
        // In note input, the writing goes on in the new staff, from its start (#429).
        if (st.input.on) Object.assign(st.input, { staff: lane, t: 0, last: null });
        say(`A ${it.name.toLowerCase()} staff added, under the others${st.input.on ? ": note input goes on in it" : ""}. Bars & staves › − This staff takes it away.`);
      });
      case "voice": return toVoice(Number(data.voice));
      case "voice-remove": return edit((score) => {
        const s = staffOf();
        const upper = M.upperOf(score, s);
        const had = M.voiceLanes(score, s).length;
        // The voice the cursor is in, or the staff's last.
        const voice = M.isLower(score, s) ? M.voiceOf(score, s) : had;
        M.removeVoice(score, s, voice);
        const has = M.voiceLanes(score, upper).length;
        // A lane of the staff that went: its first voice; the lanes after the staff move up.
        const moved = (lane) => (lane >= upper + had ? lane - (had - has) : lane >= upper + has ? upper : lane);
        if (st.sel) st.sel = { ...st.sel, staff: moved(st.sel.staff), head: -1 };
        st.input.staff = moved(st.input.staff);
        say(`Voice ${voice} taken away`);
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

  // ---- Keyboard -------------------------------------------------------------------

  root.addEventListener("keydown", (event) => {
    // In a field, or in the shortcuts sheet (whose Esc closes it): not the score's keys.
    const field = event.target.closest("input, textarea, select, dialog");
    if (field) return;
    // What the key does, from the one table the sheet is written from (shortcuts.js).
    const found = K.resolveKey(event, { inputOn: st.input.on, alter: currentAlter(), onButton: !!event.target.closest("button, summary") });
    if (!found) return;
    // Ctrl/⌘ + and − zoom the score, not the page; Ctrl+↑ is the browser's otherwise.
    event.preventDefault();
    const [name, data] = found;
    if (name === "escape") {
      if (st.input.on) return setInput(false);
      st.sel = null;
      return draw();
    }
    if (name === "input-back") return inputBack();
    act(name, data);
  });

  // The shortcuts sheet, written from the table the keys are found in.
  const keysList = root.querySelector("[data-keys-list]");
  if (keysList) {
    keysList.replaceChildren(...K.SHORTCUTS.flatMap(({ keys, does }) => [
      Object.assign(document.createElement("dt"), { textContent: K.keyLabel(keys, mac) }),
      Object.assign(document.createElement("dd"), { textContent: K.keyLabel(does, mac) }),
    ]));
  }

  // The shortcuts sheet closes on a click outside it, as on Esc.
  root.querySelector("[data-keys]")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
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
    const typing = ["lyrics", "chord", "text", "expression", "figures", "fret"].includes(button.dataset.act);
    const menu = button.closest(".studio-dropdown");
    if (menu) menu.open = false;
    if ((!button.closest(".studio-menubar") || menu) && !typing) sheet.focus({ preventScroll: true });
    act(button.dataset.act, { ...button.dataset, add: event.shiftKey });
  });

  // The menus: one open at a time, closed by Escape or a click elsewhere.
  const menus = [...root.querySelectorAll(".studio-dropdown")];
  for (const menu of menus) {
    menu.addEventListener("toggle", () => {
      if (menu.open) for (const other of menus) if (other !== menu) other.open = false;
    });
  }
  document.addEventListener("click", (event) => {
    for (const menu of menus) if (menu.open && !menu.contains(event.target)) menu.open = false;
  }, { signal: ctx.signal });
  // They are menus to a screen reader (role="menu"), and to the keyboard as
  // one: ↓ on a menu's name opens it at its first item, ↑ ↓ Home End move
  // between its items, ← → to the menu beside it, Escape closes it, back on
  // its name. The items that are labels (Open a file…) are reached too.
  const menuItems = (menu) => [...menu.querySelectorAll('[role="menuitem"]')].filter((item) => !item.disabled && item.getClientRects().length > 0);
  for (const menu of menus) {
    menu.querySelector("summary").setAttribute("aria-haspopup", "menu");
    for (const label of menu.querySelectorAll('label[role="menuitem"]')) label.tabIndex = -1;
  }
  const openMenu = (menu, at) => {
    menu.open = true;
    const items = menuItems(menu);
    (at === "last" ? items.at(-1) : items[0])?.focus();
  };
  root.addEventListener("keydown", (event) => {
    const menu = event.target.closest?.(".studio-dropdown") ?? (event.key === "Escape" ? menus.find((other) => other.open) : null);
    if (!menu || (event.key !== "Escape" && event.target.closest("select, input"))) return;
    const onName = event.target.matches("summary");
    const items = menuItems(menu);
    const at = items.indexOf(event.target);
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === "Escape" && menu.open) {
      handled();
      menu.open = false;
      return menu.querySelector("summary").focus();
    }
    if (onName && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      handled();
      return openMenu(menu, event.key === "ArrowUp" ? "last" : "first");
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      handled();
      const next = menus[(menus.indexOf(menu) + (event.key === "ArrowRight" ? 1 : -1) + menus.length) % menus.length];
      menu.open = false;
      if (onName) return next.querySelector("summary").focus();
      return openMenu(next, "first");
    }
    if (at < 0) return;
    const go = { ArrowDown: (at + 1) % items.length, ArrowUp: (at - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[event.key];
    if (go !== undefined) {
      handled();
      return items[go].focus();
    }
    // A label item (a file to open) is chosen as a button is.
    if ((event.key === "Enter" || event.key === " ") && event.target.matches("label")) {
      handled();
      event.target.click();
      return;
    }
    // Inside a menu, the score's keys wait: Space or ↑ there is not the score's.
    if (menu.open && event.key !== "Tab") event.stopPropagation();
  }, true);

  root.addEventListener("change", (event) => {
    const el = event.target;
    const menu = el.closest(".studio-dropdown");
    if (menu) menu.open = false;
    if (openChosen(el)) return;
    if (el.matches("select[data-field], input[type=number][data-field], input[type=checkbox][data-field]")) onField(event);
  });

  root.addEventListener("input", (event) => {
    if (event.target.matches('input[type="text"][data-field]')) onField(event);
  });

  return { act };
}
