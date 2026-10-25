// The studio's clipboard (studio.js): notes, or bars as a section, copied
// and pasted — the system's clipboard too.

/** Answers copy, cut and paste, of notes and of sections. */
export function install(ctx) {
  const { st, M, score_json } = ctx;
  const { barNo, edit, barsEdit, range, selectedBars, say } = ctx.call;

  // The clipboard is the system's too: what is copied goes there as
  // LilyPond, for another page or program; what another program copied is
  // pasted when it reads as music. The same text back is this page's own
  // clip, which keeps what the text cannot say.
  //
  // Selected bars are copied as a section — every track the selection
  // covers, bar for bar — which pastes over bars or goes in as new ones.
  function copy(cut) {
    if (st.sel?.bars && st.score) return copySection(cut);
    const r = range();
    if (!r) return say("Select what to copy", true);
    try {
      st.clip = M.copy(st.score, r.s, r.a, r.b);
      st.clipText = M.clipText(st.clip);
      say(`${r.b - r.a + 1} copied`);
    } catch (error) {
      return say(error.message, true);
    }
    navigator.clipboard?.writeText(st.clipText).catch(() => {});
    if (cut) edit((score) => {
      for (let i = r.b; i >= r.a; i--) M.remove(score, r.s, i);
    });
  }

  function copySection(cut) {
    const [a, b] = st.sel.bars;
    const lanes = st.sel.lanes ?? [st.sel.staff];
    let section;
    try {
      section = M.copySection(st.score, lanes, a, b);
    } catch (error) {
      return say(error.message, true);
    }
    st.clip = { section };
    st.clipText = M.sectionText(section);
    navigator.clipboard?.writeText(st.clipText).catch(() => {});
    const what = `${section.bars === 1 ? "1 bar" : `${section.bars} bars`} of ${lanes.length === 1 ? "1 track" : `${lanes.length} tracks`}`;
    if (!cut) return say(`${what} copied`);
    edit((score) => {
      const [t0, t1] = [M.barStart(score, a), M.barStart(score, b + 1)];
      for (const s of lanes) {
        const at = M.starts(score.staves[s]);
        for (let i = at.length - 1; i >= 0; i--) if (at[i] >= t0 && at[i] < t1 && !score.staves[s].events[i].rest) M.remove(score, s, i);
      }
    });
    say(`${what} cut`);
  }

  /** Where a section goes: the selected bar of the selected track (or the cursor's). */
  function sectionPlace() {
    if (st.input.on) return { lane: st.input.staff, bar: M.barAt(st.score, st.input.t) };
    if (!st.sel) return null;
    return { lane: st.sel.lanes?.[0] ?? st.sel.staff, bar: selectedBars()[0] };
  }

  function sectionSaid(skipped) {
    return skipped ? ` (${skipped === 1 ? "one track" : `${skipped} tracks`} had no staff below to go to)` : "";
  }

  /** The copied bars put in before the selected bar, as new bars: nothing written over. */
  async function insertCopied() {
    if (!st.score) return say("Inserting bars needs the score tools: this piece is edited in its text.", true);
    const place = sectionPlace();
    if (!place) return say("Select the bar to put the copied bars before", true);
    const clip = await clipboard().catch(() => null);
    if (!clip?.section) return say("Copy bars first: select them (drag across them), then Ctrl+C", true);
    let skipped = 0;
    barsEdit((score) => {
      skipped = M.insertSection(score, place.lane, place.bar, clip.section);
      selectSectionQuietly(score, place.bar, place.bar + clip.section.bars - 1, place.lane, clip.section);
      return { at: place.bar, removed: 0, added: clip.section.bars };
    });
    const n = clip.section.bars;
    say(`${n === 1 ? "1 bar" : `${n} bars`} put in as bar${n === 1 ? "" : "s"} ${barNo(place.bar)}${n === 1 ? "" : `–${barNo(place.bar + n - 1)}`}${sectionSaid(skipped)}`);
  }

  /** After a paste or an insert: the bars written selected, on the tracks they went to. */
  function selectSectionQuietly(score, a, b, lane, section) {
    const lanes = M.sectionLanes(score, lane, section);
    if (!lanes.length) return;
    const at = M.starts(score.staves[lanes[0]]);
    const last = Math.max(...at.filter((t) => t < M.barStart(score, b + 1)));
    st.sel = { staff: lanes[0], t0: M.barStart(score, a), t1: last, head: -1, bars: [a, b], lanes };
  }

  /** What to paste: the system clipboard's music, else this page's clip; null when there is none. */
  async function clipboard() {
    let text = "";
    try {
      text = (await navigator.clipboard?.readText())?.trim() ?? "";
    } catch (error) {}
    if (!text || text === st.clipText) return st.clip;
    return M.clipFromText(text, score_json);
  }

  async function paste() {
    const s = st.input.on ? st.input.staff : st.sel?.staff;
    const t = st.input.on ? st.input.t : st.sel?.t0;
    if (s == null || t == null) return say("Select where to paste", true);
    let clip;
    try {
      clip = await clipboard();
    } catch (error) {
      return say(`The clipboard's text is not music this reads: ${error.message ?? error}`, true);
    }
    if (!clip) return say("Nothing copied yet", true);
    if (clip.section) {
      if (!st.score) return say("Pasting bars needs the score tools", true);
      const place = sectionPlace();
      let skipped = 0;
      edit((score) => {
        skipped = M.pasteSection(score, place.lane, place.bar, clip.section);
        selectSectionQuietly(score, place.bar, place.bar + clip.section.bars - 1, place.lane, clip.section);
      });
      return say(`Pasted over bar${clip.section.bars === 1 ? "" : "s"} ${barNo(place.bar)}${clip.section.bars === 1 ? "" : `–${barNo(place.bar + clip.section.bars - 1)}`}${sectionSaid(skipped)}`);
    }
    edit((score) => {
      M.paste(score, s, t, clip);
      const end = t + clip.reduce((sum, p) => sum + p.ticks, 0);
      if (st.input.on) st.input.t = end;
    });
  }

  return { copy, insertCopied, paste };
}
