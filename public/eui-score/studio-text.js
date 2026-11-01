// The studio's score as a model and as text (studio.js): the text read into
// the model and written back from it, every edit one Undo away, the draft
// kept, and a text opened in place of the score.

// The editor's words in the page's language (#508).
const V = new URL(import.meta.url).search;
const { tr } = await import(`./words.js${V}`);

/** Answers the score's model and text: reading, writing, the undoable edit, opening. */
export function install(ctx) {
  const { options, draftKey, sourceBox, status, st, M, Vel, editor_view_lit, score_json, source_spans } = ctx;
  const { settleHistory, draw, say, mixFromMeta, applyMix } = ctx.call;

  // ---- Model ↔ text ----------------------------------------------------------

  /** The engraver's reading of a text, with where each note is written. */
  function withSpans(text) {
    const parsed = JSON.parse(score_json(text));
    parsed.spans = JSON.parse(source_spans(text));
    return parsed;
  }

  function readText(text) {
    st.text = text;
    try {
      // Where each note is written: what the model keeps as written (\override …) is read before it.
      let parsed = null;
      let failure = null;
      try {
        parsed = withSpans(text);
      } catch (error) {
        failure = error;
      }
      // \\partCombine and \\autoChange: the model asks the engraver to read them its way (see
      // splitCombined) — even used in a variable the engraver does not read, `music = \\partCombine …`.
      const result = M.fromParsed(parsed, text, { parse: withSpans });
      if (!parsed && !result.score) throw failure;
      st.score = result.score ?? null;
      // The mixer, the velocities…: on the text's last line, a comment the engraver passes over.
      if (st.score) st.score.meta = M.readMeta(text);
      st.unsupported = result.unsupported ?? [];
      st.lost = result.lost ?? [];
      // What the engraver read and passed over (\\override, \\set …): said when the text is opened.
      st.passed = M.passedOver(parsed?.warnings ?? []);
      // The notes and rests the engraver numbers in this text.
      st.textItems = 1 + Math.max(-1, ...(parsed?.staves ?? []).flatMap((staff) => staff.events.filter((ev) => ev.k === "Note" || ev.k === "Rest").map((ev) => ev.i)));
    } catch (error) {
      st.score = null;
      st.unsupported = [];
      st.lost = [];
      st.passed = [];
    }
    st.lostNotice = "";
    mixFromMeta();
  }

  /**
   * The text read: written again from the model, unless that would drop what
   * the model does not keep — then it waits for the first edit, as long as
   * the model numbers its notes as the text does.
   */
  function adoptText() {
    if (!st.score) return;
    const { items } = M.toLilyPond(st.score);
    if (st.lost.length && items.length === st.textItems) st.items = items;
    else writeText({ undo: false });
  }

  function writeText({ undo = true } = {}) {
    if (!st.score) return;
    // The first rewrite of a text holding what the model does not keep: said, once.
    if (st.lost.length) {
      const many = st.lost.length > 1 || st.lost[0].startsWith("the settings");
      const lost = { what: st.lost.join(", ") };
      const notice = many ? tr("The score editor rewrote this piece's text without {what}: it does not keep those.", lost) : tr("The score editor rewrote this piece's text without {what}: it does not keep that.", lost);
      st.lostNotice = undo ? `${notice} ${tr("Undo puts the text back as it was.")}` : notice;
      st.lost = [];
    }
    const { source, items } = M.toLilyPond(st.score);
    st.text = source;
    st.items = items;
    if (sourceBox.value !== source) sourceBox.value = source;
  }

  function snapshot() {
    return JSON.stringify({ score: st.score, text: st.text, sel: st.sel, input: st.input, lost: st.lost });
  }

  function restore(snap) {
    const s = JSON.parse(snap);
    st.score = s.score;
    st.text = s.text;
    st.sel = s.sel;
    st.input = s.input;
    st.unsupported = [];
    if (s.lost?.length) {
      // The text as it was, with what the model does not keep.
      sourceBox.value = st.text;
      readText(st.text);
      adoptText();
    } else if (st.score) writeText();
    else {
      sourceBox.value = st.text;
      readText(st.text);
    }
    mixFromMeta();
    applyMix();
  }

  /** Runs `fn` on the model as one undoable edit; a refusal leaves everything as it was. */
  function edit(fn, { keepFuture = false } = {}) {
    if (!st.score) return say(tr("The score tools wait: this piece is edited in its text below."), true);
    if (st.written) return say(tr("Written pitch is for reading: View ▸ Written pitch again to write, at concert pitch."), true);
    const before = snapshot();
    try {
      fn(st.score);
      // A note whose pitch changed in place keeps its velocity; a note gone, its velocity with it.
      if (st.score.meta?.velocity) Vel.reconcile(JSON.parse(before).score, st.score);
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
      return say(M.plainRefusal(error.message ?? error), true);
    }
    st.past.push(before);
    if (!keepFuture) st.future = [];
    if (status.dataset.fresh !== "1") say("");
    delete status.dataset.fresh;
    saveDraft();
    draw();
    return true;
  }

  /**
   * `edit`, `fn` answering the bars it put in or took away (`{ at, removed,
   * added }`), told to `onBars` once the edit went through (#392): the app
   * sends them with the save, so the comments on later bars follow them.
   */
  function barsEdit(fn) {
    let op = null;
    const done = edit((score) => (op = fn(score)));
    if (done === true && op) options.onBars?.(op);
    return done;
  }

  // Every change ends here: the browser's draft (the playground's), and
  // whoever embeds the editor (the app, which saves to the account).
  function saveDraft({ pin = false } = {}) {
    settleHistory({ pin });
    if (draftKey) {
      try {
        localStorage.setItem(draftKey, st.text);
      } catch (error) {}
    }
    options.onChange?.(st.text);
  }

  // New, Open a file, an example: a score of its own where the embedder says
  // so (the app), else in place of this one (the playground, one draft).
  function open(text, message) {
    if (options.onOpen) return options.onOpen(text, message);
    load(text, message);
  }

  /**
   * `text` in place of the score, one Undo away. `keep`: another person's
   * changes merged in (the app's co-editing) — the selection and the cursor
   * stay where they were while their staff and bars are still there.
   * `remote`: those changes are someone else's, not a step of this
   * person's: Undo leaves them, taking back this person's steps around them.
   */
  function load(text, message, { keep = false, remote = false } = {}) {
    if (!remote) {
      st.past.push(snapshot());
      st.future = [];
    }
    replaceText(text, { keep });
    saveDraft({ pin: remote });
    draw();
    if (message || st.passed.length) say(`${message ?? ""}${passedText()}`.trim());
  }

  /** `text` read in place of the score's; `keep` (or `at`, a step's) the selection and the cursor where they still fit. */
  function replaceText(text, { keep = false, at = null } = {}) {
    const { sel, input } = at ? { sel: at.sel, input: { ...st.input, ...(at.input ?? {}) } } : st;
    sourceBox.value = text;
    readText(text);
    adoptText();
    st.sel = null;
    st.input = { ...st.input, on: false, t: 0, staff: 0, last: null };
    if (keep && st.score) {
      const end = M.barStart(st.score, M.barsOf(st.score));
      const fits = (lane, ...times) => st.score.staves[lane] && times.every((t) => t >= 0 && t < end);
      if (sel && fits(sel.staff, sel.t0, sel.t1) && (sel.lanes ?? []).every((lane) => st.score.staves[lane]) && (!sel.bars || sel.bars[1] < M.barsOf(st.score))) st.sel = sel;
      if (input?.on && fits(input.staff, input.t)) st.input = input;
    }
  }

  /** The settings the engraver passed over in the text read, briefly: " Passed over: \\override …", or "". */
  function passedText() {
    return st.passed.length ? ` ${tr("Passed over, not drawn: {what}.", { what: st.passed.join(", ") })}` : "";
  }

  return {
    readText, adoptText, writeText, snapshot, restore, edit, barsEdit, saveDraft, open, load, replaceText, passedText
  };
}
