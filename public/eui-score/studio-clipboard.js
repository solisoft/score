// The studio's clipboard (studio.js): notes, or bars as a section, copied
// and pasted — the system's clipboard too.

// The editor's words in the page's language (#508).
const V = new URL(import.meta.url).search;
const { tr } = await import(`./words.js${V}`);

/** "1 bar" or "3 bars". */
const barsCount = (n) => (n === 1 ? tr("1 bar") : tr("{n} bars", { n }));

/** "bar 4" or "bars 4–6", from bar number `a` on, `n` bars. */
const barsAt = (a, n, barNo) => (n === 1 ? tr("bar {n}", { n: barNo(a) }) : tr("bars {a}–{b}", { a: barNo(a), b: barNo(a + n - 1) }));

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
    if (!r) return say(tr("Select what to copy"), true);
    try {
      st.clip = M.copy(st.score, r.s, r.a, r.b);
      st.clipText = M.clipText(st.clip);
      say(tr("{n} copied", { n: r.b - r.a + 1 }));
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
    const what = { bars: barsCount(section.bars), tracks: lanes.length === 1 ? tr("1 track") : tr("{n} tracks", { n: lanes.length }) };
    if (!cut) return say(tr("{bars} of {tracks} copied", what));
    edit((score) => {
      const [t0, t1] = [M.barStart(score, a), M.barStart(score, b + 1)];
      for (const s of lanes) {
        const at = M.starts(score.staves[s]);
        for (let i = at.length - 1; i >= 0; i--) if (at[i] >= t0 && at[i] < t1 && !score.staves[s].events[i].rest) M.remove(score, s, i);
      }
    });
    say(tr("{bars} of {tracks} cut", what));
  }

  /** Where a section goes: the selected bar of the selected track (or the cursor's). */
  function sectionPlace() {
    if (st.input.on) return { lane: st.input.staff, bar: M.barAt(st.score, st.input.t) };
    if (!st.sel) return null;
    return { lane: st.sel.lanes?.[0] ?? st.sel.staff, bar: selectedBars()[0] };
  }

  function sectionSaid(skipped) {
    if (!skipped) return "";
    return ` ${skipped === 1 ? tr("(one track had no staff below to go to)") : tr("({n} tracks had no staff below to go to)", { n: skipped })}`;
  }

  /** The copied bars put in before the selected bar, as new bars: nothing written over. */
  async function insertCopied() {
    if (!st.score) return say(tr("Inserting bars needs the score tools: this piece is edited in its text."), true);
    const place = sectionPlace();
    if (!place) return say(tr("Select the bar to put the copied bars before"), true);
    const clip = await clipboard().catch(() => null);
    if (!clip?.section) return say(tr("Copy bars first: select them (drag across them), then Ctrl+C"), true);
    let skipped = 0;
    barsEdit((score) => {
      skipped = M.insertSection(score, place.lane, place.bar, clip.section);
      selectSectionQuietly(score, place.bar, place.bar + clip.section.bars - 1, place.lane, clip.section);
      return { at: place.bar, removed: 0, added: clip.section.bars };
    });
    const n = clip.section.bars;
    say(`${tr("{bars} put in as {at}", { bars: barsCount(n), at: barsAt(place.bar, n, barNo) })}${sectionSaid(skipped)}`);
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
    if (s == null || t == null) return say(tr("Select where to paste"), true);
    let clip;
    try {
      clip = await clipboard();
    } catch (error) {
      return say(tr("The clipboard's text is not music this reads: {error}", { error: error.message ?? error }), true);
    }
    if (!clip) return say(tr("Nothing copied yet"), true);
    if (clip.section) {
      if (!st.score) return say(tr("Pasting bars needs the score tools"), true);
      const place = sectionPlace();
      let skipped = 0;
      edit((score) => {
        skipped = M.pasteSection(score, place.lane, place.bar, clip.section);
        selectSectionQuietly(score, place.bar, place.bar + clip.section.bars - 1, place.lane, clip.section);
      });
      return say(`${tr("Pasted over {at}", { at: barsAt(place.bar, clip.section.bars, barNo) })}${sectionSaid(skipped)}`);
    }
    edit((score) => {
      M.paste(score, s, t, clip);
      const end = t + clip.reduce((sum, p) => sum + p.ticks, 0);
      if (st.input.on) st.input.t = end;
    });
  }

  /**
   * `section` (a copySection, from the shared library, #444) put in the
   * score at the selection: before the selected bar as new bars, or with
   * `over`, over the bars from there. One undoable edit; false when there is
   * no place for it.
   */
  function putSection(section, over = false) {
    if (!st.score) return say(tr("Putting bars in needs the score tools: this piece is edited in its text."), true);
    const place = sectionPlace();
    if (!place) return say(over ? tr("Select the bar to put it over first") : tr("Select the bar to put it before first"), true);
    let skipped = 0;
    const done = over
      ? edit((score) => {
          skipped = M.pasteSection(score, place.lane, place.bar, section);
          selectSectionQuietly(score, place.bar, place.bar + section.bars - 1, place.lane, section);
        })
      : barsEdit((score) => {
          skipped = M.insertSection(score, place.lane, place.bar, section);
          selectSectionQuietly(score, place.bar, place.bar + section.bars - 1, place.lane, section);
          return { at: place.bar, removed: 0, added: section.bars };
        });
    if (!done) return false;
    const n = section.bars;
    const at = barsAt(place.bar, n, barNo);
    say(`${over ? tr("Written over {at}", { at }) : tr("Put in as {at}", { at })}${sectionSaid(skipped)}`);
    return true;
  }

  return { copy, insertCopied, paste, putSection };
}
