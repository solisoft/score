// The shared library of sections (#444), in the editor: Edit ▸ Share the
// selected bars… publishes them (POST /app/sections), and Edit ▸ Library of
// sections… finds what others shared (GET /sections/search.json), plays it,
// and puts it in the score — before the selected bar, or over it.
//
// A shared section travels twice: as the editor copies bars
// (M.copySection), to paste; and as a small score of its own — the bars on
// their staves, with their metre, key, tempo, clefs and instruments — to
// engrave and play on its page. `shareable` makes both, and has no DOM:
// tests/js/section_library.test.mjs calls it.
//
// studio-commands.js calls `install(studio)` once, then `open(name)`.

// The model at the same version as the page's.
const M = await import(`./score-model.js${new URL(import.meta.url).search}`);

const KEY_NAMES = ["C♭", "G♭", "D♭", "A♭", "E♭", "B♭", "F", "C", "G", "D", "A", "E", "B", "F♯", "C♯"];

/** The library's instruments, as SharedSection names them. */
export const INSTRUMENTS = { guitar: "Guitar", piano: "Piano", bass: "Bass", drums: "Drums", voice: "Voice", strings: "Strings", winds: "Winds", brass: "Brass", band: "Band", other: "Other" };
/** Its styles. */
export const STYLES = {
  pop: "Pop", rock: "Rock", ballad: "Ballad", folk: "Folk", country: "Country", blues: "Blues", jazz: "Jazz", swing: "Swing", bossa: "Bossa nova",
  latin: "Latin", reggae: "Reggae", funk: "Funk", soul: "Soul", gospel: "Gospel", waltz: "Waltz", classical: "Classical", metal: "Metal",
  electronic: "Electronic", other: "Other",
};

/** The library's instrument for lane `s`, from its staff's instrument. */
export function instrumentOfLane(score, s) {
  if (M.isDrums(score, s)) return "drums";
  const it = M.INSTRUMENTS[M.instrumentOf(score, s)];
  if (!it) return "other";
  if (/bass/i.test(it.name) && it.family !== "Voices") return "bass";
  return { Keyboards: "piano", Guitars: "guitar", Strings: "strings", Woodwinds: "winds", Brass: "brass", Voices: "voice", Percussion: "other" }[it.family] ?? "other";
}

/**
 * Bars `a` to `b` of lanes `lanes` made shareable, titled `title`:
 * { section, source, time, key, bpm, bars, tracks, instrument } — `section`
 * as copySection makes it (its staves numbered one after another, gaps
 * left out), `source` the LilyPond of a score of its own: each staff copied
 * with its instrument and clef, in the metre, key and tempo of bar `a`.
 */
export function shareable(score, lanes, a, b, title = "") {
  const [from, to] = [Math.min(a, b), Math.max(a, b)];
  const copied = M.copySection(score, lanes, from, to);
  // The staves copied, in order: a part's offset becomes its staff's place among them.
  const numbers = [...new Set(copied.parts.map((part) => part.offset))].sort((x, y) => x - y);
  const section = { bars: copied.bars, parts: copied.parts.map((part) => ({ ...part, offset: numbers.indexOf(part.offset) })) };
  const first = Math.min(...lanes.map((s) => M.staffNumber(score, s)));
  const all = M.staffLanes(score);
  const uppers = numbers.map((n) => all[first + n]);
  const t0 = M.barStart(score, from);
  const time = M.timeAt(score, from);
  const tempo = M.tempoAt(score, from);
  const key = M.keyOf(score, uppers[0], t0);
  const mini = M.newScore({ header: { title: title || "Section" }, key, time: [...time], tempo: tempo?.bpm ? { text: "", base: tempo.base ?? 4, bpm: tempo.bpm } : null, group: "none" });
  mini.staves = uppers.map((u) => {
    const staff = score.staves[u];
    const drums = M.isDrums(score, u);
    return { name: staff.name ?? "", short: staff.short ?? "", instrument: staff.instrument ?? "", clef: drums ? "percussion" : M.clefAt(score, u, from), events: [], ...(drums ? { drums: true } : {}) };
  });
  M.ensureLength(mini, M.barStart(mini, section.bars));
  M.pasteSection(mini, 0, 0, section);
  const kinds = [...new Set(uppers.map((u) => instrumentOfLane(score, u)))];
  return {
    section,
    source: M.toLilyPond(mini).source,
    time: `${time[0]}/${time[1]}`,
    key: uppers.every((u) => M.isDrums(score, u)) ? "" : `${KEY_NAMES[key + 7]} major`,
    bpm: tempo?.bpm ?? 0,
    bars: section.bars,
    tracks: section.parts.length,
    instrument: kinds.length === 1 ? kinds[0] : "band",
  };
}

