# A section of the shared library (#444): bars of a score its author
# publishes for everyone to hear and put in their own scores — a guitar's
# strumming, a drum groove, a bass line, a piano's chords. It keeps the bars
# as the editor copies them (`section`, the JSON of copySection in
# public/eui-score/score-model.js), to paste, and as a small score of their
# own (`source`, LilyPond), to engrave and play on its page.
#
# Everyone may read the sections not hidden; a signed-in person publishes
# SECTIONS_PER_DAY of them in any 24 hours, rates them (SectionRating) and
# comments on them (SectionComment). Its author takes it away; an admin hides
# it when it is reported (SectionReport).
const SECTIONS_PER_DAY = 20
const SECTION_PAGE_SIZE = 24
const SECTION_TITLE_LENGTH = 80
const SECTION_DESCRIPTION_LENGTH = 1000
const SECTION_MAX_BARS = 64
const SECTION_MAX_TRACKS = 8
const SECTION_SOURCE_LENGTH = 100000
const SECTION_DATA_LENGTH = 200000
const SECTION_INSTRUMENTS = [
  "guitar",
  "piano",
  "bass",
  "drums",
  "voice",
  "strings",
  "winds",
  "brass",
  "band",
  "other"
]
const SECTION_STYLES = [
  "pop",
  "rock",
  "ballad",
  "folk",
  "country",
  "blues",
  "jazz",
  "swing",
  "bossa",
  "latin",
  "reggae",
  "funk",
  "soul",
  "gospel",
  "waltz",
  "classical",
  "metal",
  "electronic",
  "other"
]
# The author of the sections the library starts with (#447): made from the
# editor's own styles and grooves (scripts/section-seeds.mjs), signed with
# the site's name. No account has this key.
const SECTION_HOUSE_AUTHOR = "score"
const SECTION_HOUSE_NAME = "Score"
# How the library names them.
const SECTION_INSTRUMENT_NAMES = {
  "guitar": "Guitar",
  "piano": "Piano",
  "bass": "Bass",
  "drums": "Drums",
  "voice": "Voice",
  "strings": "Strings",
  "winds": "Winds",
  "brass": "Brass",
  "band": "Band",
  "other": "Other"
}
const SECTION_STYLE_NAMES = {
  "pop": "Pop",
  "rock": "Rock",
  "ballad": "Ballad",
  "folk": "Folk",
  "country": "Country",
  "blues": "Blues",
  "jazz": "Jazz",
  "swing": "Swing",
  "bossa": "Bossa nova",
  "latin": "Latin",
  "reggae": "Reggae",
  "funk": "Funk",
  "soul": "Soul",
  "gospel": "Gospel",
  "waltz": "Waltz",
  "classical": "Classical",
  "metal": "Metal",
  "electronic": "Electronic",
  "other": "Other"
}

