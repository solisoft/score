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
   * The piece's MIDI: the server's, or — for a piece with repeats, which the
   * server plays once — written here with every repeat played out, as the
   * playground plays it. A source the editor's model cannot read keeps the
   * server's.
   */
  function midiOf(button) {
    var server = function () {
      return fetch(button.getAttribute("data-midi")).then(function (r) {
        return r.arrayBuffer();
      });
    };
    var src = button.getAttribute("data-src");
    // The server's file plays every repeat once, and leaves out what the
    // browser's module plays: arpeggios, glissandi, ornaments.
    var repeats = /\\repeat\b/.test(src || "");
    if (!src || (!repeats && !/\\(arpeggio|glissando|trill|prall|mordent|turn)\b/.test(src))) return server();
    return Promise.all([import(ENGINE_SRC), import(MODEL_SRC)])
      .then(function (mods) {
        var E = mods[0];
        var M = mods[1];
        return E.loaded().then(function () {
          if (!repeats) return E.toMidi(src);
          var read = M.fromParsed(JSON.parse(E.engine.score_json(src)));
          if (!read.score) return server();
          return E.toMidi(M.toLilyPond(read.score, { unfold: true }).source);
        });
      })
      .catch(server);
  }

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
        handle.time = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * handle.duration;
      });
    }
    var handle = state.handle;
    if (!handle) return;
    var total = handle.duration || 0;
    var now = Math.min(Math.max(0, handle.time || 0), total);
    bar.querySelector(".score-progress-fill").style.width = total ? (100 * now) / total + "%" : "0";
    bar.querySelector(".score-progress-text").textContent = clock(now) + " / " + clock(total);
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
    var copyButton = event.target.closest("[data-score-copy]");
    if (copyButton) copy(copyButton);
  });

  // A page left behind keeps no music playing.
  document.addEventListener("soli:load", stopAll);
})();
