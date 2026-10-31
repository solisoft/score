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
// The swing a section asks for, heard when it is listened to (#453).
const F = await import(`./feel.js${new URL(import.meta.url).search}`);
// Each note's force, heard when a section is listened to (#455).
const Vel = await import(`./velocity.js${new URL(import.meta.url).search}`);

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
  // How it is played goes along: a swing section swings wherever it is heard (#453).
  const feelMeta = Object.fromEntries(["swing", "humanize"].filter((k) => score.meta?.[k]).map((k) => [k, score.meta[k]]));
  if (Object.keys(feelMeta).length) mini.meta = feelMeta;
  // A brace whose staves all go along goes too, with its name (a piano's, #452).
  const kept = uppers.map((u) => M.staffNumber(score, u));
  const braces = (score.groups ?? []).filter((g) => g.kind === "brace" && kept.includes(g.first) && kept.indexOf(g.last) - kept.indexOf(g.first) === g.last - g.first);
  if (braces.length) mini.groups = braces.map((g) => ({ ...g, first: kept.indexOf(g.first), last: kept.indexOf(g.last) }));
  M.ensureLength(mini, M.barStart(mini, section.bars));
  M.pasteSection(mini, 0, 0, section);
  // Each note's force goes along, on the section's own staves and from its start (#455).
  const velocity = {};
  for (const [id, v] of Object.entries(score.meta?.velocity ?? {})) {
    const [lane, tick, key] = id.split(":").map(Number);
    const k = uppers.findIndex((u) => M.voiceLanes(score, u).includes(lane));
    if (k < 0 || tick < t0 || tick >= M.barStart(score, to + 1)) continue;
    const there = M.laneOfVoice(mini, M.staffLanes(mini)[k], M.voiceOf(score, lane));
    if (there >= 0) velocity[`${there}:${tick - t0}:${key}`] = v;
  }
  if (Object.keys(velocity).length) mini.meta = { ...(mini.meta ?? {}), velocity };
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
  const miniLanes = M.staffLanes(mini);
  const targets = new Array(miniLanes.length).fill(null);
  const addStaffLike = (wanted, drums) => {
    M.addStaff(score, {
      name: wanted.name ?? "",
      short: wanted.short ?? "",
      instrument: wanted.instrument ?? "acoustic grand",
      clef: drums ? "percussion" : wanted.clef ?? "treble",
      ...(drums ? { drums: true } : {}),
    });
    const lane = M.staffLanes(score).at(-1);
    taken.add(lane);
    return lane;
  };
  // A named brace (a piano's two staves): onto the score's brace of that name, else added with its brace.
  for (const group of (mini.groups ?? []).filter((g) => g.kind === "brace" && g.name)) {
    const size = group.last - group.first + 1;
    const lanes = M.staffLanes(score);
    const same = (score.groups ?? []).find((g) => g.kind === "brace" && g.name === group.name && g.last - g.first + 1 === size
      && lanes.slice(g.first, g.last + 1).every((s) => s != null && !taken.has(s)));
    for (let k = 0; k < size; k++) {
      const lane = same ? lanes[same.first + k] : addStaffLike(mini.staves[miniLanes[group.first + k]], false);
      taken.add(lane);
      targets[group.first + k] = lane;
    }
    if (!same) {
      const first = M.staffNumber(score, targets[group.first]);
      score.groups = [...(score.groups ?? []), { kind: "brace", first, last: first + size - 1, name: group.name, short: group.short ?? "" }];
      added.push(group.name);
    }
  }
  miniLanes.forEach((m, k) => {
    if (targets[k] != null) return;
    const wanted = mini.staves[m];
    const drums = M.isDrums(mini, m);
    const found = M.staffLanes(score).find((s) => {
      if (taken.has(s) || M.isDrums(score, s) !== drums) return false;
      const staff = score.staves[s];
      return drums || staff.instrument === wanted.instrument || (wanted.name && staff.name === wanted.name);
    });
    if (found != null) {
      taken.add(found);
      targets[k] = found;
      return;
    }
    targets[k] = addStaffLike(wanted, drums);
    added.push(wanted.name || M.INSTRUMENTS[wanted.instrument]?.name || "a staff");
  });
  for (const part of section.parts) {
    const staff = targets[part.offset];
    if (staff == null) continue;
    let lane = M.laneOfVoice(score, staff, part.voice ?? 1);
    if (lane < 0) lane = M.addVoice(score, staff, part.voice);
    M.pasteSection(score, lane, at, { bars: section.bars, parts: [{ ...part, offset: 0 }] });
  }
  // Each note's force, from the section's staves to the ones it went on, from bar `at` (#455).
  const theirs = M.readMeta(data.source) ?? {};
  const moved = {};
  const start = M.barStart(score, at);
  for (const part of section.parts) {
    const from = M.laneOfVoice(mini, miniLanes[part.offset], part.voice ?? 1);
    const to = targets[part.offset] == null ? -1 : M.laneOfVoice(score, targets[part.offset], part.voice ?? 1);
    if (from < 0 || to < 0) continue;
    for (const [id, v] of Object.entries(theirs.velocity ?? {})) {
      const [lane, tick, key] = id.split(":").map(Number);
      if (lane === from) moved[`${to}:${tick + start}:${key}`] = v;
    }
  }
  if (Object.keys(moved).length) score.meta = { ...(score.meta ?? {}), velocity: { ...(score.meta?.velocity ?? {}), ...moved } };
  // A section played humanized in a score that is not: the score is now (#455).
  if (theirs.humanize && !score.meta?.humanize) score.meta = { ...(score.meta ?? {}), humanize: theirs.humanize };
  // A swung section in a score that does not swing yet: the score swings now (#453).
  const swing = M.readMeta(data.source)?.swing ?? null;
  const swung = Boolean(swing && F.swingOf(swing) && !F.swingOf(score.meta?.swing));
  if (swung) score.meta = { ...(score.meta ?? {}), swing };
  return { at, bars: section.bars, added, swung };
}

