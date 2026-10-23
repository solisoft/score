# A score's read page, /s/<token>: the score engraved, played, printed —
# no editing. Open to anyone when the score is "link" or "public"; when it is
# private, only to its owner and the people it is shared with. Anything else
# is a 404, which says nothing about whether the score exists.
class SharedScoresController < Controller
  static {
    this.layout = "application"
  }

  # GET /s/:token
  def show
    @score = @_readable_score
    @figure = ScoreSvg.figure(@score.source, 1040, 7)
    @pdf_url = "#{shared_score_path(this.score.share_token)}/score.pdf"
    @source_url = "#{shared_score_path(this.score.share_token)}/source.ly"
    # The downloads' name: the title's (score.pdf, score.mid… say nothing once saved).
    @file_name = @score.file_name
    @can_edit = @score.writable_by?(current_user())
    @indexable = @score.visibility == "public"
    @title = @score.title
    @description = "#{this.score.title}, engraved by EUI Score: play it, print it."
  end

  # GET /s/:token/source.ly — the LilyPond, for <eui-score src="…"> on any site
  def source
    score = @_readable_score
    {
      "status": 200,
      "headers": {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, max-age=60"},
      "body": score.source
    }
  end

  # GET /s/:token/score.pdf — on the paper its \paper sets, saved under the score's title
  def pdf
    score = @_readable_score
    document = eui_score_pdf(score.source, score.title)
    {
      "status": 200,
      "headers": {"Content-Type": "application/pdf", "Content-Disposition": score.content_disposition("inline", "pdf")},
      "body": document
    }
  end

  private

  def _readable_score
    score = Score.by_token(params["token"])
    halt(404, "No such score") if score.nil? || !score.readable_by?(current_user())

    score
  end
end
