# The modules a module of public/eui-score imports at its top (static
# imports and awaited ones), but the WebAssembly binding, preloaded apart.
def asset_imports(code)
  pattern = "(?m)^(?:import [^\\n]* from \"|(?:export )?const [^\\n]*= await import\\(`)\\./[a-z0-9-]+\\.js"
  names = Regex.find_all(pattern, code).map do |found|
    Regex.replace("^.*\\./", found["match"], "")
  end
  names.filter do |name|
    name != "eui_score_web.js"
  end
end

describe("ScoreAssets") do
  test("names the browser files' version, the same on every call") do
    first = ScoreAssets.version
    assert_eq(first.length, 12)
    assert_eq(ScoreAssets.version, first)
  end

  test("answers a module that re-exports a file at that version") do
    entry = ScoreAssets.entry("studio.js")
    assert_eq(entry["status"], 200)
    assert_contains(entry["body"], "/eui-score/studio.js?v=#{ScoreAssets.version}")
  end

  test("ships the player, its synthesizer and the sounds' licence; no player from a CDN") do
    shipped = [
      "player.js",
      "vendor/spessasynth.js",
      "vendor/spessasynth_processor.min.js",
      "vendor/SPESSASYNTH_LICENSE"
    ]
    shipped.each do |name|
      assert(File.exists("public/eui-score/#{name}"), name)
    end
    assert_contains(File.read("public/soundfonts/MuseScore_General_License.txt"), "MIT license")
    ["public/eui-score/studio.js", "public/js/score.js"].each do |path|
      code = File.read(path)
      assert_not(code.contains("cdn.jsdelivr.net"), path)
      assert_contains(code, "player.js")
    end
  end

  describe("the editor's preloads (#418)") do
    test("name every module studio.js and its parts load as they start, each a file at the set's version") do
      preloads = ScoreAssets.studio_preloads
      listed = preloads["modules"].map do |href|
        Regex.replace("\\?v=.*$", Regex.replace("^/eui-score/", href, ""), "")
      end
      assert(listed.includes?("studio-draw.js"))
      assert_contains(preloads["modules"][0], "?v=#{ScoreAssets.version}")
      listed.each do |name|
        assert(File.exists("public/eui-score/#{name}"), "#{name} is a file")
      end
      # studio.js's own eager imports: the awaited ones and the parts it installs.
      studio = File.read("public/eui-score/studio.js")
      eager = Regex.find_all("(?m)^(?:const [^\\n]*= await import\\(`|  import\\(`)\\./[a-z0-9-]+\\.js", studio)
      assert(eager.length > 30, "studio.js imports its modules")
      eager.each do |found|
        name = Regex.replace("^.*\\./", found["match"], "")
        assert(listed.includes?(name), "#{name}, imported by studio.js, is preloaded")
      end
      # What each preloaded module imports in turn, at its top.
      wanted = listed.map do |name|
        asset_imports(File.read("public/eui-score/#{name}"))
      end.flatten.uniq
      missing = wanted.filter do |name|
        !listed.includes?(name)
      end
      assert_eq(missing, [], "imported by a preloaded module, and not preloaded")
      # The engraver at its own version, as eui-score.js asks for it.
      wasm = File.read("public/eui-score/wasm.version").trim
      assert_eq(preloads["engine"], "/eui-score/eui_score_web.js?v=#{wasm}")
      assert_eq(preloads["wasm"], "/eui-score/eui_score_web_bg.wasm?v=#{wasm}")
      assert_contains(File.read("public/eui-score/eui-score.js"), "const WASM = \"#{wasm}\";")
      # A module loaded only when asked for (MusicXML) is not.
      assert_not(listed.includes?("musicxml.js"))
    end
  end
end
