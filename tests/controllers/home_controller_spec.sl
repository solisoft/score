describe("HomeController") do
  describe("GET /") do
    test("engraves the hero and the one-line example") do
      response = get("/")
      assert_eq(res_status(response), 200)
      body = res_body(response)
      assert_contains(body, "Scores engraved")
      assert_gt(body.split("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox").length - 1, 1)
      assert_not(body.contains("score-sheet-refused"))
      assert_contains(body, "<span class=\"ly-command\">\\header</span>")
      assert_eq(assigns()["example_count"], ScoreLibrary.examples.length)
    end

    test("counts the pieces of each family") do
      get("/")
      piano = assigns()["categories"].find do |cat|
        cat["slug"] == "piano"
      end
      assert_eq(piano["count"], ScoreLibrary.examples_in("piano").length)
    end

    test("carries its share tags") do
      body = res_body(get("/"))
      assert_contains(body, "<meta property=\"og:title\"")
      assert_contains(body, "og.png")
    end
  end

  describe("GET /health") do
    test("answers ok") do
      response = get("/health")
      assert_eq(res_status(response), 200)
      assert_eq(res_json(response)["status"], "ok")
    end
  end
end
