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

    test("defines a glyph drawn four times once") do
      svg = ScoreSvg.engrave("{ c''4 c'' c'' c'' }", 600, 7, 0, {})["svg"]
      assert_gt(svg.split("<use ").length - 1, svg.split("<path id=").length - 1)
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

    test("carries no MIDI when the source is refused") do
      figure = ScoreSvg.figure("{ c'64 }", 600, 7)
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
      assert_null(ScoreSvg.midi_url("{ c'4 \\glissando d'4 }"))
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
end