/**
 * A section of the library (`data`: its `section` and `source`, as
 * data.json answers) put in `score` (#451): at its start when it holds
 * nothing but rests, else after its last bar; in the section's metre from
 * there. Each of the section's staves goes on a staff of the score with its
 * instrument (the drums on drums), the first not taken; one is added when
 * there is none, so nothing is written over another instrument. `parse` is
 * the engraver's reading of a text (score_json). Answers { at, bars, added },
 * `added` the names of the staves added.
 */
export function importSection(score, data, parse) {
  const section = data.section;
  if (!section?.parts?.length || !section.bars) throw new Error("That section holds no bars");
  const mini = M.fromParsed(JSON.parse(parse(data.source))).score;
  const empty = score.staves.every((staff) => staff.events.every((ev) => ev.rest));
  const at = empty ? 0 : M.barsOf(score);
  if (!empty) M.addBars(score, 1);
  const [num, den] = mini.time ?? [4, 4];
  const [hereNum, hereDen] = M.timeAt(score, at);
  if (num !== hereNum || den !== hereDen) M.setTimeAt(score, at, num, den);
  M.ensureLength(score, M.barStart(score, at + section.bars));
  const taken = new Set();
  const added = [];
  const targets = M.staffLanes(mini).map((m) => {
    const wanted = mini.staves[m];
    const drums = M.isDrums(mini, m);
    const found = M.staffLanes(score).find((s) => {
      if (taken.has(s) || M.isDrums(score, s) !== drums) return false;
      const staff = score.staves[s];
      return drums || staff.instrument === wanted.instrument || (wanted.name && staff.name === wanted.name);
    });
    if (found != null) {
      taken.add(found);
      return found;
    }
    M.addStaff(score, {
      name: wanted.name ?? "",
      short: wanted.short ?? "",
      instrument: wanted.instrument ?? "acoustic grand",
      clef: drums ? "percussion" : wanted.clef ?? "treble",
      ...(drums ? { drums: true } : {}),
    });
    const lane = M.staffLanes(score).at(-1);
    taken.add(lane);
    added.push(wanted.name || M.INSTRUMENTS[wanted.instrument]?.name || "a staff");
    return lane;
  });
  for (const part of section.parts) {
    const staff = targets[part.offset];
    if (staff == null) continue;
    let lane = M.laneOfVoice(score, staff, part.voice ?? 1);
    if (lane < 0) lane = M.addVoice(score, staff, part.voice);
    M.pasteSection(score, lane, at, { bars: section.bars, parts: [{ ...part, offset: 0 }] });
  }
  return { at, bars: section.bars, added };
}

// ---- The dialogs -------------------------------------------------------------------

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