/**
 * `data` (a section, as data.json answers) added to the editor's score by
 * importSection, as one undoable edit whose new bars the app's merge is
 * told of (`barsEdit`), and said (`say`). `parse` is score_json. Answers
 * whether it went in.
 */
export function addToScore({ barsEdit, say, parse }, data) {
  let done = null;
  const went = barsEdit((score) => {
    const before = M.barsOf(score);
    done = importSection(score, data, parse);
    return { at: before, removed: 0, added: M.barsOf(score) - before };
  });
  if (!went) return false;
  const n = done.bars;
  const bars = `bar${n === 1 ? "" : "s"} ${done.at + 1}${n === 1 ? "" : `–${done.at + n}`}`;
  const staves = done.added.length ? `, on ${done.added.length === 1 ? "a new staff" : "new staves"}: ${done.added.join(", ")}` : "";
  const swing = done.swung ? " The score swings now, as the section does (Play ▸ Swing and humanize)." : "";
  say(`“${data.title}” added as ${bars}${staves}.${swing} Undo takes it back.`);
  return true;
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
  const { root, st, toMidi, P, say, options, selectedBarsOrNull } = studio;

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
  const how = el("p", { className: "muted studio-pattern-note" });
  library.append(
    how,
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
      const meta = M.readMeta(data.source);
      let bytes = await toMidi(data.source, { bpm: 100, beat: 4 });
      if (meta.velocity && studio.parse) bytes = Vel.applyVelocities(M.fromParsed(JSON.parse(studio.parse(data.source))).score, bytes);
      // Round and round until Stop, no gap between turns (#457); swung and humanized after, no two turns alike.
      if (data.bars > 0 && data.time) {
        const turn = data.bars * F.barTicks(data.time, F.readSmf(bytes).division);
        bytes = F.loopSmf(bytes, turn, Math.max(8, Math.ceil(64 / data.bars)));
      }
      bytes = F.feel(bytes, F.feelOf(meta));
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

  // The bar chosen when the library opened, if any: where Insert and Write over go.
  let placeBar = null;

  async function put(row, how) {
    try {
      const data = await full(row);
      const went = how === "end"
        ? addToScore({ barsEdit: studio.barsEdit, say, parse: studio.parse }, data)
        : studio.putSection(data.section, how === "over");
      if (went) library.close();
    } catch (error) {
      say(error.message ?? String(error), true);
    }
  }

  function show(rows, more) {
    list.replaceChildren(...rows.map((row) => {
      const play = el("button", { type: "button", className: "tool", textContent: "▶ Listen" });
      play.addEventListener("click", () => listen(row, play));
      const add = el("button", { type: "button", className: "tool tool-primary", textContent: "Add", title: "After the last bar, each instrument on its own staff" });
      add.dataset.sectionAdd = "";
      add.addEventListener("click", () => put(row, "end"));
      const buttons = [play, add];
      // With a bar chosen: before it, or over it, as Edit ▸ Paste does.
      if (placeBar != null) {
        const insert = el("button", { type: "button", className: "tool", textContent: `Before bar ${placeBar}` });
        insert.addEventListener("click", () => put(row, "insert"));
        const over = el("button", { type: "button", className: "tool", textContent: `Over bar ${placeBar}` });
        over.addEventListener("click", () => put(row, "over"));
        buttons.push(insert, over);
      }
      // Its first bars engraved, as the library's page shows them; fetched when the row is in view.
      const preview = el("img", { className: "studio-section-preview", src: `/sections/${encodeURIComponent(row.id)}/preview.svg`, alt: "", loading: "lazy", decoding: "async" });
      const item = el(
        "li",
        { className: "studio-section-item" },
        preview,
        el("div", { className: "studio-section-what" },
          el("a", { href: row.url, target: "_blank", textContent: row.title }),
          el("small", { className: "muted", textContent: `${INSTRUMENTS[row.instrument] ?? "Other"} · ${STYLES[row.style] ?? "Other"} · ${row.bars} bar${row.bars === 1 ? "" : "s"} in ${row.time} · by ${row.author} · ${stars(row)}` })),
        el("div", { className: "tool-row" }, ...buttons),
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
    if (!st.score) return say("Adding bars needs the score tools: this piece is edited in its text.", true);
    const chosen = st.input.on ? M.barAt(st.score, st.input.t) : st.sel ? selectedBarsOrNull()?.[0] : null;
    placeBar = chosen == null ? null : studio.barNo(chosen);
    how.replaceChildren(
      "Bars others shared: ", el("b", { textContent: "▶ Listen" }), " to hear them in a loop, ", el("b", { textContent: "Add" }),
      " puts them after the last bar, each instrument on its own staff.",
      ...(placeBar == null ? [" Select a bar first to put them before it or over it."] : [` Or before bar ${placeBar}, or over it.`]),
    );
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
