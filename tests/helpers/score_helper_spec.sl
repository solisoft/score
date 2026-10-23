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
    assert_contains(html, "data-score-midi href=\"data:audio/midi;base64,")
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

  test("names the PDF's paper, and hands the browser what it prints the PDF with") do
    letter = ScoreSvg.figure("\\paper { #(set-paper-size \"letter\") }\n{ c'4 d' }", 600, 7)
    html = score_figure(
      letter,
      {
        "name": "fur-elise",
        "pdf": "/s/t/score.pdf",
        "title": "Für <Elise>"
      }
    )
    assert_contains(html, ">Letter PDF</a>")
    assert_not(html.contains("A4 PDF"), "not the paper it is not printed on")
    assert_contains(
      html,
      "data-score-pdf href=\"/s/t/score.pdf\" download=\"fur-elise.pdf\" data-title=\"Für &lt;Elise&gt;\""
    )
    plain = score_figure(ScoreSvg.figure("{ c'4 }", 600, 7), {"pdf": "/x.pdf"})
    assert_contains(plain, ">A4 PDF</a>")
    assert_not(plain.contains("data-title"), "no title asked for, none given")
    assert_not(
      score_figure(ScoreSvg.figure("{ c'4 }", 600, 7), {}).contains("data-score-pdf"),
      "no PDF without its address"
    )
  end

  test("escapes the caption") do
    figure = ScoreSvg.figure("{ c'4 }", 600, 7)
    assert_contains(score_figure(figure, {"caption": "<b>x</b>"}), "&lt;b&gt;x&lt;/b&gt;")
  end
end

describe("editor_pickups") do
  test("offers none first, then values as \\partial writes them, each named") do
    pickups = editor_pickups()
    assert_eq(pickups[0], ["", "None"])
    values = pickups.map do |pickup|
      pickup[0]
    end
    assert_eq(values, [
      "",
      "16",
      "8",
      "8.",
      "4",
      "4.",
      "2",
      "2."
    ])
    assert(pickups.all?(&{ |pickup|
      pickup[1].length > 0
    }))
  end
end

describe("editor_keys") do
  test("names every key from seven flats to seven sharps, major and minor") do
    keys = editor_keys()
    assert_eq(keys.length, 15)
    assert_eq(keys[0], [-7, "C♭ major / A♭ minor"])
    assert_eq(keys[7], [0, "C major / A minor"])
    assert_eq(keys[10], [3, "A major / F♯ minor"])
    assert_eq(keys[14], [7, "C♯ major / A♯ minor"])
    assert(keys.all?(&{ |key_choice|
      key_choice[1].contains(" minor")
    }))
  end
end

describe("score_snippet") do
  test("names the snippet after its file under syntax/") do
    figures = {"notes": ScoreSvg.figure("{ c'4 }", 600, 7)}
    assert_contains(score_snippet(figures, "notes", "/playground"), "?source=syntax/notes")
  end
end

describe("paper_label") do
  test("names the paper \\paper sets, A4 when it sets none") do
    assert_eq(paper_label("{ c'4 }"), "A4")
    assert_eq(paper_label(nil), "A4")
    assert_eq(paper_label("\\paper { #(set-paper-size \"letter\") }"), "Letter")
    assert_eq(paper_label("\\paper { #(set-paper-size \"a3landscape\") }"), "A3 landscape")
    assert_eq(paper_label("\\paper { #(set-paper-size \"a5\" 'landscape) }"), "A5 landscape")
    assert_eq(paper_label("\\paper { #(set-paper-size \"tabloid\") }"), "Tabloid")
    assert_eq(
      paper_label("\\paper { #(set-paper-size \"quarto\") }"),
      "quarto",
      "a size it does not know, as written"
    )
  end
end
