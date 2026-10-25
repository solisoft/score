// The studio's Undo and Redo (studio.js), around others' changes too, and
// the undo history kept in this browser (undo-history.js).

/** Answers Undo and Redo, and the history kept in this browser. */
export function install(ctx) {
  const { options, draftKey, sourceBox, st, H, mergeScores, conflictLines, score_json } = ctx;
  const { readText, adoptText, snapshot, restore, saveDraft, replaceText, draw, say, applyMix } = ctx.call;

  function undo() {
    undoStep(st.past, st.future, "Undo");
  }

  function redo() {
    undoStep(st.future, st.past, "Redo");
  }

  /**
   * Undo (`from` the past, `to` the future) or Redo (the other way). A step
   * whose text is still the score's goes back as it was; one that someone
   * else's changes have come over since is taken back by a three-way merge
   * — its `after` to its `text`, on the score as it now stands — and, when
   * they changed the same bars, not at all: theirs are never undone.
   */
  function undoStep(from, to, name) {
    settleHistory();
    const back = from.at(-1);
    if (!back) return;
    const now = H.stepOf(snapshot(), null);
    if (back.after === st.text) {
      from.pop();
      if (back.snap) restore(back.snap);
      else restoreText(back);
    } else {
      const merged = mergeScores(back.after, back.text, st.text, { parse: score_json });
      if (merged.text == null) {
        const where = merged.whole ? "" : `: ${conflictLines(merged.conflicts).join("; ")}`;
        return say(`${name} stops here: the score was changed elsewhere since, where this step changed it too${where}. Those changes stay as they are.`, true);
      }
      from.pop();
      replaceText(merged.text, { keep: true, at: back });
      say(`${name}: done around the changes made elsewhere since; those stay.`);
    }
    now.after = st.text;
    to.push(now);
    // What moved is no longer only what was done since the last save: the app lines the bars up by their content.
    options.onBars?.(null);
    // The step now last leads to where it led, not to this text: around others' changes, Undo merges again.
    saveDraft({ pin: true });
    draw();
  }

  /** A step kept as its text only (an old one, or one brought back from the browser) put back. */
  function restoreText(back) {
    sourceBox.value = back.text;
    readText(back.text);
    adoptText();
    st.sel = back.sel ?? null;
    if (back.input) st.input = { ...st.input, ...back.input };
    applyMix();
  }

  // ---- The undo history, kept in this browser (undo-history.js) -----------------

  const historyKey = options.history === false ? null : (options.history ?? (draftKey ? `playground:${draftKey}` : null));
  let historyKeeper = null;
  let historyNote = "";

  /**
   * The steps just pushed (as snapshots) made steps, each with the text it
   * led to; the history kept within its memory; and saved in the browser.
   */
  function settleHistory({ pin = false } = {}) {
    for (const stack of [st.past, st.future]) {
      for (let i = 0; i < stack.length; i++) if (typeof stack[i] === "string") stack[i] = H.stepOf(stack[i], st.text);
    }
    // The last step led to the text as it now is (rewritten as the model
    // writes it, say) — unless someone else's change came over it: then it
    // stays pinned to the text it led to, and Undo merges around theirs.
    const last = st.past.at(-1);
    if (last && pin) last.pinned = true;
    else if (last && !last.pinned) last.after = st.text;
    H.keepWithin(st.past, st.future);
    historyKeeper?.save(() => ({ end: st.text, past: st.past, future: st.future }));
  }

  /** The history kept in this browser for this score, back: said in `historyNote`. */
  async function restoreHistory() {
    if (!historyKey) return;
    const backend = await H.indexedDbBackend();
    if (!backend) return;
    const store = H.historyStore(backend);
    historyKeeper = H.keeper(store, historyKey);
    addEventListener("pagehide", () => historyKeeper.flush(), { signal: ctx.signal });
    document.addEventListener("visibilitychange", () => document.hidden && historyKeeper.flush(), { signal: ctx.signal });
    // Leaving by a link (instant navigation) is not a pagehide: the history is kept before the swap.
    document.addEventListener("soli:visit", () => historyKeeper.flush(), { signal: ctx.signal });
    const kept = H.decode(await store.get(historyKey));
    if (!kept || (!kept.past.length && !kept.future.length)) return;
    const same = kept.end === st.text;
    if (!same && !options.historyAcross) return;
    // Steps taken while it was being read stay above it.
    st.past = [...kept.past, ...st.past];
    if (!st.future.length) st.future = kept.future;
    // Changed since by someone else: the last step leads to the text as it was.
    const last = st.past.at(-1);
    if (last && last.after !== st.text) last.pinned = true;
    H.keepWithin(st.past, st.future);
    const steps = st.past.length;
    historyNote = same
      ? `Your undo history is back: Edit ▸ Undo goes back ${steps} step${steps === 1 ? "" : "s"}.`
      : "Your undo history is back. The score was changed elsewhere since: Undo takes back your own steps around those changes, and stops where both changed the same bars.";
  }

  /** What restoreHistory said of the history it brought back, or "". */
  const keptHistoryNote = () => historyNote;

  return { undo, redo, settleHistory, restoreHistory, keptHistoryNote };
}
