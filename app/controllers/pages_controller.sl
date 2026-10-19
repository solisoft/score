# The reading pages: how to use the engraver, the notation it reads, and what
# it refuses.
class PagesController < Controller
  # GET /guide — score(), the native builtins, MIDI and PDF
  def guide
    @title = "Guide"
    @description = "eui-score, EUI's engraver: show a score with score(), export it as MIDI and PDF."
    hello = ScoreLibrary.source_named("syntax/hello")
    @hello = ScoreSvg.figure(hello, 640, 9)
    @marked = ScoreSvg.marked_figure(hello, 640, 9, {
      "1": "#8b2b2c",
      "3": "#a7843d"
    })
    waltz = ScoreLibrary.source_named("piano/waltz")
    @narrow = ScoreSvg.figure(waltz, 440, 5.5)
    @wide = ScoreSvg.figure(waltz, 1000, 6.5)
  end

  # GET /syntax — the LilyPond subset, one engraved snippet per construct
  def syntax
    @title = "Syntax"
    @description = "The LilyPond subset eui-score reads, construct by construct, every example engraved."
    @figures = ScoreSvg.figures(ScoreLibrary.snippets, 700, 7)
  end

  # GET /embed — eui-score in the browser, on any site
  def embed
    @eui_version = ScoreAssets.version
    @title = "Embed"
    @description = "Scores on any website: one script, one <eui-score> tag, nothing to install."
  end

  # GET /limits — what the engraver refuses, with its own messages
  def limits
    @title = "Limits"
    @description = "What eui-score does not engrave, and the exact message it answers."
    @refusals = ScoreLibrary.refusals.map do |refusal|
      laid = eui_score_layout(refusal["src"], 100, {})
      refusal.merge({"message": laid["error"]})
    end
  end
end
