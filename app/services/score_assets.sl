# The browser engraver's files (public/eui-score/) and the one version they
# are loaded under.
#
# They are served immutable, for a year, and a module loads the others with
# its own `?v=…`: one version for the whole set keeps a deploy's files
# together. It is a digest of the JavaScript and of `wasm.version`, which
# wasm/build.sh writes from the WebAssembly — computed once per process,
# since a deploy restarts it.
class ScoreAssets
  static cached: String = ""

  static def version
    return ScoreAssets.cached unless ScoreAssets.cached.blank?

    parts = [
      "eui-score.js",
      "eui-score-editor.js",
      "studio.js",
      "score-model.js",
      "musicxml.js",
      "midi-import.js",
      "piano-roll.js",
      "patterns.js",
      "pattern-tools.js",
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
