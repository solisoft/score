# ScoreSvg: LilyPond to SVG through the native engraver.

describe("ScoreSvg") do
  describe("engrave") do
    test("draws a source as an SVG of rectangles and placed glyphs") do
      result = ScoreSvg.engrave("{ c'4 d' e' f' }", 600, 7, 0, {})
      assert_null(result["error"])
      svg = result["svg"]
      assert(svg.starts_with?("<svg xmlns=\"http://www.w3.org/2000/svg\""))
      assert_contains(svg, "<rect ")
      assert_contains(svg, "<defs><path id=")
      assert_contains(svg, "<use href=\"#g")
      assert_contains(svg, "fill=\"currentColor\"")
    end

    test("says where a printed page may turn: between its systems, and nowhere in a preview") do
      music = ""
      for bar in range(0, 30)
        music += "c'4 d' e' f' | "
      end
      src = "\\header { title = \"Long\" } { #{music} }"
      svg = ScoreSvg.engrave(src, 700, 7, 0, {})["svg"]
      breaks = svg.split(" data-breaks=\"")[1].split("\"")[0].split(" ").map do |y|
        y.to_f
      end
      laid = eui_score_layout(src, 100, {})
      bands = eui_score_bands(laid, 7, {
        "colour": "ink",
        "marks": {}
      }, (laid["height"] * 7).ceil())
      assert_eq(breaks.length, bands.length - 1, "one between each two bands: the title, then each system")
      assert_gt(breaks.length, 2)
      assert_eq(breaks[0], bands[1]["y"].to_f)
      for i in range(1, breaks.length)
        assert_gt(breaks[i], breaks[i - 1], "in order, down the page")
      end
      assert_not(ScoreSvg.engrave(src, 700, 7, 230, {})["svg"].contains("data-breaks"), "a preview is not printed")
    end

    test("defines a glyph drawn four times once") do
      svg = ScoreSvg.engrave("{ c''4 c'' c'' c'' }", 600, 7, 0, {})["svg"]
      assert_gt(svg.split("<use ").length - 1, svg.split("<path id=").length - 1)
    end

    test("is as tall as its ink: a staff of rests keeps its clef whole") do
      svg = ScoreSvg.engrave("{ \\clef treble r1 | r1 }", 600, 8, 0, {})["svg"]
      height = svg.split("height=\"")[1].split("\"")[0].to_i
      laid = eui_score_layout("{ \\clef treble r1 | r1 }", 75, {})
      assert_gt(height, (laid["height"] * 8).ceil())
    end

    test("starts above its first staff when a clef reaches over it, and only then") do
      src = "{ \\key g \\major g'1 | \\key f \\major bes'1 }"
      svg = ScoreSvg.engrave(src, 600, 8, 0, {})["svg"]
      view = svg.split("viewBox=\"")[1].split("\"")[0].split(" ")
      # The treble clef reaches some 1.5 spaces over the top line, at y 0 or below.
      # The rules as wide as a bar or more: the staff lines.
      lines = svg.split("<rect").filter do |tag|
        tag.starts_with?(" x=") && tag.split(" width=\"")[1].split("\"")[0].to_f > 100
      end
      top_line = lines.map do |tag|
        tag.split(" y=\"")[1].split("\"")[0].to_f
      end.min()
      assert_lt(view[1].to_f, 0)
      assert(view[1].to_f <= top_line - 8 * 1.5)
      assert_eq(svg.split(" height=\"")[1].split("\"")[0], view[3])
      titled = ScoreSvg.engrave("\\header { title = \"Rests\" } { r1 }", 600, 8, 0, {})["svg"]
      assert_contains(titled, "viewBox=\"0 0 ")
    end

    test("crops the drawing to its ink, not to the width asked for") do
      svg = ScoreSvg.engrave("{ c'4 }", 900, 7, 0, {})["svg"]
      width = svg.split("width=\"")[1].split("\"")[0].to_i
      assert_lt(width, 300)
    end

    test("answers the engraver's refusal, with its position, and no SVG") do
      result = ScoreSvg.engrave("{ c'4 \\foo }", 600, 7, 0, {})
      assert_null(result["svg"])
      assert_eq(result["error"], "score: \\foo is not a command this reads (at character 6)")
    end

    test("keeps only the bands above max_height for a preview") do
      src = ScoreLibrary.source(ScoreLibrary.example("ensembles", "symphony-5"))
      whole = ScoreSvg.engrave(src, 560, 5.5, 0, {})["svg"]
      cut = ScoreSvg.engrave(src, 560, 5.5, 230, {})["svg"]
      assert_lt(cut.length, whole.length)
      height = cut.split("height=\"")[1].split("\"")[0].to_i
      assert_lt(height, 400)
    end

    test("draws marked items again in their colour") do
      plain = ScoreSvg.engrave("{ c'4 d' e' f' }", 600, 7, 0, {})["svg"]
      marked = ScoreSvg.engrave("{ c'4 d' e' f' }", 600, 7, 0, {"1": "#8b2b2c"})["svg"]
      assert_not(plain.contains("#8b2b2c"))
      assert_contains(marked, "fill=\"#8b2b2c\"")
    end
  end

  describe("figure") do
    test("carries the source, the SVG and the MIDI") do
      figure = ScoreSvg.figure("{ c'4 d' }", 600, 7)
      assert_eq(figure["src"], "{ c'4 d' }")
      assert_not_null(figure["svg"])
      assert(figure["midi"].starts_with?("data:audio/midi;base64,TVRoZ"))
    end

    test("plays a source with no tempo at 100 a quarter, as the editor does") do
      src = "{ c'4 d' }"
      at_hundred = "data:audio/midi;base64," + Base64.encode(eui_score_midi(src, {"bpm": 100}))
      at_default = "data:audio/midi;base64," + Base64.encode(eui_score_midi(src, {}))
      assert_eq(ScoreSvg.midi_url(src), at_hundred)
      assert_ne(ScoreSvg.midi_url(src), at_default)
    end

    test("carries no MIDI when the source is refused") do
      figure = ScoreSvg.figure("{ c'256 }", 600, 7)
      assert_not_null(figure["error"])
      assert_null(figure["midi"])
    end

    test("builds one figure per named source") do
      figures = ScoreSvg.figures({
        "a": "{ c'1 }",
        "b": "{ \\nope }"
      }, 600, 7)
      assert_null(figures["a"]["error"])
      assert_not_null(figures["b"]["error"])
    end
  end

  describe("midi_url") do
    test("is nil for a source the engraver refuses") do
      assert_null(ScoreSvg.midi_url("{ c'4 \\shiver d'4 }"))
    end
  end

  describe("preview") do
    test("is a standalone SVG in black ink") do
      svg = ScoreSvg.preview("{ c'4 d' e' f' }")
      assert_contains(svg, "fill=\"#111\"")
      assert_not(svg.contains("currentColor"))
    end

    test("is an empty image for a refused source") do
      assert_eq(
        ScoreSvg.preview("{ \\nope }"),
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\"/>"
      )
    end
  end

  describe("px") do
    test("keeps a tenth of a pixel") do
      assert_eq(ScoreSvg.px(12.345), "12.3")
      assert_eq(ScoreSvg.px(238.42000000000002), "238.4")
      assert_eq(ScoreSvg.px(4), "4")
    end
  end

  describe("description") do
    test("names the score for a screen reader: title, composer, staves, bars, notes and rests") do
      src = "\\header { title = \"Air & <Song>\" composer = \"Anon\" }\n"
      + "<< \\new Staff { c'1 | r1 } \\new Staff { c1 | c2 r2 } >>"
      svg = ScoreSvg.engrave(src, 600, 7, 0, {})["svg"]
      id = Regex.capture("aria-labelledby=\"(?P<id>g[0-9a-f]+)-t ", svg)["id"]
      assert_contains(svg, "<title id=\"#{id}-t\">Air &amp; &lt;Song&gt;</title>")
      expected = "By Anon. 2 staves, 2 bars. Staff 1: 1 note, 1 rest. Staff 2: 2 notes, 1 rest."
      assert_contains(svg, "<desc id=\"#{id}-d\">#{expected}</desc>")
    end

    test("calls an untitled score a score, and leaves out a blank composer") do
      svg = ScoreSvg.engrave("\\header { composer = \" \" }\n{ c'4 d' }", 600, 7, 0, {})["svg"]
      assert_contains(svg, ">Score</title>")
      assert_contains(svg, ">1 staff, 1 bar. Staff 1: 2 notes, 0 rests.</desc>")
    end

    test("gives two drawings of the same score at two widths their own ids") do
      first = ScoreSvg.engrave("{ c'4 }", 600, 7, 0, {})["svg"]
      second = ScoreSvg.engrave("{ c'4 }", 400, 7, 0, {})["svg"]
      first_id = Regex.capture("<title id=\"(?P<id>[^\"]+)\"", first)["id"]
      assert_not(second.includes?("id=\"#{first_id}\""))
    end
  end
end
