// The studio's files (studio.js): a new score from a template, the score's
// properties, a part to print; a file or an example opened (LilyPond,
// MusicXML, MIDI); a link shared; the sound and the picture saved.

// Served immutable: this module's version goes to the ones it loads.
const V = new URL(import.meta.url).search;
/** The MP3 and the stems (audio-export.js), loaded the first time one is saved. */
const audioExport = () => import(`./audio-export.js${V}`);
const isMusicXmlName = (name) => /\.(musicxml|mxl|xml)$/i.test(name ?? "");
/** The MIDI file reader, loaded the first time a .mid is opened. */
const midiImport = () => import(`./midi-import.js${V}`);
const isMidiName = (name) => /\.(mid|midi|smf|kar)$/i.test(name ?? "");

/** The File menu's dialogs set up; answers what opens, shares and saves files. */
export function install(ctx) {
  const { root, options, sheet, status, st, quantizeBox, loaded, toPdf, download, engine, M, P, X, musicXml } = ctx;
  const { open, refuse, say, mixHeard, soundMidi } = ctx.call;

  // "New…": a dialog to start from a template, its title, key, metre, tempo and bars set.
  const newDialog = root.querySelector("[data-new]");
  const templateBox = newDialog.querySelector("[data-templates]");
  for (const template of M.TEMPLATES) {
    const label = Object.assign(document.createElement("label"), { className: "studio-template" });
    const radio = Object.assign(document.createElement("input"), { type: "radio", name: "template", value: template.id, id: `new-template-${template.id}`, checked: template.id === "piano" });
    const staves = template.staves.map((spec) => spec.name ?? spec.instrument).filter((name, k, all) => name !== all[k - 1]);
    label.append(radio, Object.assign(document.createElement("b"), { textContent: template.name }), Object.assign(document.createElement("small"), { textContent: template.about ?? staves.join(", ") }));
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
      open(M.toLilyPond(score).source, `A new score: ${template.name.toLowerCase()}. Press N, then the letters, to write notes.`);
    } catch (error) {
      event.preventDefault();
      say(error.message, true);
    }
  });

  // File ▸ Print a part…: one staff, written as its player reads it.
  const partsDialog = root.querySelector("[data-parts]");
  const partsStaff = partsDialog?.querySelector("[data-parts-staff]");
  const partSource = () => M.toLilyPond(M.partOf(st.score, Number(partsStaff.value)), { written: true }).source;
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
  function openParts() {
    if (!st.score) return say("A part needs the score tools: this piece is edited in its text.", true);
    partsStaff.replaceChildren(...M.staffLanes(st.score).map((s, n) => {
      const staff = st.score.staves[s];
      const name = staff.name || M.INSTRUMENTS[M.instrumentOf(st.score, s)]?.name || `Staff ${n + 1}`;
      return new Option(name, String(s));
    }));
    partsDialog.showModal();
    return previewPart();
  }
  partsStaff?.addEventListener("change", previewPart);
  partsDialog?.querySelector("[data-parts-close]").addEventListener("click", () => partsDialog.close());
  partsDialog?.querySelector("[data-parts-ly]").addEventListener("click", () => download(partSource(), `${fileName()} - ${partName()}.ly`, "text/x-lilypond"));
  partsDialog?.querySelector("[data-parts-pdf]").addEventListener("click", () => {
    toPdf(partSource(), `${title()} — ${partName()}`).then((pdf) => download(pdf, `${fileName()} - ${partName()}.pdf`, "application/pdf")).catch((e) => refuse(e));
  });

  /** File ▸ Open a file or an example, chosen in `el`: opened, and true; false for any other control. */
  function openChosen(el) {
    if (el.matches('[data-act="example"]') && el.value) {
      const path = `${options.examples ?? "/examples"}/${el.value}/source.ly`;
      el.value = "";
      fetch(path).then((r) => r.text()).then((text) => open(text, "Example opened.")).catch(() => say("Could not open that example", true));
      return true;
    }
    if (el.matches('[data-act="open"]') && el.files?.[0]) {
      const file = el.files[0];
      el.value = "";
      // What another program wrote, read as LilyPond; what it holds that the
      // editor does not write is named, and where the file becomes a score of
      // its own (the app), asked about first.
      const opened = ({ source, warnings }) => {
        const left = warnings.length ? `Left out: ${warnings.join("; ")}.` : "";
        if (left && options.onOpen && !confirm(`${file.name}: ${left}\n\nOpen it as a new score anyway?`)) return say(`${file.name} not opened. ${left}`, true);
        open(source, `${file.name} opened.${left ? ` ${left}` : ""}`);
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
        file.text().then((text) => open(text, `${file.name} opened.`));
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
      if (inApp) return say("Link copied: it opens this score for those it is shared with.");
      return say("Link copied: whoever opens it gets this score. It lives in the link, not on the site.");
    } catch (error) {
      say("Copy this link:");
      const field = Object.assign(document.createElement("input"), { type: "text", value: link, readOnly: true, className: "studio-link" });
      field.setAttribute("aria-label", "Link to this score");
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
    say("Making the WAV file…");
    try {
      const wav = await P.renderWav(bytes, { muted, onProgress: (f) => say(`Loading the sounds… ${Math.round(100 * f)} % (38 MB, once)`) });
      download(wav, `${fileName()}.wav`, "audio/wav");
      say(`${fileName()}.wav saved — ${(wav.size / 1048576).toFixed(1)} MB`);
    } catch (error) {
      say(`The WAV file could not be made: ${error.message ?? error}`, true);
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
    if (!st.score) return say("The stems are made from the score the editor reads; this text holds what it does not edit.", true);
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

  return { newDialog, openParts, share, title, fileName, openChosen, saveWav, saveSound, saveImage };
}
