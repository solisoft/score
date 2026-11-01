# The reading pages: how to use the engraver, the notation it reads, and what
# it refuses.
class PagesController < Controller
  # GET /guide — score(), the native builtins, MIDI and PDF
  def guide
    @_page_texts("guide")
    hello = ScoreLibrary.source_named("syntax/hello")
    @hello = ScoreSvg.figure(hello, 640, 9)
    @marked = ScoreSvg.marked_figure(hello, 640, 9, {
      "1": "#8b2b2c",
      "3": "#a7843d"
    })
    waltz = ScoreLibrary.source_named("piano/waltz")
    @narrow = ScoreSvg.figure(waltz, 440, 5.5)
    @wide = ScoreSvg.figure(waltz, 1000, 6.5)
    @_in_language("guide")
  end

  # GET /syntax — the LilyPond subset, one engraved snippet per construct
  def syntax
    @_page_texts("syntax")
    @figures = ScoreSvg.figures(ScoreLibrary.snippets, 700, 7)
    @_in_language("syntax")
  end

  # GET /embed — eui-score in the browser, on any site
  def embed
    @eui_version = ScoreAssets.version
    @_page_texts("embed")
    @_in_language("embed")
  end

  # GET /claude — Score in Claude: the MCP server, installed in Claude Code,
  # claude.ai, Claude Desktop and other MCP clients (#464)
  def claude
    base = auth_base_url()
    @mcp_url = base + "/mcp"
    @skill_install = ScoreMcp.skill_install_command(base)
    @skill_url = base + "/skills/transcribe-score/SKILL.md"
    @_page_texts("claude")
    @_in_language("claude")
  end

  # GET /limits — what the engraver refuses, with its own messages
  def limits
    @_page_texts("limits")
    @refusals = ScoreLibrary.refusals.map do |refusal|
      laid = eui_score_layout(refusal["src"], 100, {})
      refusal.merge({"message": laid["error"]})
    end
    @_in_language("limits")
  end

  # GET /pricing — the plans, Free and Pro (#393), each limit read from Plan
  def pricing
    @monthly = Plan.price("monthly")
    @_page_texts("pricing")
    @description = @description.replace("{price}", @monthly["label"])
    @plans = Plan.catalog
    @annual = Plan.price("annual")
    @payments_open = Stripe.configured?
    @ai_note = Plan.ai_note(@payments_open)
    @_in_language("pricing")
  end

  # GET /changelog — what changed lately, on the site and in the engraver
  def changelog
    @_page_texts("changelog")
    pages = {
      "playground": playground_path(),
      "limits": SiteLocale.path(limits_path()),
      "pricing": SiteLocale.path(pricing_path()),
      "claude": SiteLocale.path(claude_path()),
      "home": SiteLocale.path(root_path()),
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
      day.merge({"entries": entries, "heading": Changelog.day_heading(day["date"], I18n.locale())})
    end
  end

  private

  # The page's @title and @description in the request's language (#471).
  def _page_texts(page)
    @title = SiteText.t("pages.#{page}.title")
    @description = SiteText.t("pages.#{page}.description")
  end

  # In French, the page's French template (app/views/pages/fr/), else the
  # English one by convention (#471): a page of prose is translated whole.
  def _in_language(page)
    return nil unless I18n.locale() == "fr"

    render("pages/fr/#{page}")
  end
end
