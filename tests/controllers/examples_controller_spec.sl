describe("ExamplesController") do
  describe("GET /examples") do
    test("lists every family and every piece, previews as lazy images") do
      response = get("/examples")
      assert_eq(res_status(response), 200)
      sections = assigns()["sections"]
      assert_eq(sections.length, ScoreLibrary.categories.length)
      body = res_body(response)
      assert_contains(body, "/examples/piano/waltz/preview.svg")
      assert_contains(body, "loading=\"lazy\"")
      assert_eq(body.split("class=\"example-card\"").length - 1, ScoreLibrary.examples.length)
    end
  end

  describe("GET /examples/:category") do
    test("shows one family") do
      response = get("/examples/guitar")
      assert_eq(res_status(response), 200)
      assert_eq(assigns()["category"]["slug"], "guitar")
      assert_eq(assigns()["examples"].length, ScoreLibrary.examples_in("guitar").length)
      assert_not(res_body(response).contains("/examples/piano/waltz/preview.svg"))
    end

    test("answers 404 for an unknown family") do
      assert_eq(res_status(get("/examples/harp")), 404)
    end
  end

  describe("GET /examples/:category/:slug") do
    test("engraves the piece with its source, MIDI, PDF and neighbours") do
      response = get("/examples/piano/waltz")
      assert_eq(res_status(response), 200)
      body = res_body(response)
      assert_contains(body, "<div class=\"score-sheet\"><svg")
      assert_contains(body, "download=\"waltz.mid\"")
      assert_contains(body, "/examples/piano/waltz/score.pdf")
      assert_contains(body, "Tempo di valse")
      assert_eq(assigns()["previous_example"]["slug"], "fur-elise")
      assert_eq(assigns()["next_example"]["slug"], "little-suite")
    end

    test("has no previous piece at the start of a family, no next at its end") do
      get("/examples/solos/ode-to-joy")
      assert_null(assigns()["previous_example"])
      get("/examples/ensembles/symphony-5")
      assert_null(assigns()["next_example"])
    end

    test("answers 404 for an unknown piece, or a piece under another family") do
      assert_eq(res_status(get("/examples/piano/nocturne")), 404)
      assert_eq(res_status(get("/examples/solos/waltz")), 404)
    end
  end

  describe("GET /examples/:category/:slug/score.pdf") do
    test("answers the piece as a PDF") do
      response = get("/examples/piano/minuet-in-g/score.pdf")
      assert_eq(res_status(response), 200)
      assert_contains(res_header(response, "Content-Type"), "application/pdf")
      assert(res_body(response).starts_with?("%PDF-"))
      assert_contains(res_header(response, "Content-Disposition"), "minuet-in-g.pdf")
    end

    test("answers 404 for an unknown piece") do
      assert_eq(res_status(get("/examples/piano/nocturne/score.pdf")), 404)
    end
  end

  describe("GET /examples/:category/:slug/preview.svg") do
    test("answers a cacheable SVG preview") do
      response = get("/examples/drums/rock/preview.svg")
      assert_eq(res_status(response), 200)
      assert_contains(res_header(response, "Content-Type"), "image/svg+xml")
      assert_contains(res_header(response, "Cache-Control"), "max-age")
      assert(res_body(response).starts_with?("<svg xmlns="))
    end

    test("answers 404 for an unknown piece") do
      assert_eq(res_status(get("/examples/drums/samba/preview.svg")), 404)
    end
  end

  describe("GET /examples/:category/:slug/source.ly") do
    test("answers the LilyPond, readable from any origin") do
      set_header("Origin", "https://example.com")
      response = get("/examples/ensembles/string-quartet/source.ly")
      clear_headers()
      assert_eq(res_status(response), 200)
      assert_contains(res_header(response, "Content-Type"), "text/x-lilypond")
      assert_eq(res_body(response), ScoreLibrary.source(ScoreLibrary.example("ensembles", "string-quartet")))
      assert_eq(res_header(response, "Access-Control-Allow-Origin"), "*")
    end

    test("answers 404 for an unknown piece") do
      assert_eq(res_status(get("/examples/ensembles/octet/source.ly")), 404)
    end
  end
end
