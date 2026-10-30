# The browser engraver's files (public/eui-score/) and the one version they
# are loaded under.
#
# They are served immutable, for a year, and a module loads the others with
# its own `?v=…`: one version for the whole set keeps a deploy's files
# together. It is a digest of the JavaScript and of `wasm.version`, which
# wasm/build.sh writes from the WebAssembly — computed once per process,
# since a deploy restarts it.
# The modules the score editor (studio.js) loads as it starts: its own
# imports, the parts it installs and what those import in turn. Each module
# asks for the next only once it has run, so on a slow line forty round trips
# came one after another (#418); the editor's page names them all at once
# (`<link rel="modulepreload">`) and the browser fetches them together. A spec
# holds this list to studio.js's imports.
const SCORE_STUDIO_MODULES = [
  "studio.js",
  "eui-score.js",
  "score-model.js",
  "player.js",
  "piano-roll.js",
  "shortcuts.js",
  "midi-sync.js",
  "mixer.js",
  "velocity.js",
  "mixer-ui.js",
  "practice.js",
  "synth.js",
  "soundbank.js",
  "mpe.js",
  "instruments-ui.js",
  "feel.js",
  "automation.js",
  "channels.js",
  "graces.js",
  "automation-ui.js",
  "audio-ui.js",
  "pitch.js",
  "takes.js",
  "follow.js",
  "mic.js",
  "undo-history.js",
  "merge.js",
  "studio-toolbox.js",
  "studio-files.js",
  "studio-text.js",
  "studio-selection.js",
  "studio-history.js",
  "studio-source.js",
  "studio-input.js",
  "studio-commands.js",
  "studio-clipboard.js",
  "studio-words.js",
  "voicings.js",
  "studio-draw.js",
  "studio-peers.js",
  "studio-roll.js",
  "studio-velocity.js",
  "studio-pointer.js",
  "studio-ghost.js",
  "ghost.js",
  "studio-playback.js",
  "studio-mix.js",
  "studio-recording.js"
]

class ScoreAssets
  static cached: String = ""

  static def version
    return ScoreAssets.cached unless ScoreAssets.cached.blank?

    parts = [
      "eui-score.js",
      "eui-score-editor.js",
      "studio.js",
      "studio-toolbox.js",
      "studio-files.js",
      "studio-text.js",
      "studio-selection.js",
      "studio-history.js",
      "studio-source.js",
      "studio-input.js",
      "studio-commands.js",
      "studio-clipboard.js",
      "studio-words.js",
      "studio-draw.js",
      "studio-peers.js",
      "studio-roll.js",
      "studio-velocity.js",
      "studio-pointer.js",
      "studio-ghost.js",
      "ghost.js",
      "studio-playback.js",
      "studio-mix.js",
      "studio-recording.js",
      "score-model.js",
      "musicxml.js",
      "midi-import.js",
      "piano-roll.js",
      "patterns.js",
      "pattern-tools.js",
      "voicings.js",
      "feel.js",
      "feel-tools.js",
      "shortcuts.js",
      "player.js",
      "midi-sync.js",
      "mixer.js",
      "mixer-ui.js",
      "velocity.js",
      "automation.js",
      "automation-ui.js",
      "audio-export.js",
      "merge.js",
      "channels.js",
      "graces.js",
      "comments.js",
      "undo-history.js",
      "pitch.js",
      "follow.js",
      "takes.js",
      "mic.js",
      "mic-worklet.js",
      "audio-ui.js",
      "practice.js",
      "synth.js",
      "soundbank.js",
      "mpe.js",
      "instruments-ui.js",
      "vendor/README.md",
      "eui_score_web.js",
      "wasm.version"
    ]
    text = parts.map do |name|
      File.read("public/eui-score/#{name}") rescue name
    end.join("\n")
    digest = Crypto.sha256(text).substring(0, 12)
    # Kept for the process in production, where a deploy restarts it; read
    # again each time elsewhere, where the files change under a running server.
    ScoreAssets.cached = digest if getenv("APP_ENV") == "production"
    digest
  end

  # What the editor's page preloads (#418): {"modules" (each at the set's
  # version), "engine" (the WebAssembly binding) and "wasm" (the engraver),
  # those two at the engraver's own version, as eui-score.js asks for them}.
  static def studio_preloads
    version = ScoreAssets.version
    wasm = (File.read("public/eui-score/wasm.version") rescue "").trim
    {
      "modules": SCORE_STUDIO_MODULES.map do |name|
        "/eui-score/#{name}?v=#{version}"
      end,
      "engine": "/eui-score/eui_score_web.js?v=#{wasm}",
      "wasm": "/eui-score/eui_score_web_bg.wasm?v=#{wasm}"
    }
  end

  # A module at a stable address that loads the current version: what other
  # sites link to (`/eui-score.js`), kept five minutes in their caches.
  static def entry(file)
    {
      "status": 200,
      "headers": {"Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=300"},
      "body": "export * from \"/eui-score/#{file}?v=#{ScoreAssets.version}\";\n"
    }
  end
end
