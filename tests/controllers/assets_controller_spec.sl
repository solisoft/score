describe("AssetsController") do
  describe("GET /eui-score.js") do
    test("loads the current version of the engraver, briefly cached") do
      response = get("/eui-score.js")
      assert_eq(res_status(response), 200)
      assert_contains(res_header(response, "Content-Type"), "javascript")
      assert_contains(res_header(response, "Cache-Control"), "max-age=300")
      assert_eq(res_body(response), "export * from \"/eui-score/eui-score.js?v=#{ScoreAssets.version}\";\n")
    end
  end

  describe("GET /eui-score-editor.js") do
    test("loads the current version of the editor") do
      response = get("/eui-score-editor.js")
      assert_eq(res_status(response), 200)
      assert_contains(res_body(response), "/eui-score/eui-score-editor.js?v=#{ScoreAssets.version}")
    end
  end
end
