# The landing page, and the probe soli-proxy health-checks.
class HomeController < Controller
  # GET / — the app and what it does, section by section (HOME_FEATURES),
  # then the engraver for developers, and that it is free (#699)
  def index
    @title = SiteText.t("home.title")
    @description = SiteText.t("home.description")
    @app_open = AppSetup.ready?
    @features = HomeFeatures.all.map do |feature|
      feature.merge({"href": @_href(feature["link"], @app_open)})
    end
    @shot_width = HOME_SHOT_WIDTH
    @shot_height = HOME_SHOT_HEIGHT
    @engraved = ScoreSvg.figure(ScoreLibrary.source_named("syntax/home"), 520, 8)
    @example_count = ScoreLibrary.examples.length
  end

  # GET /health — liveness: the process answers (soli-proxy's slot check)
  def health
    {
      "status": 200,
      "headers": {"Content-Type": "application/json"},
      "body": "{\"status\":\"ok\"}"
    }
  end

  # GET /health/deep — readiness: the database answers and no job waits
  # far past its time; 503 with the reasons otherwise (Readiness)
  def ready
    report = Readiness.check
    {
      "status": report["ready"] ? 200 : 503,
      "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
      "body": {"status": report["ready"] ? "ok" : "not ready", "problems": report["problems"]}.to_json
    }
  end

  private

  # Where a feature's link goes: "signup" (the playground where
  # the app is not open: there is no account to make) or "playground".
  def _href(link, open)
    return SiteLocale.path(signup_path()) if link == "signup" && open

    playground_path()
  end
end
