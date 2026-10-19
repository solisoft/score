describe("PagesController") do
  describe("GET /guide") do
    test("engraves its examples, the marked one in its colours") do
      response = get("/guide")
      assert_eq(res_status(response), 200)
      body = res_body(response)
      assert_contains(body, "EUI's score viewer")
      assert_contains(body, "fill=\"#8b2b2c\"")
      assert_contains(body, "fill=\"#a7843d\"")
      assert_not(body.contains("score-sheet-refused"))
    end
  end

  describe("GET /syntax") do
    test("engraves every snippet, none refused") do
      response = get("/syntax")
      assert_eq(res_status(response), 200)
      body = res_body(response)
      assert_not(body.contains("score-sheet-refused"))
      assert_contains(body, "?source=syntax/notes")
      assert_contains(body, "?source=syntax/nested-groups")
      # Every snippet but the two the home page shows is on this page.
      names = ScoreLibrary.snippets.keys.filter do |name|
        !["home", "hello"].includes?(name)
      end
      names.each do |name|
        assert_contains(body, "?source=syntax/#{name}\"")
      end
    end
  end

  describe("GET /limits") do
    test("prints the engraver's own refusal for each case") do
      response = get("/limits")
      assert_eq(res_status(response), 200)
      refusals = assigns()["refusals"]
      assert_eq(refusals.length, ScoreLibrary.refusals.length)
      refusals.each do |refusal|
        assert_not_null(refusal["message"], refusal["what"])
      end
      assert_contains(res_body(response), "\\shiver is not a command this reads")
    end
  end

  describe("GET /embed") do
    test("explains the embed and runs it on the page") do
      response = get("/embed")
      assert_eq(res_status(response), 200)
      body = res_body(response)
      assert_contains(body, "https://score.solisoft.net/eui-score/eui-score.js")
      assert_contains(body, "<eui-score src=\"/examples/ensembles/string-quartet/source.ly\"></eui-score>")
      assert_contains(body, "<script type=\"text/x-lilypond\">")
      assert_contains(body, "<script type=\"module\" src=\"/eui-score/eui-score.js")
    end
  end
end