function dialog(root, kind, title) {
  const box = el("dialog", { className: `studio-keys studio-pattern studio-${kind}` });
  box.dataset[kind.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = "";
  const close = el("button", { type: "button", className: "studio-menu", textContent: "×", title: "Close" });
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", () => box.close());
  box.append(el("div", { className: "studio-keys-head" }, el("h2", { textContent: title }), close));
  box.addEventListener("click", (event) => {
    if (event.target === box) box.close();
  });
  root.append(box);
  return box;
}

function menu(name, choices, first = null) {
  const node = el("select", { name });
  if (first) node.append(new Option(first, ""));
  for (const [value, label] of Object.entries(choices)) node.append(new Option(label, value));
  return node;
}

/** The dialogs, made once; `open("share-section")` or `open("section-library")`. */
export function install(studio) {
  const { root, st, toMidi, P, say, options } = studio;

  // ---- Share the selected bars --------------------------------------------------------

  const share = dialog(root, "share-section", "Share the selected bars");
  const shareForm = el("form", { className: "studio-share-section-form" });
  const titleField = el("input", { type: "text", name: "title", maxLength: 80, required: true, placeholder: "Folk strumming in G" });
  const instrumentMenu = menu("instrument", INSTRUMENTS);
  const styleMenu = menu("style", STYLES);
  const about = el("textarea", { name: "description", rows: 3, maxLength: 1000, placeholder: "How it is played, what it goes with…" });
  const authorField = el("input", { type: "text", name: "author_name", maxLength: 60, placeholder: "Shown with what you share", autocomplete: "name", value: options.authorName ?? "" });
  const what = el("p", { className: "muted studio-pattern-note" });
  const problem = el("p", { className: "studio-share-error", hidden: true });
  problem.setAttribute("role", "alert");
  const send = el("button", { type: "submit", className: "tool tool-wide tool-primary", textContent: "Share" });
  shareForm.append(
    el("p", { className: "muted studio-pattern-note", textContent: "Everyone may hear these bars in the library of sections, rate them, comment on them and put them in their scores." }),
    what,
    el("label", { className: "tool-field" }, "Name ", titleField),
    el("label", { className: "tool-field" }, "Instrument ", instrumentMenu),
    el("label", { className: "tool-field" }, "Style ", styleMenu),
    el("label", { className: "tool-field" }, "About it ", about),
    el("label", { className: "tool-field" }, "Your name ", authorField),
    problem,
    el("div", { className: "tool-row studio-new-actions" }, send),
  );
  share.append(shareForm);
  let shared = null;

  function openShare() {
    if (!options.sectionsUrl) return say("Sharing bars needs an account: open the score in the app.", true);
    if (!st.score) return say("Sharing bars needs the score tools: this piece is edited in its text.", true);
    const bars = st.sel?.bars ?? (st.sel ? studio.selectedBarsOrNull() : null);
    if (!bars) return say("Select the bars to share first: drag across them, on one track or several", true);
    const lanes = st.sel.lanes ?? [st.sel.staff];
    try {
      shared = shareable(st.score, lanes, bars[0], bars[1]);
    } catch (error) {
      return say(error.message ?? String(error), true);
    }
    instrumentMenu.value = shared.instrument;
    what.textContent = `${shared.bars} bar${shared.bars === 1 ? "" : "s"} in ${shared.time}${shared.key ? `, ${shared.key}` : ""}, ${shared.tracks} track${shared.tracks === 1 ? "" : "s"}.`;
    problem.hidden = true;
    share.showModal();
    titleField.focus();
  }

  shareForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!shared) return;
    send.disabled = true;
    problem.hidden = true;
    const title = titleField.value.trim();
    // The source's title is the name given.
    const source = shared.source.replace(/title = "[^"]*"/, `title = ${JSON.stringify(title)}`);
    try {
      const response = await fetch(options.sectionsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...shared, source, title, description: about.value, instrument: instrumentMenu.value, style: styleMenu.value, author_name: authorField.value }),
      });
      const answer = await response.json().catch(() => ({}));
      if (!response.ok) {
        problem.textContent = answer.error ?? "The bars could not be shared: try again.";
        problem.hidden = false;
        return;
      }
      share.close();
      titleField.value = "";
      about.value = "";
      say(`Shared in the library of sections: ${location.origin}${answer.url}`);
    } catch (error) {
      problem.textContent = "No connection: the bars are not shared yet.";
      problem.hidden = false;
    } finally {
      send.disabled = false;
    }
  });

  // ---- The library of sections ----------------------------------------------------------

  const library = dialog(root, "section-library", "Library of sections");
  const search = el("form", { className: "studio-section-search", role: "search" });
  const query = el("input", { type: "search", name: "q", placeholder: "A name, a word" });
  query.setAttribute("aria-label", "Search the sections");
  const instrumentFilter = menu("instrument", INSTRUMENTS, "Every instrument");
  const styleFilter = menu("style", STYLES, "Every style");
  const order = menu("sort", { recent: "Newest first", top: "Best rated first" });
  search.append(query, instrumentFilter, styleFilter, order, el("button", { type: "submit", className: "tool", textContent: "Search" }));
  const list = el("ul", { className: "studio-section-list" });
  list.dataset.sectionList = "";
  const note = el("p", { className: "muted studio-pattern-note" });
  library.append(
    el("p", { className: "muted studio-pattern-note" }, "Bars others shared. ", el("b", { textContent: "Insert" }), " puts them before the selected bar, ", el("b", { textContent: "Write over" }), " over it."),
    search,
    note,
    list,
    el("p", { className: "muted studio-pattern-note" }, el("a", { href: options.sectionsPage ?? "/sections", target: "_blank", textContent: "Open the library in a page" }), " to read the comments and rate."),
  );

  const stars = (row) => (row.rating_count ? `★ ${row.rating} (${row.rating_count})` : "not rated");
  /** A section's bars and source, fetched once. */
  const fetched = new Map();
  async function full(row) {
    if (!fetched.has(row.id)) {
      fetched.set(row.id, fetch(`/sections/${encodeURIComponent(row.id)}/data.json`, { headers: { Accept: "application/json" } }).then((r) => {
        if (!r.ok) throw new Error("That section is no longer in the library.");
        return r.json();
      }));
    }
    return fetched.get(row.id).catch((error) => {
      fetched.delete(row.id);
      throw error;
    });
  }

  async function listen(row, button) {
    try {
      P.unlock();
      if (button.dataset.playing) {
        P.stop();
        return;
      }
      const data = await full(row);
      const bytes = await toMidi(data.source, { bpm: 100, beat: 4 });
      button.dataset.playing = "1";
      button.textContent = "■ Stop";
      const done = () => {
        delete button.dataset.playing;
        button.textContent = "▶ Listen";
      };
      const playing = await P.play(bytes, { onStop: done });
      if (!playing) done();
    } catch (error) {
      say(error.message ?? String(error), true);
    }
  }

  async function put(row, over) {
    try {
      const data = await full(row);
      if (studio.putSection(data.section, over)) library.close();
    } catch (error) {
      say(error.message ?? String(error), true);
    }
  }

  function show(rows, more) {
    list.replaceChildren(...rows.map((row) => {
      const play = el("button", { type: "button", className: "tool", textContent: "▶ Listen" });
      play.addEventListener("click", () => listen(row, play));
      const insert = el("button", { type: "button", className: "tool tool-primary", textContent: "Insert" });
      insert.addEventListener("click", () => put(row, false));
      const over = el("button", { type: "button", className: "tool", textContent: "Write over" });
      over.addEventListener("click", () => put(row, true));
      const item = el(
        "li",
        { className: "studio-section-item" },
        el("div", { className: "studio-section-what" },
          el("a", { href: row.url, target: "_blank", textContent: row.title }),
          el("small", { className: "muted", textContent: `${INSTRUMENTS[row.instrument] ?? "Other"} · ${STYLES[row.style] ?? "Other"} · ${row.bars} bar${row.bars === 1 ? "" : "s"} in ${row.time} · by ${row.author} · ${stars(row)}` })),
        el("div", { className: "tool-row" }, play, insert, over),
      );
      item.dataset.section = row.id;
      return item;
    }));
    note.textContent = rows.length ? (more ? "The first ones: search to narrow them down." : "") : "No section matches.";
  }

  async function find() {
    const params = new URLSearchParams({ q: query.value, instrument: instrumentFilter.value, style: styleFilter.value, sort: order.value });
    note.textContent = "Looking…";
    try {
      const response = await fetch(`/sections/search.json?${params}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(String(response.status));
      const answer = await response.json();
      show(answer.sections ?? [], answer.more);
    } catch (error) {
      list.replaceChildren();
      note.textContent = "The library cannot be reached: are you online?";
    }
  }

  search.addEventListener("submit", (event) => {
    event.preventDefault();
    find();
  });
  for (const filter of [instrumentFilter, styleFilter, order]) filter.addEventListener("change", find);
  library.addEventListener("close", () => P.stop());

  function openLibrary() {
    library.showModal();
    query.focus();
    find();
  }

  return {
    open(name) {
      if (name === "share-section") return openShare();
      if (name === "section-library") return openLibrary();
    },
  };
}
