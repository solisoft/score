// The studio's files (studio.js): a new score from a template, the score's
// properties, a part to print; a file or an example opened (LilyPond,
// MusicXML, MIDI); a link shared; the sound and the picture saved.

// Served immutable: this module's version goes to the ones it loads.
const V = new URL(import.meta.url).search;
const { tr } = await import(`./words.js${V}`);
/** The MP3 and the stems (audio-export.js), loaded the first time one is saved. */
const audioExport = () => import(`./audio-export.js${V}`);
const isMusicXmlName = (name) => /\.(musicxml|mxl|xml)$/i.test(name ?? "");
/** The MIDI file reader, loaded the first time a .mid is opened. */
const midiImport = () => import(`./midi-import.js${V}`);
const isMidiName = (name) => /\.(mid|midi|smf|kar)$/i.test(name ?? "");

/** A template's name and what it holds (score-model.js's TEMPLATES), in the page's language. */
function templateWords(template) {
  const words = {
    blank: [tr("Blank"), tr("One empty staff")],
    piano: [tr("Piano"), tr("Two staves in a brace")],
    "voice-piano": [tr("Voice and piano")],
    "lead-sheet": [tr("Lead sheet"), tr("A melody, for chord symbols and lyrics")],
    satb: [tr("Choir (SATB)")],
    "satb-piano": [tr("Choir and piano")],
    "string-quartet": [tr("String quartet")],
    "wind-quintet": [tr("Wind quintet")],
    guitar: [tr("Guitar"), tr("Treble clef an octave down")],
    band: [tr("Rock band")],
    drums: [tr("Drum kit"), tr("One drum staff, General MIDI kit")],
  }[template.id] ?? [];
  return { name: words[0] ?? template.name, about: template.about == null ? null : (words[1] ?? template.about) };
}

