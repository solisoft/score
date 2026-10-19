// The engraved scores' buttons: play the MIDI, copy the source.
//
// One set of listeners on `document`, installed once per tab: instant
// navigation swaps <body> and keeps `document`, so delegation keeps working
// on every page without re-running anything. The MIDI player
// (html-midi-player, over Magenta and Tone.js) is a megabyte and a half, so
// it is fetched on the first click on "Play", never before.
(function () {
  if (window.__soliScoreUi) return;
  window.__soliScoreUi = true;

  var PLAYER_SRC =
    "https://cdn.jsdelivr.net/combine/npm/tone@14.7.58,npm/@magenta/music@1.23.1/es6/core.js,npm/focus-visible@5,npm/html-midi-player@1.5.0";
  var loading = null;
  var players = [];

  function loadPlayer() {
    if (window.customElements && customElements.get("midi-player")) return Promise.resolve();
    if (!loading) {
      loading = new Promise(function (resolve, reject) {
        var script = document.createElement("script");
        script.src = PLAYER_SRC;
        script.onload = resolve;
        script.onerror = function () {
          loading = null;
          reject(new Error("player"));
        };
        document.head.appendChild(script);
      }).then(function () {
        return customElements.whenDefined("midi-player");
      });
    }
    return loading;
  }

  function stopAll() {
    players.forEach(function (player) {
      try {
        if (player.playing) player.stop();
      } catch (e) {}
    });
    players = players.filter(function (player) {
      return player.isConnected;
    });
  }

  function play(button) {
    var slot = button.parentElement.querySelector("[data-score-player]");
    if (!slot) return;
    var label = button.innerHTML;
    button.disabled = true;
    button.textContent = "Loading…";
    loadPlayer()
      .then(function () {
        stopAll();
        slot.innerHTML = "";
        var player = document.createElement("midi-player");
        player.setAttribute("sound-font", "");
        player.setAttribute("src", button.getAttribute("data-midi"));
        player.addEventListener("load", function () {
          try {
            player.start();
          } catch (e) {}
        }, { once: true });
        slot.appendChild(player);
        players.push(player);
        button.hidden = true;
      })
      .catch(function () {
        button.disabled = false;
        button.innerHTML = label;
        button.title = "The player could not be loaded.";
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
