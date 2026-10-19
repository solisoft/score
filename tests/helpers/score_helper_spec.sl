# The figure a page shows, and the highlighted source in it.

describe("score_highlight") do
  test("colours commands, strings, numbers, brackets and comments") do
    html = score_highlight("\\relative c' { c4 \\bar \"|.\" } % fin")
    assert_contains(html, "<span class=\"ly-command\">\\relative</span>")
    assert_contains(html, "<span class=\"ly-string\">&quot;|.&quot;</span>")
    assert_contains(html, "<span class=\"ly-number\">4</span>")
    assert_contains(html, "<span class=\"ly-bracket\">{</span>")
    assert_contains(html, "<span class=\"ly-comment\">% fin</span>")
  end

  test("escapes markup, so a source cannot inject HTML") do
    html = score_highlight("{ <c' e'>4 } % <script>alert(1)</script>")
    assert_not(html.contains("<script>"))
    assert_contains(html, "&lt;script&gt;")
    assert_contains(html, "<span class=\"ly-bracket\">&lt;</span>")
  end

  test("reads the voice separator and hairpins as commands") do
    html = score_highlight("<< { c'4\\< d'\\! } \\\\ { e'2 } >>")
    assert_contains(html, "<span class=\"ly-command\">\\\\</span>")
    assert_contains(html, "<span class=\"ly-command\">\\&lt;</span>")
    assert_contains(html, "<span class=\"ly-command\">\\!</span>")
  end

  test("closes a string left open at the end") do
    assert_contains(score_highlight("\"ouvert"), "<span class=\"ly-string\">&quot;ouvert</span>")
  end
end

describe("score_figure") do
  test("shows the score, its buttons and its open source") do
    figure = ScoreSvg.figure("{ c'4 d' }", 600, 7)
    html = score_figure(
      figure,
      {
        "name": "piano/waltz",
        "sandbox": "/playground",
        "pdf": "/x.pdf"
      }
    )
    assert_contains(html, "<div class=\"score-sheet\"><svg")
    assert_contains(html, "data-score-play data-midi=\"data:audio/midi;base64,")
    assert_contains(html, "download=\"waltz.mid\"")
    assert_contains(html, "href=\"/x.pdf\"")
    assert_contains(html, "href=\"/playground?source=piano/waltz\"")
    assert_contains(html, "<details class=\"score-source\" open>")
  end

  test("hands Play the source, escaped, even when the source is not shown") do
    figure = ScoreSvg.figure("\\header { title = \"<b>A & B</b>\" } { \\repeat volta 2 { c'4 d' e' f' } }", 600, 7)
    html = score_figure(figure, {"source": "none"})
    assert_contains(html, "data-src=\"\\header { title = &quot;&lt;b&gt;A &amp; B&lt;/b&gt;&quot; }")
    assert_contains(html, "\\repeat volta 2")
    assert_not(html.contains("<b>A"))
  end

  test("leaves out the sandbox link without a sandbox, and the source on request") do
    figure = ScoreSvg.figure("{ c'4 d' }", 600, 7)
    html = score_figure(
      figure,
      {"name": "piano/waltz", "source": "none"}
    )
    assert_not(html.contains("playground"))
    assert_not(html.contains("score-source"))
    closed = score_figure(figure, {"source": "closed"})
    assert_contains(closed, "<details class=\"score-source\">")
    assert_contains(closed, "download=\"score.mid\"")
  end

  test("shows a refusal instead of a score, without buttons") do
    figure = ScoreSvg.figure("{ c'4 \\foo }", 600, 7)
    html = score_figure(
      figure,
      {
        "name": "piano/waltz",
        "sandbox": "/playground",
        "caption": "Essai"
      }
    )
    assert_contains(html, "score-sheet-refused")
    assert_contains(html, "\\foo is not a command this reads (at character 6)")
    assert_not(html.contains("data-score-play"))
    assert_contains(html, "<figcaption>Essai</figcaption>")
  end

  test("escapes the caption") do
    figure = ScoreSvg.figure("{ c'4 }", 600, 7)
    assert_contains(score_figure(figure, {"caption": "<b>x</b>"}), "&lt;b&gt;x&lt;/b&gt;")
  end
end

describe("score_snippet") do
  test("names the snippet after its file under syntax/") do
    figures = {"notes": ScoreSvg.figure("{ c'4 }", 600, 7)}
    assert_contains(score_snippet(figures, "notes", "/playground"), "?source=syntax/notes")
  end
end
