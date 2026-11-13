# The gallery: families of pieces, each piece engraved with its source.
class ExamplesController < Controller
  # GET /examples — every family, every piece
  def index
    @title = SiteText.t("examples.examples")
    @description = SiteText.t("examples.description")
    @sections = ScoreLibrary.categories.map do |cat|
      cat.merge({"examples": ScoreLibrary.examples_in(cat["slug"])})
    end
  end

  # GET /examples/:category — one family
  def category
    @category = ScoreLibrary.category(params["category"])
    halt(404, "Unknown category") if @category.nil?

    @examples = ScoreLibrary.examples_in(@category["slug"])
    @categories = ScoreLibrary.categories
    @title = @category["title"]
    @description = @category["lead"]
  end

  # GET /examples/:category/:slug — one piece, engraved, with its source
  def show
    @example = ScoreLibrary.example(params["category"], params["slug"])
    halt(404, "Unknown example") if @example.nil?

    @category = ScoreLibrary.category(@example["category"])
    @figure = ScoreSvg.figure(ScoreLibrary.source(@example), 1040, 7)
    siblings = ScoreLibrary.examples_in(@example["category"])
    position = siblings.index_of(@example)
    @previous_example = position > 0 ? siblings[position - 1] : nil
    @next_example = position + 1 < siblings.length ? siblings[position + 1] : nil
    @title = "#{this.example["title"]} — #{this.example["instrument"]}"
    @description = @example["about"]
  end

  # GET /examples/:category/:slug/score.pdf — the piece on A4: printed once,
  # then read back (Engraving) and cached by browsers for an hour; a printing
  # counted against the sender's PDFs of the minute (429 past them, #684)
  def pdf
    example = ScoreLibrary.example(params["category"], params["slug"])
    halt(404, "Unknown example") if example.nil?

    sender = ScoreSvg.sender("pdf", current_user(), client_ip(req))
    printed = ScoreSvg.pdf(ScoreLibrary.source(example), example["title"], sender)
    return ScoreSvg.too_many if printed["throttled"] == true

    halt(422, printed["error"]) if printed["file"].nil?

    disposition = "inline; filename=\"#{example["slug"]}.pdf\""
    {
      "status": 200,
      "headers": {
        "Content-Type": "application/pdf",
        "Content-Disposition": disposition,
        "Cache-Control": "public, max-age=3600"
      },
      "body": printed["file"]
    }
  end

  # GET /examples/:category/:slug/preview.svg — the gallery card's preview
  def preview
    example = ScoreLibrary.example(params["category"], params["slug"])
    halt(404, "Unknown example") if example.nil?

    {
      "status": 200,
      "headers": {"Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600"},
      "body": ScoreSvg.preview(ScoreLibrary.source(example))
    }
  end

  # GET /examples/:category/:slug/source.ly — the LilyPond itself, for
  # `<score-sheet src="…">` on any site
  def source
    example = ScoreLibrary.example(params["category"], params["slug"])
    halt(404, "Unknown example") if example.nil?

    {
      "status": 200,
      "headers": {"Content-Type": "text/x-lilypond; charset=utf-8", "Cache-Control": "public, max-age=3600"},
      "body": ScoreLibrary.source(example)
    }
  end
end
