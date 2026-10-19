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
end