class SharedSection < Model
  validates("user_id", {"presence": true})
  validates("title", {"presence": true})
  validates("instrument", {"inclusion": SECTION_INSTRUMENTS})
  validates("style", {"inclusion": SECTION_STYLES})
  validates("source", {"presence": true})

  # Why `fields` (from the editor: title, description, instrument, style,
  # time, key, bpm, bars, tracks, section, source) may not be published, or
  # nil. Lengths are counted in characters, as people count them.
  static def problem(fields)
    title = fields["title"].to_s.trim
    return "Give the section a name." if title.blank?
    return "A name holds #{SECTION_TITLE_LENGTH} characters at most." if title.chars().length > SECTION_TITLE_LENGTH

    description = fields["description"].to_s.trim
    if description.chars().length > SECTION_DESCRIPTION_LENGTH
      return "A description holds #{SECTION_DESCRIPTION_LENGTH} characters at most."
    end

    return "Choose its instrument." unless SECTION_INSTRUMENTS.includes?(fields["instrument"].to_s)
    return "Choose its style." unless SECTION_STYLES.includes?(fields["style"].to_s)

    bars = fields["bars"].to_s.to_i
    return "A section is 1 to #{SECTION_MAX_BARS} bars." if bars < 1 || bars > SECTION_MAX_BARS

    tracks = fields["tracks"].to_s.to_i
    return "A section is 1 to #{SECTION_MAX_TRACKS} tracks." if tracks < 1 || tracks > SECTION_MAX_TRACKS
    return "Its metre is not one this reads." unless Regex.matches("^\\d{1,2}/\\d{1,2}$", fields["time"].to_s)

    bpm = fields["bpm"].to_s.to_i
    return "A tempo is 20 to 300 a beat." if bpm != 0 && (bpm < 20 || bpm > 300)

    section = fields["section"]
    return "The bars are missing: select some, then share them." unless type(section) == "hash"

    parts = section["parts"]
    unless type(parts) == "array" && parts.length > 0
      return "The bars are missing: select some, then share them."
    end

    return "Those bars are too much to share at once." if section.to_json.length > SECTION_DATA_LENGTH

    source = fields["source"].to_s
    return "The bars are missing: select some, then share them." if source.trim.blank?
    return "Those bars are too much to share at once." if source.length > SECTION_SOURCE_LENGTH

    refused = eui_score_layout(source, 100, {})["error"]
    return "The engraver refuses those bars: #{refused}" unless refused.nil?

    nil
  end

  # `fields` published by `user`: {"section"}, or {"error"} with nothing
  # written (a refusal, or the day's sections all published).
  static def publish(user, fields)
    if SharedSection.published_today(user) >= SECTIONS_PER_DAY
      return {"error": "You have shared the #{SECTIONS_PER_DAY} sections a day allows: try again tomorrow."}
    end

    problem = SharedSection.problem(fields)
    return {"error": problem} unless problem.nil?

    section = SharedSection.create({
      "user_id": user._key,
      "title": fields["title"].to_s.trim,
      "description": fields["description"].to_s.trim,
      "instrument": fields["instrument"].to_s,
      "style": fields["style"].to_s,
      "time": fields["time"].to_s,
      "key": fields["key"].to_s.trim.substring(0, 24),
      "bpm": fields["bpm"].to_s.to_i,
      "bars": fields["bars"].to_s.to_i,
      "tracks": fields["tracks"].to_s.to_i,
      "section": fields["section"],
      "source": fields["source"].to_s,
      "rating_sum": 0,
      "rating_count": 0,
      "rating": 0,
      "comments_count": 0,
      "hidden": false,
      "created_at": DateTime.utc.to_unix
    })
    return {"error": "The section could not be saved: try again."} unless section._errors.nil?

    {"section": section}
  end

  # The library's own sections (#447), from `seeds` (db/data/house_sections.json:
  # [{seed, title, description, instrument, style, time, key, bpm, bars,
  # tracks, section, source}]), signed SECTION_HOUSE_NAME. One already there
  # (by its `seed`) or refused by `problem` is left out. Answers the number
  # added.
  static def add_house(seeds)
    added = 0
    seeds.each do |fields|
      next unless SharedSection.where({"seed": fields["seed"]}).first.nil?
      next unless SharedSection.problem(fields).nil?

      section = SharedSection.create({
        "user_id": SECTION_HOUSE_AUTHOR,
        "seed": fields["seed"],
        "title": fields["title"].to_s.trim,
        "description": fields["description"].to_s.trim,
        "instrument": fields["instrument"].to_s,
        "style": fields["style"].to_s,
        "time": fields["time"].to_s,
        "key": fields["key"].to_s,
        "bpm": fields["bpm"].to_s.to_i,
        "bars": fields["bars"].to_s.to_i,
        "tracks": fields["tracks"].to_s.to_i,
        "section": fields["section"],
        "source": fields["source"].to_s,
        "rating_sum": 0,
        "rating_count": 0,
        "rating": 0,
        "comments_count": 0,
        "hidden": false,
        "created_at": DateTime.utc.to_unix
      })
      added += 1 if section._errors.nil?
    end
    added
  end

  # The library's own sections taken away, with what was said of them.
  static def remove_house
    SharedSection.where({"user_id": SECTION_HOUSE_AUTHOR}).all.each do |section|
      section.remove
    end
    nil
  end

  # How many sections `user` published in the last 24 hours.
  static def published_today(user)
    since = DateTime.utc.to_unix - 86400
    SharedSection.where(
      "doc.user_id == @user AND doc.created_at > @since",
      {"user": user._key, "since": since}
    ).count
  end

  # Page `page` (from 1) of the sections everyone may see, matching `query`
  # (in the title or the description), of `instrument` and `style` when
  # given, in `sort` order: "recent" (the default) or "top" (the best rated
  # first, the most rated among equals). Answers {"sections", "more"},
  # without the sections' bars and sources.
  static def library(query, instrument, style, sort, page)
    needle = query.to_s.trim.downcase
    condition = "doc.hidden != true"
    binds = {}
    unless needle.blank?
      condition = condition
      + " AND (CONTAINS(LOWER(doc.title), @needle) OR CONTAINS(LOWER(doc.description), @needle))"
      binds["needle"] = needle
    end
    if SECTION_INSTRUMENTS.includes?(instrument.to_s)
      condition = condition + " AND doc.instrument == @instrument"
      binds["instrument"] = instrument.to_s
    end
    if SECTION_STYLES.includes?(style.to_s)
      condition = condition + " AND doc.style == @style"
      binds["style"] = style.to_s
    end
    builder = SharedSection.where(condition, binds)
    builder = builder.select(
      "user_id",
      "title",
      "description",
      "instrument",
      "style",
      "time",
      "key",
      "bpm",
      "bars",
      "tracks",
      "rating",
      "rating_count",
      "comments_count",
      "created_at"
    )
    if sort == "top"
      builder = builder.order("rating", "desc").order("rating_count", "desc")
    else
      builder = builder.order("created_at", "desc")
    end
    first = (Score.page_number(page) - 1) * SECTION_PAGE_SIZE
    rows = builder.offset(first).limit(SECTION_PAGE_SIZE + 1).all
    more = rows.length > SECTION_PAGE_SIZE
    {"sections": more ? rows.slice(0, SECTION_PAGE_SIZE) : rows, "more": more}
  end

  # How the library names a person: their name, never their address — the
  # library is public.
  static def author_names(keys)
    names = {}
    wanted = keys.filter do |key|
      key.present?
    end.uniq
    return names if wanted.length == 0

    names[SECTION_HOUSE_AUTHOR] = SECTION_HOUSE_NAME if wanted.includes?(SECTION_HOUSE_AUTHOR)
    User.where("doc._key IN @keys", {"keys": wanted}).select("_key", "name").all.each do |user|
      names[user._key] = user.name.blank? ? "A member" : user.name.to_s.trim
    end
    names
  end

  def by?(user)
    !user.nil? && @user_id == user._key
  end

  # Whether `user` may take it away: its author, or an admin.
  def removable_by?(user)
    !user.nil? && (@by?(user) || user.admin?)
  end

  # Its average, to one decimal: 0 with no rating yet.
  def average
    return 0 if @rating_count.to_s.to_i == 0

    # `rating` is what a list reads (it leaves the sum out).
    (@rating.to_s.to_f * 10).round() / 10.0
  end

  # Its counters set again from its ratings and comments, as they now are.
  def recount
    ratings = SectionRating.where({"section_id": @_key}).all
    @rating_sum = ratings.map do |rating|
      rating.stars
    end.sum
    @rating_count = ratings.length
    @rating = @rating_count == 0 ? 0 : @rating_sum.to_f / @rating_count
    @comments_count = SectionComment.where(
      "doc.section_id == @section AND doc.hidden != true",
      {"section": @_key}
    ).count
    @update()
    nil
  end

  # It taken away, with its ratings, comments and the reports on it.
  def remove
    SectionRating.where({"section_id": @_key}).delete_all
    SectionComment.where({"section_id": @_key}).delete_all
    SectionReport.where({"section_id": @_key}).delete_all
    @delete
    nil
  end

  # What the editor's library shows of it, and inserts: {id, title, …, section, source}.
  def for_editor(names)
    {
      "id": @_key,
      "title": @title,
      "description": @description,
      "author": names[@user_id] ?? "A member",
      "instrument": @instrument,
      "style": @style,
      "time": @time,
      "key": @key,
      "bpm": @bpm,
      "bars": @bars,
      "tracks": @tracks,
      "rating": @average,
      "rating_count": @rating_count,
      "comments_count": @comments_count,
      "section": @section,
      "source": @source
    }
  end
end