/** The File menu's dialogs set up; answers what opens, shares and saves files. */
export function install(ctx) {
  const { root, options, sheet, status, st, quantizeBox, loaded, toPdf, download, engine, M, P, X, musicXml } = ctx;
  const { open, refuse, say, mixHeard, soundMidi, instrumentName, edit, barNo } = ctx.call;

  // "New…": a dialog to start from a template, its title, key, metre, tempo and bars set.
  const newDialog = root.querySelector("[data-new]");
  const templateBox = newDialog.querySelector("[data-templates]");
  for (const template of M.TEMPLATES) {
    const label = Object.assign(document.createElement("label"), { className: "studio-template" });
    const radio = Object.assign(document.createElement("input"), { type: "radio", name: "template", value: template.id, id: `new-template-${template.id}`, checked: template.id === "piano" });
    const staves = template.staves.map((spec) => instrumentName(spec.name ?? spec.instrument)).filter((name, k, all) => name !== all[k - 1]);
    // The staves named as the score names them.
    const words = templateWords(template);
    label.append(radio, Object.assign(document.createElement("b"), { textContent: words.name }), Object.assign(document.createElement("small"), { textContent: words.about ?? staves.join(", ") }));
    templateBox.append(label);
  }
  for (const close of newDialog.querySelectorAll("[data-new-close]")) close.addEventListener("click", () => newDialog.close());
  const propertiesDialog = root.querySelector("[data-properties]");
  propertiesDialog?.querySelector("[data-properties-close]").addEventListener("click", () => propertiesDialog.close());
  propertiesDialog?.addEventListener("click", (event) => {
    if (event.target === propertiesDialog) propertiesDialog.close();
  });
  newDialog.addEventListener("click", (event) => {
    if (event.target === newDialog) newDialog.close();
  });
  newDialog.querySelector("[data-new-form]").addEventListener("submit", (event) => {
    const form = new FormData(event.target);
    const template = M.TEMPLATES.find((t) => t.id === form.get("template"));
    try {
      const metre = M.metreOf(form.get("time"));
      const score = M.fromTemplate(template.id, {
        title: form.get("title").trim(),
        composer: form.get("composer").trim(),
        key: Number(form.get("key")),
        time: metre.time,
        bpm: Number(form.get("bpm")) || 0,
        bars: Number(form.get("bars")) || 16,
        pickup: M.pickupOf(form.get("pickup") ?? ""),
      });
      score.timeParts = metre.parts;
      open(M.toLilyPond(score).source, tr("A new score: {template}. Press N, then the letters, to write notes.", { template: templateWords(template).name.toLowerCase() }));
    } catch (error) {
      event.preventDefault();
      say(error.message, true);
    }
  });

  // File ▸ Parts…: one staff, written as its player reads it, laid out on its
  // own (#1018): its breaks, staff size, systems a page, spreading and space
  // between systems are the part's alone (score-model.js, setPartBreak and
  // setPartLayout), each an edit of the score: undone, saved and shared with it.
  const partsDialog = root.querySelector("[data-parts]");
  const partsStaff = partsDialog?.querySelector("[data-parts-staff]");
  const partsStatus = partsDialog?.querySelector("[data-parts-status]");
  const partLane = () => Number(partsStaff.value);
  // On a staff of two parts (\\partCombine, #1021) each desk is a part: its lane is the part's.
  const partSource = () => M.toLilyPond(M.partOf(st.score, partLane(), M.partOfLane(st.score, partLane())), { written: true }).source;
  const partName = () => partsStaff.selectedOptions[0]?.textContent ?? "part";
  async function previewPart() {
    await loaded();
    const box = partsDialog.querySelector("[data-parts-preview]");
    try {
      box.innerHTML = engine.svg(partSource(), 560, 5.5, "{}");
    } catch (error) {
      box.textContent = error.message ?? String(error);
    }
  }
  /** The part's own layout shown: its fields, and its breaks, each with a button that takes it away. */
  function showPartLayout() {
    const layout = M.partLayout(st.score, partLane());
    for (const field of partsDialog.querySelectorAll("[data-parts-field]")) {
      const value = layout[field.dataset.partsField];
      if (field.type === "checkbox") {
        // Not set, the part spreads its lines as the score does.
        field.checked = value ?? Boolean(st.score.paper?.evenPages);
        continue;
      }
      // A value the list does not offer (set in the text) is shown too.
      for (const option of field.querySelectorAll("[data-parts-own]")) option.remove();
      if (value != null && ![...field.options].some((option) => option.value === String(value))) {
        const own = new Option(String(value), String(value));
        own.dataset.partsOwn = "";
        field.append(own);
      }
      field.value = value == null ? "" : String(value);
    }
    const list = partsDialog.querySelector("[data-parts-breaks]");
    list.replaceChildren(...Object.entries(layout.breaks).sort(([a], [b]) => Number(a) - Number(b)).map(([bar, kind]) => {
      const n = barNo(Number(bar));
      const item = document.createElement("li");
      const said = kind === "page" ? tr("New page after bar {n}", { n }) : tr("New line after bar {n}", { n });
      const remove = Object.assign(document.createElement("button"), { type: "button", className: "tool", textContent: tr("Remove") });
      remove.dataset.partsRemove = bar;
      remove.setAttribute("aria-label", `${tr("Remove")}: ${said}`);
      item.append(Object.assign(document.createElement("span"), { textContent: said }), remove);
      return item;
    }));
    partsDialog.querySelector("[data-parts-reset]").disabled = !st.score.meta?.parts?.[String(partLane())];
  }
  /** One change to the part's layout, as an edit of the score; a refusal is said in the dialog, and nothing changes. */
  function partEdit(change, said = "") {
    let refusal = "";
    const done = edit((score) => {
      try {
        change(score);
      } catch (error) {
        refusal = error.message ?? String(error);
        throw error;
      }
    });
    // What the editor itself refuses (a piece edited in its text, written pitch) is on its status line.
    partsStatus.textContent = done ? said : refusal || status.textContent;
    partsStatus.classList.toggle("studio-error", !done);
    showPartLayout();
    return done ? previewPart() : undefined;
  }
  function openParts() {
    if (!st.score) return say(tr("A part needs the score tools: this piece is edited in its text."), true);
    // One part a staff — and one a desk, where two share a staff.
    partsStaff.replaceChildren(...M.partList(st.score).map((part) => {
      const known = M.INSTRUMENTS[M.instrumentOf(st.score, part.lane)];
      const unnamed = (known ? instrumentName(known.name) : null) || tr("Staff {n}", { n: part.staff + 1 });
      return new Option(part.name || (part.desk ? `${unnamed} ${part.desk}` : unnamed), String(part.lane));
    }));
    partsStatus.textContent = "";
    showPartLayout();
    partsDialog.showModal();
    return previewPart();
  }
  partsStaff?.addEventListener("change", () => {
    partsStatus.textContent = "";
    showPartLayout();
    return previewPart();
  });
  partsDialog?.querySelector("[data-parts-layout]").addEventListener("change", (event) => {
    const field = event.target.closest("[data-parts-field]");
    if (!field) return;
    const value = field.type === "checkbox" ? field.checked : field.value;
    partEdit((score) => M.setPartLayout(score, partLane(), { [field.dataset.partsField]: value }));
  });
  partsDialog?.querySelector("[data-parts-layout]").addEventListener("click", (event) => {
    const lane = partLane();
    const remove = event.target.closest("[data-parts-remove]");
    if (remove) return partEdit((score) => M.setPartBreak(score, lane, Number(remove.dataset.partsRemove), null));
    if (event.target.closest("[data-parts-reset]")) return partEdit((score) => M.resetPartLayout(score, lane), tr("This part is laid out as the score is."));
    const kind = event.target.closest("[data-parts-break]")?.dataset.partsBreak;
    if (!kind) return undefined;
    const box = partsDialog.querySelector("[data-parts-bar]");
    const n = Number(box.value);
    // The number the score shows: after a pickup, the pickup is bar 0.
    const bar = box.value.trim() === "" || !Number.isInteger(n) ? NaN : n - M.barNumber(st.score, 0);
    const said = kind === "page" ? tr("A new page after bar {n}, in this part alone.", { n }) : tr("A new line after bar {n}, in this part alone.", { n });
    return partEdit((score) => M.setPartBreak(score, lane, bar, kind), said)?.then(() => {
      box.value = "";
    });
  });
  partsDialog?.querySelector("[data-parts-close]").addEventListener("click", () => partsDialog.close());
  partsDialog?.querySelector("[data-parts-ly]").addEventListener("click", () => download(partSource(), `${fileName()} - ${partName()}.ly`, "text/x-lilypond"));
  partsDialog?.querySelector("[data-parts-pdf]").addEventListener("click", () => {
    toPdf(partSource(), `${title()} — ${partName()}`).then((pdf) => download(pdf, `${fileName()} - ${partName()}.pdf`, "application/pdf")).catch((e) => refuse(e));
  });

  // File ▸ Margins and spacing (#1025): the page's margins, the first
  // system's indent and three spaces, each empty for the engraver's default
  // (score-model.js, setPageSpacing). Applied as one edit of the score:
  // undone, saved and shared with it; a refusal is said in the dialog and
  // changes nothing. The preview is the first page: the music engraved at
  // the width the margins leave, placed inside them.
  const spacingDialog = root.querySelector("[data-page-spacing]");
  const spacingStatus = spacingDialog?.querySelector("[data-page-spacing-status]");
  const spacingFields = () => [...(spacingDialog?.querySelectorAll("[data-spacing]") ?? [])];
  /** The fields filled from the score: its values, empty where the default holds, the default shown then. */
  function fillSpacing() {
    const now = M.pageSpacing(st.score);
    for (const field of spacingFields()) {
      const spec = M.PAGE_SPACING.find(([name]) => name === field.dataset.spacing);
      field.value = now[spec[0]] == null ? "" : String(now[spec[0]]);
      field.placeholder = tr("default: {value}", { value: spec[4] });
    }
  }
  /** The first page, its paper's shape, the music inside its margins. */
  async function previewSpacing() {
    await loaded();
    const box = spacingDialog.querySelector("[data-page-spacing-preview]");
    const now = M.pageSpacing(st.score);
    const usual = Object.fromEntries(M.PAGE_SPACING.map((spec) => [spec[0], spec[4]]));
    const mm = (field) => now[field] ?? usual[field];
    const name = String(st.score.paper?.size ?? "a4");
    const sizes = { a4: [210, 297], letter: [215.9, 279.4], a3: [297, 420], a5: [148, 210], legal: [215.9, 355.6], tabloid: [279.4, 431.8] };
    const [w, h] = sizes[name.replace(/landscape$/, "")] ?? sizes.a4;
    const [width, height] = name.endsWith("landscape") ? [h, w] : [w, h];
    // Pixels a millimetre, the page 320 px wide; a staff space is a quarter of the staff size (the staff's height, in points).
    const k = 320 / width;
    const space = ((st.score.paper?.staffSize ?? 20) / 4) * 0.3528 * k;
    const page = document.createElement("div");
    page.className = "studio-spacing-page";
    page.style.width = `${Math.round(width * k)}px`;
    page.style.height = `${Math.round(height * k)}px`;
    const music = document.createElement("div");
    music.className = "studio-spacing-music";
    Object.assign(music.style, { left: `${mm("left") * k}px`, right: `${mm("right") * k}px`, top: `${mm("top") * k}px`, bottom: `${mm("bottom") * k}px` });
    page.append(music);
    try {
      music.innerHTML = engine.svg(M.toLilyPond(st.score).source, Math.max(40, (width - mm("left") - mm("right")) * k), space, "{}");
    } catch (error) {
      music.textContent = error.message ?? String(error);
    }
    box.replaceChildren(page);
  }
  function openSpacing() {
    if (!st.score) return say(tr("Margins and spacing need the score tools: this piece is edited in its text."), true);
    spacingStatus.textContent = "";
    spacingStatus.classList.remove("studio-error");
    fillSpacing();
    spacingDialog.showModal();
    return previewSpacing();
  }
  /** What the fields say set on the score, one edit; a refusal said in the dialog, the fields left as typed. */
  function applySpacing(values) {
    let refusal = "";
    const done = edit((score) => {
      try {
        M.setPageSpacing(score, values);
      } catch (error) {
        refusal = error.message ?? String(error);
        throw error;
      }
    });
    spacingStatus.textContent = done ? tr("Margins and spacing set.") : refusal || status.textContent;
    spacingStatus.classList.toggle("studio-error", !done);
    if (!done) return undefined;
    fillSpacing();
    return previewSpacing();
  }
  spacingDialog?.querySelector("[data-page-spacing-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    applySpacing(Object.fromEntries(spacingFields().map((field) => [field.dataset.spacing, field.value])));
  });
  spacingDialog?.querySelector("[data-page-spacing-defaults]").addEventListener("click", () => {
    applySpacing(Object.fromEntries(spacingFields().map((field) => [field.dataset.spacing, ""])));
  });
  spacingDialog?.querySelector("[data-page-spacing-close]").addEventListener("click", () => spacingDialog.close());
  spacingDialog?.addEventListener("click", (event) => {
    if (event.target === spacingDialog) spacingDialog.close();
  });

  /** File ▸ Open a file or an example, chosen in `el`: opened, and true; false for any other control. */
  function openChosen(el) {
    if (el.matches('[data-act="example"]') && el.value) {
      const path = `${options.examples ?? "/examples"}/${el.value}/source.ly`;
      el.value = "";
      fetch(path).then((r) => r.text()).then((text) => open(text, tr("Example opened."))).catch(() => say(tr("Could not open that example"), true));
      return true;
    }
    if (el.matches('[data-act="open"]') && el.files?.[0]) {
      const file = el.files[0];
      el.value = "";
      // What another program wrote, read as LilyPond; what it holds that the
      // editor does not write is named, and where the file becomes a score of
      // its own (the app), asked about first.
      const opened = ({ source, warnings }) => {
        const left = warnings.length ? tr("Left out: {what}.", { what: warnings.join("; ") }) : "";
        const said = { file: file.name, left };
        if (left && options.onOpen && !confirm(tr("{file}: {left}\n\nOpen it as a new score anyway?", said))) return say(tr("{file} not opened. {left}", said), true);
        open(source, left ? tr("{file} opened. {left}", said) : tr("{file} opened.", said));
      };
      const failed = (error) => say(error.message ?? String(error), true);
      if (isMidiName(file.name)) {
        // A MIDI file: its tracks as staves, its notes fitted to the Quantize grid.
        const grid = quantizeBox?.value ?? "sixteenth";
        const title = file.name.replace(/\.[^.]+$/, "");
        Promise.all([midiImport(), file.arrayBuffer()]).then(([I, bytes]) => opened(I.fromMidi(new Uint8Array(bytes), { title, grid }))).catch(failed);
        return true;
      }
      if (!isMusicXmlName(file.name)) {
        file.text().then((text) => open(text, tr("{file} opened.", { file: file.name })));
        return true;
      }
      // MusicXML, from MuseScore, Sibelius, Finale or Dorico: read as LilyPond.
      musicXml()
        .then(async (X) => X.fromMusicXML(await X.musicXmlOf(file)))
        .then(opened)
        .catch(failed);
      return true;
    }
    return false;
  }

  /** Copies a link holding the score; where the clipboard is refused, shows it to copy by hand. */
  async function share() {
    const inApp = typeof options.scoreUrl === "string";
    const link = inApp ? new URL(options.scoreUrl, location.origin).href : `${location.origin}${location.pathname}#s=${await M.shareCode(st.text)}`;
    try {
      await navigator.clipboard.writeText(link);
      if (inApp) return say(tr("Link copied: it opens this score for those it is shared with."));
      return say(tr("Link copied: whoever opens it gets this score. It lives in the link, not on the site."));
    } catch (error) {
      say(tr("Copy this link:"));
      const field = Object.assign(document.createElement("input"), { type: "text", value: link, readOnly: true, className: "studio-link" });
      field.setAttribute("aria-label", tr("Link to this score"));
      status.append(" ", field);
      field.select();
    }
  }

  function title() {
    return st.score?.header.title || (st.text.match(/title\s*=\s*"([^"]*)"/)?.[1] ?? "score");
  }

  function fileName() {
    return title().trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "score";
  }

  // ---- Sound and picture, to files ---------------------------------------------------

  /** What is heard on Play — every repeat played out, the muted staves left out — as a WAV file. */
  async function saveWav() {
    let bytes;
    try {
      bytes = await soundMidi();
    } catch (error) {
      return refuse(error);
    }
    const muted = st.score ? M.channels(st.score).filter(({ lane }) => !X.audible(mixHeard(), lane)).map(({ channel }) => channel) : [];
    say(tr("Making the WAV file…"));
    try {
      const wav = await P.renderWav(bytes, { muted, onProgress: (f) => say(tr("Loading the sounds… {percent} % (38 MB, once)", { percent: Math.round(100 * f) })) });
      download(wav, `${fileName()}.wav`, "audio/wav");
      say(tr("{file} saved — {size} MB", { file: `${fileName()}.wav`, size: (wav.size / 1048576).toFixed(1) }));
    } catch (error) {
      say(tr("The WAV file could not be made: {error}", { error: error.message ?? error }), true);
    }
  }

  /** The sound as an MP3, or the stems (a WAV a staff, in a zip): audio-export.js. */
  async function saveSound(kind) {
    let bytes;
    try {
      bytes = await soundMidi();
    } catch (error) {
      return refuse(error);
    }
    const ex = await audioExport();
    const common = { P, midi: bytes, name: fileName(), say, download };
    if (kind === "mp3") {
      const muted = st.score ? M.channels(st.score).filter(({ lane }) => !X.audible(mixHeard(), lane)).map(({ channel }) => channel) : [];
      return ex.saveMp3({ ...common, muted });
    }
    if (!st.score) return say(tr("The stems are made from the score the editor reads; this text holds what it does not edit."), true);
    const tracks = M.channels(st.score);
    // Each staff alone: the others muted, its own mute and every solo let go.
    const alone = (lane) => {
      let mix = X.mixOf(st.score);
      if (lane != null) for (const t of tracks) mix = X.patched(mix, t.lane, { mute: t.lane !== lane, solo: false }) ?? {};
      st.stemMix = lane == null ? null : mix;
    };
    return ex.saveStems({ ...common, tracks, alone });
  }

  /** The score as a picture: SVG as drawn, or PNG at twice its size — on white, in black ink, nothing selected. */
  async function saveImage(png) {
    await loaded();
    const width = Math.max(320, Math.floor(sheet.clientWidth - 2));
    let svg;
    try {
      svg = engine.svg(st.text, width, 8, "{}");
    } catch (error) {
      return refuse(error);
    }
    // A margin all round, as on paper.
    const pad = 24;
    const [, top, inner, innerH] = svg.match(/viewBox="0 (-?\d+) (\d+) (\d+)"/).map(Number);
    const [w, h] = [inner + 2 * pad, innerH + 2 * pad];
    svg = svg
      .replace(/viewBox="[^"]*" width="\d+" height="\d+"/, `viewBox="${-pad} ${top - pad} ${w} ${h}" width="${w}" height="${h}"`)
      .replace("<svg ", '<svg color="#000" style="background:#fff" ')
      .replace("<defs>", `<rect x="${-pad}" y="${top - pad}" width="${w}" height="${h}" fill="#fff"/><defs>`);
    if (!png) return download(svg, `${fileName()}.svg`, "image/svg+xml");
    const picture = new Image();
    picture.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      await picture.decode();
      const canvas = Object.assign(document.createElement("canvas"), { width: w * 2, height: h * 2 });
      const pen = canvas.getContext("2d");
      pen.fillStyle = "#fff";
      pen.fillRect(0, 0, canvas.width, canvas.height);
      pen.drawImage(picture, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      download(blob, `${fileName()}.png`, "image/png");
    } finally {
      URL.revokeObjectURL(picture.src);
    }
  }

  return { newDialog, openParts, openSpacing, share, title, fileName, openChosen, saveWav, saveSound, saveImage };
}
