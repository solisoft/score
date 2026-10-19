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
end
