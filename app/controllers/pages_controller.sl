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

  # GET /pricing — the plans, Free and Pro (#393), each limit read from Plan
  def pricing
    @monthly = Plan.price("monthly")
    @title = "Pricing"
    @description = "EUI Score is free to write with. Pro, #{this.monthly["label"]} a month, records more audio, "
    + "runs the AI on your own key and shares with anyone."
    @plans = Plan.catalog
    @annual = Plan.price("annual")
    @payments_open = Stripe.configured?
    @ai_note = Plan.ai_note(@payments_open)
  end

  # GET /changelog — what changed lately, on the site and in the engraver
  def changelog
    @title = "Changelog"
    @description = "What is new in eui-score: the site and its score editor, and the engraver that draws every score."
    pages = {
      "playground": playground_path(),
      "limits": limits_path(),
      "pricing": pricing_path(),
      "app": app_home_path()
    }
    @days = Changelog.shown(AppSetup.ready?).map do |day|
      entries = day["entries"].map do |entry|
        entry.merge({
          "label": Changelog.area_label(entry["area"]),
          "href": pages[entry["link"].to_s],
          "sample": Changelog.sample(entry["sample"])
        })
      end
      day.merge({"entries": entries, "heading": DateTime.parse(day["date"]).format("%A, %B %-d, %Y")})
    end
  end
end
