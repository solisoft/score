describe("PlaygroundController") do
  describe("GET /playground") do
    test("is the score editor: menu bar, toolbox, score, source — engraved before the module loads") do
      response = get("/playground")
      assert_eq(res_status(response), 200)
      assert_contains(assigns()["source"], "Ode to Joy")
      body = res_body(response)
      assert_contains(body, "class=\"studio-menubar\"")
      assert_contains(body, "class=\"studio-toolbox\"")
      assert_not(body.includes?("data-photo-open"), "no photos without an account")
      assert_not(body.includes?("data-ai-ask"), "no AI assistant without an account")
      assert_not(body.includes?("data-act=\"midi-view\""), "the MIDI view is the app's")
      assert_contains(body, "data-act=\"insert-copied\"")
      # Recording from a MIDI keyboard, its grid sixteenths to begin with.
      assert_contains(body, "data-act=\"record\" data-record")
      assert_contains(body, "<option value=\"sixteenth\" selected>sixteenths</option>")
      assert_contains(body, "data-act=\"tuplet\" data-n=\"3\"")
      assert_contains(body, "data-act=\"lyrics\"")
      assert_contains(body, "data-act=\"chord\"")
      assert_contains(body, "data-act=\"slur\"")
      assert_contains(body, "<textarea data-source")
      assert_contains(body, "Allegro assai")
    end

    test("loads the editor's modules under one version") do
      body = res_body(get("/playground"))
      version = ScoreAssets.version
      assert_eq(version.length, 12)
      assert_contains(body, "/eui-score/studio.js?v=#{version}")
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

    test("has no POST: engraving and editing are the browser's") do
      assert_eq(res_status(post("/playground", {"source": "{ c'4 }"})), 404)
    end
  end
end
