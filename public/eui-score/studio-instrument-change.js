// Insert ▸ Change instrument… (studio.js, #1023): the staff's player takes
// up another instrument from the selected note or bar on — the staff named
// for it on the systems after, its sound played, and a transposing one
// written as its player reads it (\transposition) — with "To Picc." in the
// rests before and the instrument's name over its first note. One edit:
// one Undo takes it back.

// The editor's words in the page's language (#508).
const V = new URL(import.meta.url).search;
const { tr } = await import(`./words.js${V}`);

/** Answers the dialog: opening it at the selection, and the change made. */
export function install(ctx) {
  const { root, st, M } = ctx;
  const { edit, range, say, instrumentName, barNo } = ctx.call;

  const dialog = root.querySelector("[data-instrument-change]");
  const choice = dialog?.querySelector("[data-instrument-change-choice]");
  // A drum kit is a staff of its own, not an instrument a player takes up on the way.
  for (const option of [...(choice?.options ?? [])]) if (M.INSTRUMENTS[Number(option.value)]?.drums) option.remove();
  // Where the dialog was opened for: { s, t }.
  let at = null;

  /** "To Picc.": what the rests before the change say. */
  const toWords = (it) => tr("To {short}", { short: it.short });

  /** All an instrument change may write over the notes, in the page's language and the score's: replaced when chosen again. */
  function known() {
    return M.INSTRUMENTS.filter((it) => !it.drums).flatMap((it) => [it.name, instrumentName(it.name), toWords(it), `To ${it.short}`]);
  }

  function openInstrumentChange() {
    if (!st.score) return say(tr("The score tools wait: this piece is edited in its text below."), true);
    const r = range();
    if (!r || !dialog) return say(tr("Select the note or the bar the new instrument starts on"), true);
    at = { s: r.s, t: M.starts(r.staff)[r.a] };
    if (at.t <= 0) return say(tr("The staff's first instrument is its own: change it in the staff's properties"), true);
    // The instrument played there, to start from.
    const now = M.instrumentAt(st.score, at.s, at.t);
    if (choice && [...choice.options].some((option) => option.value === String(now))) choice.value = String(now);
    dialog.querySelector("[data-instrument-change-where]").textContent = tr("From bar {bar}", { bar: barNo(M.barAt(st.score, at.t)) });
    dialog.showModal();
    choice?.focus();
    return true;
  }

  function applyInstrumentChange() {
    if (!at || !choice) return false;
    const k = Number(choice.value);
    const it = M.INSTRUMENTS[k];
    dialog.close();
    let done = null;
    const changed = edit((score) => {
      done = M.changeInstrument(score, at.s, at.t, k, { name: instrumentName(it.name), to: toWords(it), known: known() });
    });
    if (changed === true && done) say(tr("From bar {bar}: {name}. One Undo takes it back.", { bar: barNo(M.barAt(st.score, at.t)), name: instrumentName(it.name) }));
    return changed;
  }

  return { openInstrumentChange, applyInstrumentChange };
}
