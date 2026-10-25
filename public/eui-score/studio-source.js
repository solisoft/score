// The studio's source box (studio.js): its notes linked to the drawing's,
// and the LilyPond typed in it read back.

/** The source box linked to the drawing, and read as it is typed in. */
export function install(ctx) {
  const { root, sourceBox, st, M, source_spans } = ctx;
  const { readText, writeText, snapshot, saveDraft, range, draw } = ctx.call;

  // ---- The drawing and the text, linked -------------------------------------------
  //
  // A note clicked on the score is selected in the text, and the caret put on
  // a note in the text selects it on the score — while the text is the one
  // the model writes; typed text not yet read back links nothing.

  let written = { text: null, spans: [] };
  const textMark = root.querySelector("[data-source-mark]");

  /** Each note of the model and where the source box writes it, or null while it holds other text. */
  function writtenPlaces() {
    if (!st.score) return null;
    const { source, items } = M.toLilyPond(st.score);
    if (source !== sourceBox.value) return null;
    if (written.text !== source) {
      let spans = [];
      try {
        spans = JSON.parse(source_spans(source));
      } catch (error) {}
      written = { text: source, spans };
    }
    return items.map((it, k) => ({ ...it, span: written.spans[k] }));
  }

  /** The selection's notes, marked in the text; `select` selects them there too and scrolls to them, the focus staying where it was. */
  function showInText(select) {
    const r = range();
    const places = r && !st.input.on ? writtenPlaces() : null;
    if (!places) return markText();
    const first = places.find((p) => p.staff === r.s && p.index === r.a)?.span;
    const last = places.find((p) => p.staff === r.s && p.index === r.b)?.span;
    if (!first || !last) return markText();
    markText(first[0], last[1]);
    if (!select || document.activeElement === sourceBox) return;
    const focused = document.activeElement;
    sourceBox.setSelectionRange(first[0], last[1]);
    if (focused && focused !== sourceBox && document.activeElement === sourceBox) focused.focus({ preventScroll: true });
    const lineHeight = parseFloat(getComputedStyle(sourceBox).lineHeight) || 18;
    const top = (sourceBox.value.slice(0, first[0]).split("\n").length - 1) * lineHeight;
    if (top < sourceBox.scrollTop || top > sourceBox.scrollTop + sourceBox.clientHeight - lineHeight) {
      sourceBox.scrollTop = Math.max(0, top - 2 * lineHeight);
    }
  }

  /** Marks `from`–`to` of the text behind it, seen while the focus is elsewhere; no arguments, no mark. */
  function markText(from, to) {
    if (!textMark) return;
    textMark.replaceChildren();
    if (from == null || sourceBox.value !== written.text) return;
    const text = sourceBox.value;
    const mark = Object.assign(document.createElement("mark"), { textContent: text.slice(from, to) });
    textMark.append(text.slice(0, from), mark, text.slice(to) + "\n");
    followText();
  }

  function followText() {
    if (!textMark) return;
    textMark.scrollTop = sourceBox.scrollTop;
    textMark.scrollLeft = sourceBox.scrollLeft;
  }

  sourceBox.addEventListener("scroll", followText);
  sourceBox.addEventListener("input", () => markText());

  /** The note the caret is on in the text, selected on the score. */
  function showOnScore() {
    if (typing || st.input.on || sourceBox.selectionStart !== sourceBox.selectionEnd) return;
    const caret = sourceBox.selectionStart;
    const place = writtenPlaces()?.find((p) => p.span && p.span[0] <= caret && caret <= p.span[1]);
    if (!place) return;
    const t = M.starts(st.score.staves[place.staff])[place.index];
    if (st.sel && st.sel.staff === place.staff && st.sel.t0 === t && st.sel.t1 === t) return;
    st.sel = { staff: place.staff, t0: t, t1: t, head: -1 };
    draw();
  }

  sourceBox.addEventListener("click", showOnScore);
  sourceBox.addEventListener("keyup", (event) => {
    if (event.key.startsWith("Arrow") || ["Home", "End", "PageUp", "PageDown"].includes(event.key)) showOnScore();
  });

  let typing = null;
  sourceBox.addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      typing = null;
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
    // Rewriting it drops what the model does not keep: one Undo away.
    if (st.lost.length) st.past.push(snapshot());
    writeText();
    saveDraft();
    draw();
  });

  return { showInText };
}
