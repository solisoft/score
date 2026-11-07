// The engraved scores' buttons: play the MIDI, copy the source.
//
// One set of listeners on `document`, installed once per tab: instant
// navigation swaps <body> and keeps `document`, so delegation keeps working
// on every page without re-running anything. The player
// (/eui-score/player.js: SpessaSynth and the MuseScore_General sounds) is
// fetched on the first click on "Play", never before; the sounds are 38 MB
// the first time, then kept by the browser.
(function () {
  if (window.__soliScoreUi) return;
  window.__soliScoreUi = true;

  // Its address, versioned, from the layout: this script is not a module.
  var script = document.currentScript;
  var PLAYER_SRC = (script && script.getAttribute("data-player")) || "/eui-score/player.js";
  var ENGINE_SRC = (script && script.getAttribute("data-engine")) || "/eui-score/eui-score.js";
  // What Play hears (heard.js, #682): the editor's model, velocities,
  // curves, mixer and feel, under heard.js's own version.
  var HEARD_SRC = (script && script.getAttribute("data-heard")) || "/eui-score/heard.js";
  var MUSICXML_SRC = (script && script.getAttribute("data-musicxml")) || "/eui-score/musicxml.js";
  // Every word this script shows, in the page's language (#471, #682): read
  // from <html lang> when they are shown, the page being English or French.
  // `{name}` is filled from word()'s second argument.
  var WORDS = {
    en: { play: "Play", stop: "Stop", copy: "Copy", copied: "Copied ✓", selected: "Selected: ⌘C / Ctrl+C",
      loading: "Loading the player…", sounds: "Loading the sounds…", once: "(38 MB, once)",
      failed: "The player could not be loaded.", playing: "Playing",
      midiFailed: "The MIDI file could not be made: {error}",
      unread: "This piece is written in a way the score editor does not read: its MusicXML and parts are not written from it.",
      musicxmlFailed: "The MusicXML could not be written: {error}", partsFailed: "The parts could not be read: {error}",
      partFailed: "The part could not be written: {error}", staff: "Staff {n}", part: "part" },
    fr: { play: "Lecture", stop: "Stop", copy: "Copier", copied: "Copié ✓", selected: "Sélectionné : ⌘C / Ctrl+C",
      loading: "Chargement du lecteur…", sounds: "Chargement des sons…", once: "(38 Mo, une fois)",
      failed: "Le lecteur n'a pas pu être chargé.", playing: "Lecture en cours",
      midiFailed: "Le fichier MIDI n'a pas pu être fait : {error}",
      unread: "Cette pièce est écrite d'une façon que l'éditeur de partitions ne lit pas : ni son MusicXML ni ses parties n'en sont écrits.",
      musicxmlFailed: "Le MusicXML n'a pas pu être écrit : {error}", partsFailed: "Les parties n'ont pas pu être lues : {error}",
      partFailed: "La partie n'a pas pu être écrite : {error}", staff: "Portée {n}", part: "partie" }
  };
  function word(key, vars) {
    var lang = (document.documentElement.lang || "en").slice(0, 2);
    var text = (WORDS[lang] || WORDS.en)[key];
    Object.keys(vars || {}).forEach(function (name) { text = text.split("{" + name + "}").join(String(vars[name])); });
    return text;
  }
  function errorText(error) { return (error && error.message) || String(error); }
  function playLabel() { return '<span aria-hidden="true">▶</span> ' + word("play"); }
  function stopLabel() { return '<span aria-hidden="true">■</span> ' + word("stop"); }
  var player = null;
  var playing = null; // { button, slot, handle, timer }

  function loadPlayer() {
    player = player || import(PLAYER_SRC).catch(function (error) {
      player = null;
      throw error;
    });
    return player;
  }

  /**
   * The piece's source: its button's data-src, or — a section's card, which
   * holds none — fetched once from its data-section (data.json, #455). A
   * section played in a loop (data-loop, #457) learns its bars and metre
   * there too.
   */
  function sourceOf(button) {
    var src = button.getAttribute("data-src");
    var url = button.getAttribute("data-section");
    var wantsBars = button.hasAttribute("data-loop") && !button.hasAttribute("data-bars");
    if (!url || (src && !wantsBars)) return Promise.resolve(src || "");
    return fetch(url, { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (data) {
        if (data.source && !src) button.setAttribute("data-src", data.source);
        if (data.bars && data.time) {
          button.setAttribute("data-bars", String(data.bars));
          button.setAttribute("data-time", data.time);
        }
        return src || data.source || "";
      })
      .catch(function () { return src || ""; });
  }

  /**
   * The MIDI as it is to be heard, as the editor's Play makes it (heard.js,
   * #682): each note at the force set for it, the curves drawn, the mixer's
   * levels, swung and humanized as the piece asks — and, with `loop`, a
   * section played over and over (#457). Answers { bytes, turns }; the
   * server's file, as written, when the browser cannot make it.
   */
  function midiOf(button, loop) {
    var server = function () { return writtenMidi(button); };
    return Promise.all([sourceOf(button), import(HEARD_SRC), engine().catch(function () { return null; })])
      .then(function (got) {
        var src = got[0], H = got[1], E = got[2];
        var bars = Number(button.getAttribute("data-bars")) || 0;
        var looped = loop && button.hasAttribute("data-loop") && bars > 0;
        return H.heardMidi(src, {
          midi: function (source, options) {
            if (!E || !src) return server();
            return E.toMidi(source, options).catch(server);
          },
          parse: function (text) {
            if (!E || !src) throw new Error("not read here");
            return withSpans(E.engine, text);
          },
          loop: looped ? { bars: bars, time: button.getAttribute("data-time") || "4/4" } : null,
        });
      })
      .catch(function () {
        return server().then(function (bytes) { return { bytes: bytes, turns: 1 }; });
      });
  }

  /**
   * The server's MIDI of the piece, as written. A data: URL (a page's
   * figure) is read here: the Content-Security-Policy's connect-src lets no
   * fetch reach one (#544).
   */
  function writtenMidi(button) {
    var url = button.getAttribute("data-midi") || "";
    var inline = /^data:[^,]*;base64,(.*)$/.exec(url);
    if (inline) {
      try {
        var text = atob(inline[1]);
        var bytes = new Uint8Array(text.length);
        for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
        return Promise.resolve(bytes);
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.arrayBuffer();
    }).then(function (buffer) { return new Uint8Array(buffer); });
  }

  /** The engraver's reading of `text`, with where each note is written: what the editor's model reads. */
  function withSpans(E, text) {
    var parsed = JSON.parse(E.score_json(text));
    parsed.spans = JSON.parse(E.source_spans(text));
    return parsed;
  }

  /**
   * The MIDI link: the file as Play plays it, repeats, velocities and all
   * (a section once, not looped); a word under the buttons when it cannot
   * be made.
   */
  function saveMidi(link, event) {
    var button = link.parentElement.querySelector("[data-score-play]");
    if (!button || !button.getAttribute("data-src")) return;
    event.preventDefault();
    midiOf(button, false)
      .then(function (made) { save(made.bytes, link.getAttribute("download") || "score.mid", "audio/midi"); })
      .catch(function (error) {
        var slot = link.parentElement.querySelector("[data-score-player]");
        if (!slot) return;
        slot.innerHTML = '<span class="score-player-note" role="status"></span>';
        slot.firstChild.textContent = word("midiFailed", { error: errorText(error) });
      });
  }

  /** Bytes or a string saved as a file, through a temporary link. */
  function save(data, fileName, type) {
    var url = URL.createObjectURL(new Blob([data], { type: type }));
    var link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /** The engraver, loaded. */
  function engine() {
    return import(ENGINE_SRC).then(function (E) {
      return E.loaded().then(function () { return E; });
    });
  }

  /**
   * The PDF link: printed here, on the paper the source's \paper sets (the
   * server's, which the link fetches when this cannot run, is on A4).
   */
  function savePdf(link, event) {
    var button = link.parentElement.querySelector("[data-score-play]");
    var src = button && button.getAttribute("data-src");
    if (!src) return;
    event.preventDefault();
    engine()
      .then(function (E) { return E.toPdf(src, link.getAttribute("data-title") || ""); })
      .then(function (pdf) { save(pdf, link.getAttribute("download") || "score.pdf", "application/pdf"); })
      .catch(function () { location.href = link.href; });
  }

  // ---- The read page's other files: MusicXML and parts, written here ------------------

  /**
   * The read page's score as the editor's model holds it, with the engraver
   * and the model: {E, M, score}, `score` null for a source the model cannot
   * read. Fetched once per section.
   */
  function readScore(section) {
    if (!section.__score) {
      // The model heard.js plays with: one copy of it on the page.
      section.__score = Promise.all([engine(), import(HEARD_SRC), fetch(section.getAttribute("data-source-url"))])
        .then(function (all) {
          return all[2].text().then(function (src) {
            var M = all[1].M;
            var parse = function (text) { return withSpans(all[0].engine, text); };
            var read = M.fromParsed(parse(src), src, { parse: parse });
            return { E: all[0], M: M, score: read.score || null };
          });
        });
      section.__score.catch(function () { section.__score = null; });
    }
    return section.__score;
  }

  function say(section, text) {
    var note = section.querySelector("[data-read-note]");
    if (note) note.textContent = text;
  }

  function saveMusicXml(section) {
    readScore(section)
      .then(function (read) {
        if (!read.score) return say(section, word("unread"));
        return import(MUSICXML_SRC).then(function (X) {
          save(X.toMusicXML(read.score), section.getAttribute("data-file") + ".musicxml", "application/vnd.recordare.musicxml+xml");
          say(section, "");
        });
      })
      .catch(function (error) { say(section, word("musicxmlFailed", { error: errorText(error) })); });
  }

  /** "A part…": the staves offered, each as its player reads it. */
  function openParts(section) {
    readScore(section)
      .then(function (read) {
        if (!read.score) return say(section, word("unread"));
        var M = read.M;
        var select = section.querySelector("[data-read-part-staff]");
        select.innerHTML = "";
        M.staffLanes(read.score).forEach(function (s, n) {
          var staff = read.score.staves[s];
          var known = M.INSTRUMENTS[M.instrumentOf(read.score, s)];
          select.appendChild(new Option(staff.name || (known && known.name) || word("staff", { n: n + 1 }), String(s)));
        });
        section.querySelector("[data-read-part]").hidden = false;
        section.querySelector("[data-read-parts]").hidden = true;
        say(section, "");
      })
      .catch(function (error) { say(section, word("partsFailed", { error: errorText(error) })); });
  }

  function savePart(section, asPdf) {
    readScore(section).then(function (read) {
      var select = section.querySelector("[data-read-part-staff]");
      var name = select.selectedOptions[0] ? select.selectedOptions[0].textContent : word("part");
      var src = read.M.toLilyPond(read.M.partOf(read.score, Number(select.value)), { written: true }).source;
      var file = section.getAttribute("data-file") + " - " + name;
      if (!asPdf) return save(src, file + ".ly", "text/x-lilypond");
      return read.E.toPdf(src, section.getAttribute("data-title") + " — " + name).then(function (pdf) {
        save(pdf, file + ".pdf", "application/pdf");
      });
    }).catch(function (error) { say(section, word("partFailed", { error: errorText(error) })); });
  }

  // ---- Printing (Ctrl/Cmd+P) --------------------------------------------------------
  //
  // The page prints its scores alone (application.css, @media print), one
  // picture per system, so a page turns between two systems, never across
  // one: the server marks where (data-breaks, ScoreSvg.engrave). The editor
  // does the same with its own engraving (studio.js, printCopy).

  /**
   * One SVG per band of `svg`, cut at each y of `cuts`, with ids of its own.
   * The same as printBands in public/eui-score/score-model.js (a module,
   * which this script does not load before printing): a change goes to both.
   */
  function printBands(svg, cuts) {
    var head = /^<svg\b[^>]*>/.exec(svg);
    var box = head && /viewBox="(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)"/.exec(head[0]);
    if (!box) return [svg];
    var x = Number(box[1]), y = Number(box[2]), w = Number(box[3]), h = Number(box[4]);
    var edges = [y].concat(cuts.filter(function (c) { return c > y && c < y + h; }).sort(function (a, b) { return a - b; }), [y + h]);
    var named = /<title id="([^"]+)-t"/.exec(svg);
    var prefix = named && named[1];
    var ids = prefix ? new RegExp('(["#\\s])' + prefix.replace(/[^\w]/g, "\\$&") + "-", "g") : null;
    var round = function (n) { return Math.round(n * 10) / 10; };
    return edges.slice(1).map(function (end, k) {
      var top = round(edges[k]);
      var tall = round(end - edges[k]);
      var own = head[0].replace(/viewBox="[^"]*"/, 'viewBox="' + x + " " + top + " " + w + " " + tall + '"').replace(/\sheight="[^"]*"/, ' height="' + tall + '"');
      var one = own + svg.slice(head[0].length);
      return ids ? one.replace(ids, "$1" + prefix + "-p" + k + "-") : one;
    });
  }

  function printCopies() {
    document.querySelectorAll(".score-sheet > svg[data-breaks]").forEach(function (svg) {
      var sheet = svg.parentElement;
      if (sheet.nextElementSibling && sheet.nextElementSibling.classList.contains("score-print")) return;
      var cuts = svg.getAttribute("data-breaks").split(" ").map(Number);
      var box = document.createElement("div");
      box.className = "score-print";
      box.setAttribute("aria-hidden", "true");
      box.innerHTML = printBands(svg.outerHTML, cuts).join("");
      sheet.after(box);
    });
  }

  function dropPrintCopies() {
    document.querySelectorAll(".score-print").forEach(function (box) { box.remove(); });
  }

  window.addEventListener("beforeprint", printCopies);
  window.addEventListener("afterprint", dropPrintCopies);

  function clock(sec) {
    var s = Math.max(0, Math.floor(sec));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  /** The bar under the buttons: how far the piece has played; a click plays from there. */
  function showProgress(state) {
    var bar = state.slot.querySelector(".score-progress");
    if (!bar) {
      state.slot.innerHTML =
        '<div class="score-progress" role="progressbar" aria-label="' + word("playing") + '">' +
        '<div class="score-progress-fill"></div><span class="score-progress-text"></span></div>';
      bar = state.slot.firstChild;
      bar.addEventListener("click", function (event) {
        var handle = state.handle;
        if (!handle || !handle.duration) return;
        var rect = bar.getBoundingClientRect();
        var turn = handle.duration / (state.turns || 1);
        var started = Math.floor((handle.time || 0) / turn) * turn;
        handle.time = started + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * turn;
      });
    }
    var handle = state.handle;
    if (!handle) return;
    // Played in a loop: the bar counts one turn, round and round (#457).
    var turns = state.turns || 1;
    var total = (handle.duration || 0) / turns;
    var now = Math.min(Math.max(0, (handle.time || 0) % (total || 1)), total);
    bar.querySelector(".score-progress-fill").style.width = total ? (100 * now) / total + "%" : "0";
    bar.querySelector(".score-progress-text").textContent = (turns > 1 ? "↻ " : "") + clock(now) + " / " + clock(total);
  }

  function reset(state) {
    clearInterval(state.timer);
    state.button.disabled = false;
    state.button.innerHTML = playLabel();
    state.slot.innerHTML = "";
    if (playing === state) playing = null;
  }

  function stopAll() {
    if (playing && playing.handle) playing.handle.stop();
    else if (playing) reset(playing);
  }

  /** The click's AudioContext, never handed to the player: closed. */
  function dropContext(state) {
    if (state.context) state.context.close().catch(function () {});
    state.context = null;
  }

  function play(button) {
    var slot = button.parentElement.querySelector("[data-score-player]");
    if (!slot) return;
    // A second click stops it.
    if (playing && playing.button === button) {
      var was = playing;
      if (was.handle) was.handle.stop();
      else {
        reset(was);
        if (player) player.then(function (p) { p.stop(); });
      }
      return;
    }
    stopAll();
    // A context made inside the click may play; one made after a download may
    // not: the player is given this one. Until then it is this click's, closed
    // when the player is not reached (stopped meanwhile, or failed to load).
    var state = { button: button, slot: slot, handle: null, timer: 0, context: window.AudioContext ? new AudioContext() : null };
    playing = state;
    button.innerHTML = stopLabel();
    slot.innerHTML = '<span class="score-player-note">' + word("loading") + "</span>";
    Promise.all([loadPlayer(), midiOf(button, true)])
      .then(function (both) {
        state.turns = both[1].turns;
        both[1] = both[1].bytes;
        var p = both[0];
        if (playing !== state) {
          dropContext(state);
          return null;
        }
        p.unlock(state.context || undefined);
        state.context = null;
        if (!p.isReady()) slot.innerHTML = '<span class="score-player-note">' + word("sounds") + " " + word("once") + "</span>";
        return p.play(both[1], {
          onStop: function () { reset(state); },
          onProgress: function (f) {
            if (playing === state) slot.innerHTML = '<span class="score-player-note">' + word("sounds") + " " + Math.round(100 * f) + " % " + word("once") + "</span>";
          },
        });
      })
      .then(function (handle) {
        if (!handle || playing !== state) return;
        state.handle = handle;
        showProgress(state);
        state.timer = setInterval(function () { showProgress(state); }, 250);
      })
      .catch(function () {
        dropContext(state);
        reset(state);
        button.title = word("failed");
        slot.innerHTML = '<span class="score-player-note">' + word("failed") + "</span>";
      });
  }

  function copy(button) {
    var code = button.parentElement.querySelector("code");
    if (!code || !navigator.clipboard) return;
    navigator.clipboard.writeText(code.textContent).then(function () {
      button.textContent = word("copied");
      setTimeout(function () {
        button.textContent = word("copy");
      }, 1600);
    }).catch(function () {
      // The browser keeps the clipboard to itself: the text selected, to copy by hand (#464).
      var range = document.createRange();
      range.selectNodeContents(code);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      button.textContent = word("selected");
      setTimeout(function () {
        button.textContent = word("copy");
      }, 2400);
    });
  }

  document.addEventListener("click", function (event) {
    var playButton = event.target.closest("[data-score-play]");
    if (playButton) {
      play(playButton);
      return;
    }
    var midiLink = event.target.closest("[data-score-midi]");
    if (midiLink) {
      saveMidi(midiLink, event);
      return;
    }
    var pdfLink = event.target.closest("[data-score-pdf]");
    if (pdfLink) {
      savePdf(pdfLink, event);
      return;
    }
    var section = event.target.closest("[data-read-exports]");
    if (section) {
      if (event.target.closest("[data-read-musicxml]")) saveMusicXml(section);
      else if (event.target.closest("[data-read-parts]")) openParts(section);
      else if (event.target.closest("[data-read-part-pdf]")) savePart(section, true);
      else if (event.target.closest("[data-read-part-ly]")) savePart(section, false);
      return;
    }
    var copyButton = event.target.closest("[data-score-copy]");
    if (copyButton) copy(copyButton);
  });

  // A page left behind keeps no music playing.
  document.addEventListener("soli:load", stopAll);
})();
