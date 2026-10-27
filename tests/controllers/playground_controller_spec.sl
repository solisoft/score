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
      # No account, no sharing page: the link copied holds the score.
      assert_contains(body, "data-act=\"share\">Copy a link to this score <kbd>the score inside</kbd>")
      assert_not(body.includes?("data-act=\"share\">Share…"), "no sharing page without an account")
      # The shortcuts sheet is written by studio.js from its table; zoom is Ctrl + and −.
      assert_contains(body, "<dl data-keys-list></dl>")
      assert_contains(body, "data-act=\"zoom-in\">Larger <kbd>Ctrl++</kbd>")
      # Recording from a MIDI keyboard, its grid sixteenths to begin with.
      assert_contains(body, "data-act=\"record\" data-record aria-pressed=\"false\"")
      assert_contains(body, "class=\"studio-split studio-record-group\"")
      # The grid and the dynamics behind the arrow beside Rec, the playback behind Play's (#419).
      assert_contains(body, "popovertarget=\"studio-recording\"")
      assert_contains(body, "popovertarget=\"studio-playback\"")
      assert_not(body.includes?("data-section=\"playback\""), "no Playback section in the toolbox")
      assert_contains(body, "<option value=\"sixteenth\" selected>sixteenths</option>")
      assert_contains(body, "<option value=\"eighth-triplet\">eighth triplets</option>")
      assert_contains(body, "data-record-dynamics checked")
      assert_contains(body, "data-act=\"tuplet\" data-n=\"3\"")
      assert_contains(body, "data-act=\"lyrics\"")
      assert_contains(body, "data-act=\"chord\"")
      assert_contains(body, "data-act=\"slur\"")
      assert_contains(body, "<textarea data-source")
      assert_contains(body, "Allegro assai")
    end

    test("File ▸ Print as PDF names the paper (A4 here), and printing shows the score alone") do
      body = res_body(get("/playground"))
      assert_contains(body, "data-act=\"save-pdf\">Print as PDF <kbd data-pdf-paper>A4</kbd>")
      # The print stylesheet: the menus, the toolbox, the source, the headers and the dialogs stay on the screen.
      css = File.read("public/css/application.css")
      print_rules = css.split("@media print {")[1]
      assert_not_null(print_rules, "a print stylesheet")
      hidden = print_rules.split("display: none !important;")[0]
      [
        ".studio-menubar",
        ".studio-toolbox",
        ".studio-source",
        ".app-header",
        ".site-header",
        "dialog",
        ".score-actions"
      ].each do |part|
        assert_contains(hidden, part)
      end
      assert_contains(print_rules, "@page {")
      assert_contains(print_rules, ".studio-print svg, .score-print svg {")
      assert_contains(print_rules, "break-inside: avoid;")
    end

    test("loads the editor's modules under one version") do
      body = res_body(get("/playground"))
      version = ScoreAssets.version
      assert_eq(version.length, 12)
      assert_contains(body, "/eui-score/studio.js?v=#{version}")
    end

    test("names every module the editor starts with, and the engraver, for the browser to fetch together (#418)") do
      page = res_body(get("/playground"))
      version = ScoreAssets.version
      ["studio.js", "studio-draw.js", "score-model.js", "player.js", "audio-ui.js", "pitch.js"].each do |name|
        assert_contains(page, "<link rel=\"modulepreload\" href=\"/eui-score/#{name}?v=#{version}\">")
      end
      wasm = File.read("public/eui-score/wasm.version").trim
      assert_contains(page, "<link rel=\"modulepreload\" href=\"/eui-score/eui_score_web.js?v=#{wasm}\">")
      assert_contains(
        page,
        "href=\"/eui-score/eui_score_web_bg.wasm?v=#{wasm}\" as=\"fetch\" type=\"application/wasm\" crossorigin>"
      )
      assert_not(page.contains("modulepreload\" href=\"/eui-score/musicxml.js"), "MusicXML loads when asked for")
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
