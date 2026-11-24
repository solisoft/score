// The studio's clipboard (studio.js): notes, or bars as a section, copied
// and pasted — the system's clipboard too.

// The editor's words in the page's language (#508).
const V = new URL(import.meta.url).search;
const { tr } = await import(`./words.js${V}`);
// Paste special (#1024).
const T = await import(`./score-tools.js${V}`);

/** "1 bar" or "3 bars". */
const barsCount = (n) => (n === 1 ? tr("1 bar") : tr("{n} bars", { n }));

/** "bar 4" or "bars 4–6", from bar number `a` on, `n` bars. */
const barsAt = (a, n, barNo) => (n === 1 ? tr("bar {n}", { n: barNo(a) }) : tr("bars {a}–{b}", { a: barNo(a), b: barNo(a + n - 1) }));

/** Answers copy, cut and paste, of notes and of sections. */
export function install(ctx) {
  const { st, M, score_json } = ctx;
  const { barNo, edit, barsEdit, range, ranges, multiLane, selectedBars, say } = ctx.call;

  // The clipboard is the system's too: what is copied goes there as
  // LilyPond, for another page or program; what another program copied is
  // pasted when it reads as music. The same text back is this page's own
  // clip, which keeps what the text cannot say.
  //
  // Selected bars are copied as a section — every track the selection
  // covers, bar for bar — which pastes over bars or goes in as new ones.
  function copy(cut) {
    if (st.sel?.bars && st.score) return copySection(cut);
    if (multiLane() && st.score) return copySpan(cut);
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

  /**
   * Notes of several staves drawn round on the score (#1038), from the middle
   * of a bar perhaps: copied as a section that begins where they begin, each
   * staff's notes as far after it as they were.
   */
  function copySpan(cut) {
    const lanes = st.sel.lanes;
    const chosen = ranges();
    let section;
    try {
      section = M.copySpan(st.score, lanes, st.sel.t0, st.sel.t1);
    } catch (error) {
      return say(error.message, true);
    }
    st.clip = { section };
    st.clipText = M.sectionText(section);
    navigator.clipboard?.writeText(st.clipText).catch(() => {});
    const n = chosen.reduce((sum, r) => sum + r.b - r.a + 1, 0);
    const what = { n, tracks: lanes.length === 1 ? tr("1 track") : tr("{n} tracks", { n: lanes.length }) };
    if (!cut) return say(tr("{n} notes and rests of {tracks} copied", what));
    edit((score) => {
      for (const r of chosen) for (let i = r.b; i >= r.a; i--) M.remove(score, r.s, i);
    });
    say(tr("{n} notes and rests of {tracks} cut", what));
  }

  /** After a paste of notes of several staves (#1038): what was written selected, from its first note to its last's start. */
  function selectSpanQuietly(score, t, lane, section) {
    const lanes = M.sectionLanes(score, lane, section);
    const parts = section.parts.filter((part) => part.pieces.length);
    if (!lanes.length || !parts.length) return;
    const t0 = t + Math.min(...parts.map((part) => part.at ?? 0));
    const t1 = t + Math.max(...parts.map((part) => (part.at ?? 0) + part.pieces.slice(0, -1).reduce((sum, p) => sum + p.ticks, 0)));
    st.sel = { staff: lanes[0], t0, t1, head: -1 };
    if (lanes.length > 1) st.sel.lanes = lanes;
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
    if (clip.section?.span) {
      // Notes of several staves (#1038): from the selection's (or the cursor's) time, on its track.
      if (!st.score) return say(tr("Pasting bars needs the score tools"), true);
      const lane = st.input.on ? st.input.staff : st.sel.lanes?.[0] ?? st.sel.staff;
      const from = st.input.on ? st.input.t : Math.min(st.sel.t0, st.sel.t1);
      let skipped = 0;
      edit((score) => {
        skipped = M.pasteSectionAt(score, lane, from, clip.section);
        selectSpanQuietly(score, from, lane, clip.section);
      });
      return say(`${tr("Pasted")}${sectionSaid(skipped)}`);
    }
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
   * Edit ▸ Paste special (#1024): what was copied pasted in part — `filter`
   * "notes" (without their marks), "rhythm" (on the pitches there) or
   * "marks" (on the notes there) — where Paste would put it. One edit.
   */
  async function pasteSpecial(filter) {
    const s = st.input.on ? st.input.staff : st.sel?.staff;
    const t = st.input.on ? st.input.t : st.sel?.t0;
    if (s == null || t == null) return say(tr("Select where to paste"), true);
    if (!st.score) return say(tr("Pasting bars needs the score tools"), true);
    let clip;
    try {
      clip = await clipboard();
    } catch (error) {
      return say(tr("The clipboard's text is not music this reads: {error}", { error: error.message ?? error }), true);
    }
    if (!clip) return say(tr("Nothing copied yet"), true);
    // Bars go where Paste puts them: the selected bar of the selected track.
    // Notes of several staves (#1038) from the selection's time, on its first track.
    const place = clip.section ? sectionPlace() : null;
    const lane = place ? place.lane : s;
    const at = clip.section?.span ? (st.input.on ? st.input.t : Math.min(st.sel.t0, st.sel.t1)) : place ? M.barStart(st.score, place.bar) : t;
    let skipped = 0;
    if (!edit((score) => (skipped = T.pasteSpecial(score, lane, at, clip, filter)))) return;
    const said = { notes: tr("The notes pasted, without their marks."), rhythm: tr("The rhythm pasted, on the pitches that were there."), marks: tr("The marks pasted, on the notes there.") }[filter];
    say(`${said}${sectionSaid(skipped)}`);
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

  return { copy, insertCopied, paste, pasteSpecial, putSection };
}
