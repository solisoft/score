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
  var MODEL_SRC = (script && script.getAttribute("data-model")) || "/eui-score/score-model.js";
  var MUSICXML_SRC = (script && script.getAttribute("data-musicxml")) || "/eui-score/musicxml.js";
  var FEEL_SRC = (script && script.getAttribute("data-feel")) || "/eui-score/feel.js";
  var VELOCITY_SRC = (script && script.getAttribute("data-velocity")) || "/eui-score/velocity.js";
  var PLAY_LABEL = '<span aria-hidden="true">▶</span> Play';
  var STOP_LABEL = '<span aria-hidden="true">■</span> Stop';
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
   * The piece's MIDI: the server's, or — for a piece with repeats or a D.S.,
   * which the server plays once, as written — the browser module's, which
   * plays every repeat out and takes the jumps, as the editor plays it. A
   * source the editor's model cannot read is played as written there too.
   */
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

  /** How the piece asks to be played, from its `%% eui-score` line: { swing, humanize, velocity }, or {}. */
  function feelOf(src) {
    var line = /^%% eui-score (.*)$/m.exec(src || "");
    if (!line) return {};
    try {
      return JSON.parse(line[1]) || {};
    } catch (error) {
      return {};
    }
  }

  /** The turns a looped section is played: two minutes or so of music, then it stops. */
  function turnsOf(bars) {
    return Math.max(8, Math.ceil(64 / Math.max(1, bars)));
  }

  /**
   * The MIDI as it is to be heard: as written, then each note at the force
   * set for it (velocity.js), played in a loop when asked (#457), swung and
   * humanized as the piece asks (feel.js) — the editor's own modules
   * (#453, #455). Answers { bytes, turns }.
   */
  function midiOf(button) {
    return sourceOf(button).then(function (src) {
      var meta = feelOf(src);
      var bars = Number(button.getAttribute("data-bars")) || 0;
      var loop = button.hasAttribute("data-loop") && bars > 0;
      if (!meta.swing && !meta.humanize && !meta.velocity && !loop) {
        return writtenMidi(button).then(function (bytes) { return { bytes: bytes, turns: 1 }; });
      }
      var parts = [writtenMidi(button), import(FEEL_SRC)];
      if (meta.velocity) parts.push(import(VELOCITY_SRC), import(ENGINE_SRC), import(MODEL_SRC));
      return Promise.all(parts).then(function (got) {
        var bytes = new Uint8Array(got[0]);
        var F = got[1];
        var ready = Promise.resolve(bytes);
        if (meta.velocity) {
          var Vel = got[2], E = got[3], M = got[4];
          ready = E.loaded().then(function () {
            var score = M.fromParsed(JSON.parse(E.engine.score_json(src))).score;
            return Vel.applyVelocities(score, bytes);
          }).catch(function () { return bytes; });
        }
        return ready.then(function (played) {
          var turns = 1;
          if (loop) {
            turns = turnsOf(bars);
            var turn = bars * F.barTicks(button.getAttribute("data-time") || "4/4", F.readSmf(played).division);
            played = F.loopSmf(played, turn, turns);
          }
          // Swung and humanized after the loop: no two turns quite alike.
          return { bytes: F.feel(played, { swing: meta.swing || null, humanize: meta.humanize || null }), turns: turns };
        });
      });
    });
  }

  function writtenMidi(button) {
    var server = function () {
      return fetch(button.getAttribute("data-midi")).then(function (r) {
        return r.arrayBuffer();
      });
    };
    var src = button.getAttribute("data-src");
    if (!src || !needsBrowser(src)) return server();
    // The model under its own address: each file here is versioned by itself.
    return Promise.all([import(ENGINE_SRC), import(MODEL_SRC)])
      .then(function (mods) {
        var E = mods[0];
        var M = mods[1];
        return E.loaded().then(function () {
          return E.toMidi(M.playedSource(src, E.engine.score_json), { unfold: false });
        });
      })
      .catch(server);
  }

  // Repeats and jumps, which the server's file plays once, and what it
  // leaves out that the browser's module plays: arpeggios, glissandi, ornaments.
  function needsBrowser(src) {
    return /\\(repeat|jump|arpeggio|glissando|trill|prall|mordent|turn)\b/.test(src);
  }

  /** The MIDI link: the file as Play plays it, repeats and all. */
  function saveMidi(link, event) {
    var button = link.parentElement.querySelector("[data-score-play]");
    if (!button || !needsBrowser(button.getAttribute("data-src") || "")) return;
    event.preventDefault();
    midiOf(button).then(function (made) {
      var bytes = made.bytes;
      var url = URL.createObjectURL(new Blob([bytes], { type: "audio/midi" }));
      var save = document.createElement("a");
      save.href = url;
      save.download = link.getAttribute("download") || "score.mid";
      document.body.appendChild(save);
      save.click();
      save.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
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
      section.__score = Promise.all([engine(), import(MODEL_SRC), fetch(section.getAttribute("data-source-url"))])
        .then(function (all) {
          return all[2].text().then(function (src) {
            var M = all[1];
            var E = all[0].engine;
            var withSpans = function (text) {
              var parsed = JSON.parse(E.score_json(text));
              parsed.spans = JSON.parse(E.source_spans(text));
              return parsed;
            };
            var read = M.fromParsed(withSpans(src), src, { parse: withSpans });
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

  var UNREAD = "This piece is written in a way the score editor does not read: its MusicXML and parts are not written from it.";

  function saveMusicXml(section) {
    readScore(section)
      .then(function (read) {
        if (!read.score) return say(section, UNREAD);
        return import(MUSICXML_SRC).then(function (X) {
          save(X.toMusicXML(read.score), section.getAttribute("data-file") + ".musicxml", "application/vnd.recordare.musicxml+xml");
          say(section, "");
        });
      })
      .catch(function (error) { say(section, "The MusicXML could not be written: " + (error.message || error)); });
  }

  /** "A part…": the staves offered, each as its player reads it. */
  function openParts(section) {
    readScore(section)
      .then(function (read) {
        if (!read.score) return say(section, UNREAD);
        var M = read.M;
        var select = section.querySelector("[data-read-part-staff]");
        select.innerHTML = "";
        M.staffLanes(read.score).forEach(function (s, n) {
          var staff = read.score.staves[s];
          var known = M.INSTRUMENTS[M.instrumentOf(read.score, s)];
          select.appendChild(new Option(staff.name || (known && known.name) || "Staff " + (n + 1), String(s)));
        });
        section.querySelector("[data-read-part]").hidden = false;
        section.querySelector("[data-read-parts]").hidden = true;
        say(section, "");
      })
      .catch(function (error) { say(section, "The parts could not be read: " + (error.message || error)); });
  }

  function savePart(section, asPdf) {
    readScore(section).then(function (read) {
      var select = section.querySelector("[data-read-part-staff]");
      var name = select.selectedOptions[0] ? select.selectedOptions[0].textContent : "part";
      var src = read.M.toLilyPond(read.M.partOf(read.score, Number(select.value)), { written: true }).source;
      var file = section.getAttribute("data-file") + " - " + name;
      if (!asPdf) return save(src, file + ".ly", "text/x-lilypond");
      return read.E.toPdf(src, section.getAttribute("data-title") + " — " + name).then(function (pdf) {
        save(pdf, file + ".pdf", "application/pdf");
      });
    }).catch(function (error) { say(section, "The part could not be written: " + (error.message || error)); });
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
        '<div class="score-progress" role="progressbar" aria-label="Playing">' +
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
    state.button.innerHTML = PLAY_LABEL;
    state.slot.innerHTML = "";
    if (playing === state) playing = null;
  }

  function stopAll() {
    if (playing && playing.handle) playing.handle.stop();
    else if (playing) reset(playing);
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
    var state = { button: button, slot: slot, handle: null, timer: 0 };
    playing = state;
    // A context made inside the click may play; one made after a download may
    // not: the player is given this one.
    var context = window.AudioContext ? new AudioContext() : null;
    button.innerHTML = STOP_LABEL;
    slot.innerHTML = '<span class="score-player-note">Loading the player…</span>';
    Promise.all([loadPlayer(), midiOf(button)])
      .then(function (both) {
        state.turns = both[1].turns;
        both[1] = both[1].bytes;
        var p = both[0];
        if (playing !== state) {
          if (context) context.close();
          return null;
        }
        p.unlock(context || undefined);
        if (!p.isReady()) slot.innerHTML = '<span class="score-player-note">Loading the sounds… (38 MB, once)</span>';
        return p.play(both[1], {
          onStop: function () { reset(state); },
          onProgress: function (f) {
            if (playing === state) slot.innerHTML = '<span class="score-player-note">Loading the sounds… ' + Math.round(100 * f) + " % (38 MB, once)</span>";
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
        reset(state);
        button.title = "The player could not be loaded.";
        slot.innerHTML = '<span class="score-player-note">The player could not be loaded.</span>';
      });
  }

  function copy(button) {
    var code = button.parentElement.querySelector("code");
    if (!code || !navigator.clipboard) return;
    navigator.clipboard.writeText(code.textContent).then(function () {
      button.textContent = "Copied ✓";
      setTimeout(function () {
        button.textContent = "Copy";
      }, 1600);
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
