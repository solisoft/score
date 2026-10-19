describe("PlaygroundController") do
  describe("GET /playground") do
    test("starts from the Ode to Joy, engraved before the module loads") do
      response = get("/playground")
      assert_eq(res_status(response), 200)
      assert_contains(assigns()["source"], "Ode to Joy")
      body = res_body(response)
      assert_contains(body, "<eui-score id=\"sandbox-score\"><svg")
      assert_contains(body, "Allegro assai")
      assert_not(body.contains("class=\"score-sheet score-sheet-refused\""))
    end

    test("engraves in the browser, with the WebAssembly module") do
      body = res_body(get("/playground"))
      assert_contains(body, "<script type=\"module\">")
      assert_contains(body, "eui-score/eui-score.js")
      assert_contains(body, "data-midi=\"data:audio/midi;base64,")
    end

    test("opens a gallery piece or a syntax snippet") do
      get("/playground?source=guitar/blues")
      assert_contains(assigns()["source"], "Blues in E")
      get("/playground?source=syntax/voices")
      assert_contains(assigns()["source"], "\\\\")
    end

    test("falls back to the default for a name outside the catalogue") do
      get("/playground?source=../../.env")
      assert_contains(assigns()["source"], "Ode to Joy")
      get("/playground?source=piano/nocturne")
      assert_contains(assigns()["source"], "Ode to Joy")
    end

    test("has no POST any more: engraving is the browser's") do
      assert_eq(res_status(post("/playground", {"source": "{ c'4 }"})), 404)
    end
  end
end
