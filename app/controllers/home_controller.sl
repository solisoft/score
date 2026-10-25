# The landing page, and the probe soli-proxy health-checks.
class HomeController < Controller
  # GET / — the app and what it does, section by section (HOME_FEATURES),
  # then the engraver for developers and the plans
  def index
    @title = "Write, play and share scores, together"
    @description = "EUI Score is a score editor in the browser: write with the mouse or the keyboard, play it, "
    + "edit it together live, practise with the microphone, and share it. Free to start."
    @app_open = AppSetup.ready?
    @features = HomeFeatures.all.map do |feature|
      feature.merge({"href": @_href(feature["link"], @app_open)})
    end
    @shot_width = HOME_SHOT_WIDTH
    @shot_height = HOME_SHOT_HEIGHT
    @engraved = ScoreSvg.figure(ScoreLibrary.source_named("syntax/home"), 520, 8)
    @example_count = ScoreLibrary.examples.length
    @pro_price = Plan.price("monthly")
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

  # Where a feature's link goes: "pricing", "signup" (the playground where
  # the app is not open: there is no account to make) or "playground".
  def _href(link, open)
    return pricing_path() if link == "pricing"
    return signup_path() if link == "signup" && open

    playground_path()
  end
end
