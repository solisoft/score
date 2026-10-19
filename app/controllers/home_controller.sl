# The landing page, and the probe soli-proxy health-checks.
class HomeController < Controller
  # GET / — what eui-score is, one engraved piece, the gallery's families
  def index
    @title = "EUI Score — LilyPond engraving, native"
    @description = "eui-score engraves LilyPond into vector paths, plays it as MIDI and prints it as PDF."
    @hero = ScoreSvg.figure(ScoreLibrary.source_named("syntax/home"), 520, 8)
    @hello = ScoreSvg.figure(ScoreLibrary.source_named("syntax/hello"), 640, 9)
    @categories = ScoreLibrary.categories.map do |cat|
      cat.merge({"count": ScoreLibrary.examples_in(cat["slug"]).length})
    end
    @example_count = ScoreLibrary.examples.length
  end

  # GET /health
  def health
    {
      "status": 200,
      "headers": {"Content-Type": "application/json"},
      "body": "{\"status\":\"ok\"}"
    }
  end
end
