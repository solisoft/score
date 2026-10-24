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
    # Its comments (#385), for those who may see it through their account:
    # the readers it is shared with comment here, the editors in the editor.
    @comments_url = @score.access_of(current_user()).nil? ? nil : app_score_comments_path(@score)
    @me = current_user()&._key
    @eui_version = ScoreAssets.version
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
  # — kept by the browser and the CDN under its revision (ETag), so a visit
  # that has it already gets a 304, not a new engraving
  def pdf
    score = @_readable_score
    caching = {"ETag": @_pdf_etag(score), "Cache-Control": @_pdf_cache_control(score)}
    known = req["headers"]["if-none-match"].to_s.split(",").map do |tag|
      tag.trim
    end
    if known.includes?(caching["ETag"])
      return {
        "status": 304,
        "headers": caching,
        "body": ""
      }
    end

    document = eui_score_pdf(score.source, score.title)
    headers = {"Content-Type": "application/pdf", "Content-Disposition": score.content_disposition("inline", "pdf")}
    {
      "status": 200,
      "headers": headers.merge(caching),
      "body": document
    }
  end

  private

  # Which PDF this is: the score at its revision (every save, its title and
  # its visibility included, makes a new one), drawn as ENGRAVING_FORMAT draws.
  def _pdf_etag(score)
    "\"pdf-#{score._key}-#{score.revision}-#{ENGRAVING_FORMAT}\""
  end

  # A score open by link or in public may be kept by a CDN for a minute; a
  # private one only by the browser that may read it, asked again each time.
  def _pdf_cache_control(score)
    return "private, no-cache" if score.visibility == "private"

    "public, max-age=60, must-revalidate"
  end

  def _readable_score
    score = Score.by_token(params["token"])
    halt(404, "No such score") if score.nil? || !score.readable_by?(current_user())

    score
  end
end
