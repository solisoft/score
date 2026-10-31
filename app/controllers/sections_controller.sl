# The shared library of sections (#444), open to everyone: the sections
# people published, searched and filtered, each on its page engraved and
# played, with its rating and its comments. A hidden section (an admin hid
# it) is a 404 to all but the admins. Publishing, rating, commenting and
# reporting are the signed-in person's (AppSectionsController).
class SectionsController < Controller
  static {
    this.layout = "application"
  }

  # GET /sections — `q` (the name or the description), `instrument`, `style`,
  # `sort` ("recent" or "top"), `page`
  def index
    @query = params["q"].to_s.trim
    @instrument = SECTION_INSTRUMENTS.includes?(params["instrument"].to_s) ? params["instrument"].to_s : ""
    @style = SECTION_STYLES.includes?(params["style"].to_s) ? params["style"].to_s : ""
    @sort = params["sort"].to_s == "top" ? "top" : "recent"
    @page = Score.page_number(params["page"])
    found = SharedSection.library(@query, @instrument, @style, @sort, @page)
    @sections = found["sections"]
    @more = found["more"]
    @names = SharedSection.author_names(@sections.map(&{ |section|
      section.user_id
    }))
    @instruments = SECTION_INSTRUMENT_NAMES
    @styles = SECTION_STYLE_NAMES
    @signed_in = !current_user().nil?
    @title = "Shared sections"
    @description = "Guitar strumming, drum grooves, bass lines, piano chords: bars musicians share, to hear and "
    + "put in a score."
  end

  # GET /sections/search.json — the same, in JSON, for the editor's library
  # (without the bars and sources: GET /sections/:id/data.json has them)
  def search
    found = SharedSection.library(params["q"], params["instrument"], params["style"], params["sort"], params["page"])
    names = SharedSection.author_names(found["sections"].map(&{ |section|
      section.user_id
    }))
    rows = found["sections"].map do |section|
      {
        "id": section._key,
        "title": section.title,
        "description": section.description,
        "author": names[section.user_id] ?? "A member",
        "instrument": section.instrument,
        "style": section.style,
        "time": section.time,
        "key": section.key,
        "bars": section.bars,
        "tracks": section.tracks,
        "rating": section.average,
        "rating_count": section.rating_count,
        "comments_count": section.comments_count,
        "url": section_path(section._key)
      }
    end
    render_json({"sections": rows, "more": found["more"]})
  end

  # GET /sections/:id — the section engraved, played, rated and commented
  def show
    @section = @_visible
    @figure = ScoreSvg.figure(@section.source, 1040, 7)
    @comments = SectionComment.shown(@section)
    @names = SharedSection.author_names([@section.user_id] + @comments.map(&{ |comment|
      comment.user_id
    }))
    @me = current_user()
    @stars = SectionRating.given(@section, @me)
    @can_remove = @section.removable_by?(@me)
    @instrument_name = SECTION_INSTRUMENT_NAMES[@section.instrument] ?? "Other"
    @style_name = SECTION_STYLE_NAMES[@section.style] ?? "Other"
    @indexable = !@section.hidden
    @title = @section.title
    said = "#{this.instrument_name}, #{this.style_name}: #{this.section.bars} bars shared on Score."
    @description = @section.description.blank? ? said : @section.description.substring(0, 160)
  end

  # GET /sections/:id/data.json — its bars and source, for the editor to put in a score
  def data
    section = @_visible
    names = SharedSection.author_names([section.user_id])
    render_json(section.for_editor(names))
  end

  # GET /sections/:id/preview.svg — its first lines, for the library's cards
  def preview
    section = @_visible
    {
      "status": 200,
      "headers": {"Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600"},
      "body": ScoreSvg.preview(section.source)
    }
  end

  # GET /sections/:id/play.mid — its bars as MIDI, for the Play button of its card
  def midi
    section = @_visible
    bytes = eui_score_midi(section.source, {"bpm": section.bpm.to_s.to_i > 0 ? section.bpm.to_s.to_i : 100}) rescue nil
    halt(422, "Those bars could not be played") if bytes.nil?

    {
      "status": 200,
      "headers": {"Content-Type": "audio/midi", "Cache-Control": "public, max-age=3600"},
      "body": bytes
    }
  end

  private

  # The section of the route, unless it is hidden (404; but to an admin).
  def _visible
    section = SharedSection.find(params["id"])
    halt(404, "No such section") if section.hidden && !(current_user()&.admin? ?? false)

    section
  end
end
