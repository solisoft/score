# LilyPond engraved as SVG, by EUI's own engraver.
#
# `eui_score_layout` / `eui_score_bands` (the native `eui-score` crate)
# answer canvas paths: kind 1 a rectangle, kind 5 an outline of commands —
# 0 move, 1 line, 2 quadratic, 3 cubic, 4 close — which map one for one onto
# SVG. No font travels: every glyph and every letter of a title is an
# outline.
#
# A glyph drawn twice — every notehead, every sharp, every letter — is one
# path in `<defs>`, placed by `<use>`: an outline is written relative to its
# first point, so the same shape anywhere is the same string. On a piano
# page that is some 80 paths for 200 placements. Coordinates are kept to a
# tenth of a pixel, finer than any screen draws them.

# How many of each engraving one account, or one address when signed out,
# may have the server make a minute (ScoreSvg.allowed?) — made, not read
# back from what was kept: a library page asks for 60 previews at once, a
# read page or the editor for a picture and its MIDI, an MCP client for a
# check of each source it sends.
const ENGRAVINGS_PER_MINUTE = {
  "pdf": 20,
  "midi": 60,
  "preview": 120,
  "page": 60,
  "mcp": 30
}
# How long a sender held back is told to wait, in seconds (Retry-After).
const ENGRAVING_RETRY_AFTER = 60

class ScoreSvg
  # {"svg": markup, "error": nil}, or {"svg": nil, "error": the engraver's
  # refusal, "score: … (at character N)" — one of its limits said in the
  # app's language (EngraverLimit.said)}. `width` and `staff_space` in px;
  # `max_height` px keeps only the bands that start above it (a preview),
  # 0 keeps them all. `marks` lights items as an editor shows a selection:
  # an item's number among the notes and rests, from 0, as a string, to a
  # CSS colour; their paths are drawn again over the score in it.
  #
  # Engraved once, then read back for ENGRAVING_DAYS (Engraving): the same
  # score at the same size and cut, with the same items lit, is the same
  # drawing, and an engraving costs tens of milliseconds a page. With a
  # `sender` (ScoreSvg.sender), one made anew counts against its minute's
  # engravings; past them the answer is {"svg": nil, "error": why,
  # "throttled": true}, kept nowhere.
  static def engrave(src, width, staff_space, max_height, marks, sender = nil)
    digest = ScoreSvg.digest(src, width, staff_space, max_height, marks)
    kept = Engraving.recall(digest)
    return ScoreSvg.said(kept) unless kept.nil?
    return ScoreSvg.throttled("svg") unless ScoreSvg.allowed?(sender)

    engraved = ScoreSvg.draw(src, width, staff_space, max_height, marks)
    Engraving.remember(digest, engraved)
    ScoreSvg.said(engraved)
  end

  # `answer` with its error said in the app's language when it is one of
  # the engraver's limits: what is kept is the engraver's English, read by
  # people of either language.
  static def said(answer)
    return answer if answer["error"].nil?

    answer.merge({"error": EngraverLimit.said(answer["error"])})
  end

  # The engraver's message in `error`, raised by one of its functions: its
  # own words, "score: … (at character N)", without what Soli adds after.
  static def engraver_message(error, otherwise)
    found = Regex.capture("(?P<message>score: .*\\(at character [0-9]+\\))", str(error))
    found.nil? ? otherwise : found["message"]
  end

  # What an engraving is kept under: all that makes it. ENGRAVING_FORMAT is
  # raised when the drawing itself changes (here, or in the engraver), so
  # what was kept before is not read again.
  static def digest(src, width, staff_space, max_height, marks)
    Crypto.sha256("#{ENGRAVING_FORMAT}|#{width}|#{staff_space}|#{max_height}|#{marks.to_json}|#{src}")
  end

  # The engraving itself: `engrave`'s answer, every time anew, in the
  # engraver's words. Music past the engraver's limits (EngraverLimit) is
  # refused as it reads it, in milliseconds, or as it draws it: a score
  # stored before them, or an AI's answer, costs no more than one saved now.
  static def draw(src, width, staff_space, max_height, marks)
    laid = eui_score_layout(src, width / staff_space, {})
    if laid.has_key("error")
      return {"svg": nil, "error": laid["error"]}
    end

    total = (laid["height"] * staff_space).ceil()
    bands = nil
    try
      bands = eui_score_bands(laid, staff_space, {
        "colour": "ink",
        "marks": marks
      }, total)
    catch error
      return {"svg": nil, "error": ScoreSvg.engraver_message(error, "score: it could not be drawn")}
    end
    prefix = "g" + Crypto.sha256("#{width}|#{staff_space}|#{max_height}|#{src}").substring(0, 8)
    glyph_ids = {}
    glyphs = []
    shapes = []
    lit = []
    right = 0
    bottom = 0
    ink = 0
    high = 0
    breaks = []
    bands.each do |band|
      top = band["y"]
      next if max_height > 0 && top > 0 && top >= max_height

      # Where a printed page may turn: between two bands (the header, then
      # each system), never across one (public/js/score.js, printCopy).
      breaks.push(ScoreSvg.px(top)) if top > 0
      bottom = top + band["h"]
      band["paths"].each do |shape|
        if shape[0] == 1
          shapes.push(ScoreSvg.rect(shape, top, nil))
          right = [right, shape[2] + shape[4]].max()
          ink = [ink, top + shape[3] + shape[5]].max()
          high = [high, top + shape[3]].min()
          next
        end

        outline = ScoreSvg.outline(shape)
        unless glyph_ids.has_key(outline["d"])
          glyph_ids[outline["d"]] = "#{prefix}-#{glyphs.length}"
          glyphs.push("<path id=\"#{glyph_ids[outline["d"]]}\" d=\"#{outline["d"]}\"/>")
        end
        shapes.push(ScoreSvg.use(glyph_ids[outline["d"]], outline, top))
        right = [right, outline["right"]].max()
        ink = [ink, top + outline["low"]].max()
        high = [high, top + outline["high"]].min()
      end
      band["lit"].each do |shape|
        lit.push(ScoreSvg.lit(shape, top))
      end
    end
    # As tall as the ink, not only the systems: a clef reaches below a staff
    # of rests, and its top above the first staff when nothing stands over
    # it — the picture starts that much higher.
    lift = high < 0 ? (1 - high).ceil() : 0
    height = lift + (max_height > 0 ? [bottom, total].min() : [total, (ink + 2).ceil()].max())
    view_width = (right + 2).ceil()
    breaks_attr = breaks.length > 0 && max_height == 0 ? " data-breaks=\"#{breaks.join(" ")}\"" : ""
    svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 #{-lift} #{view_width} #{height}\" "
    + "width=\"#{view_width}\" height=\"#{height}\" role=\"img\" aria-labelledby=\"#{prefix}-t #{prefix}-d\""
    + "#{breaks_attr}>"
    + "<title id=\"#{prefix}-t\">#{ScoreSvg.escape(ScoreSvg.title(src))}</title>"
    + "<desc id=\"#{prefix}-d\">#{ScoreSvg.escape(ScoreSvg.description(src, laid))}</desc>"
    + "<defs>#{glyphs.join("")}</defs><g fill=\"currentColor\">#{shapes.join("")}</g>#{lit.join("")}</svg>"
    {"svg": svg, "error": nil}
  end

  # A kind-1 path, moved down by `top`; in `fill` when one is given.
  static def rect(shape, top, fill)
    paint = fill.nil? ? "" : "fill=\"#{fill}\" "
    "<rect #{paint}x=\"#{ScoreSvg.px(shape[2])}\" y=\"#{ScoreSvg.px(shape[3] + top)}\" "
    + "width=\"#{ScoreSvg.px(shape[4])}\" height=\"#{ScoreSvg.px(shape[5])}\"/>"
  end

  # What a screen reader says of the drawing: the header's title, or "Score".
  # The editor's engraver (wasm/src/describe.rs) says the same, with each
  # staff's key and metre, which the layout does not give.
  static def title(src)
    Score.title_in(src) ?? "Score"
  end

  # The composer, then how many staves and bars, and each staff's notes and rests.
  static def description(src, laid)
    staves = []
    bars = 0
    laid["systems"].each do |system|
      in_system = system["staves"] ?? [{"bars": system["bars"]}]
      bars = bars + in_system[0]["bars"].length
      in_system.each_with_index do |staff, k|
        if staves.length <= k
          staves.push({"notes": 0, "rests": 0})
        end
        kinds = staff["bars"].map do |bar|
          bar["items"].map(&:k)
        end.flatten
        staves[k]["notes"] = staves[k]["notes"] + kinds.filter do |kind|
          kind == "note"
        end.length
        staves[k]["rests"] = staves[k]["rests"] + kinds.filter do |kind|
          kind == "rest"
        end.length
      end
    end
    found = Regex.capture("\\\\header\\s*\\{[^}]*?composer\\s*=\\s*\"(?P<composer>[^\"]*)\"", src.to_s)
    words = []
    words.push("By #{found["composer"].trim}.") unless found.nil? || found["composer"].blank?
    words.push("#{ScoreSvg.count(staves.length, "staff", "staves")}, #{ScoreSvg.count(bars, "bar", "bars")}.")
    staves.each_with_index do |staff, k|
      notes = ScoreSvg.count(staff["notes"], "note", "notes")
      words.push("Staff #{k + 1}: #{notes}, #{ScoreSvg.count(staff["rests"], "rest", "rests")}.")
    end
    words.join(" ")
  end

  static def count(n, one, many)
    "#{n} #{n == 1 ? one : many}"
  end

  static def escape(text)
    text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
  end

  # A glyph of `<defs>` placed where `outline` starts.
  static def use(id, outline, top)
    "<use href=\"##{id}\" x=\"#{ScoreSvg.px(outline["x"])}\" y=\"#{ScoreSvg.px(outline["y"] + top)}\"/>"
  end

  # A lit path, drawn in its own colour over the score.
  static def lit(shape, top)
    return ScoreSvg.rect(shape, top, shape[1]) if shape[0] == 1

    outline = ScoreSvg.outline(shape)
    at = "translate(#{ScoreSvg.px(outline["x"])} #{ScoreSvg.px(outline["y"] + top)})"
    "<path fill=\"#{shape[1]}\" transform=\"#{at}\" d=\"#{outline["d"]}\"/>"
  end

  # What a page shows of a source: its engraving and its MIDI as a data:
  # URL (nil when refused). With a `sender`, "throttled" says it was past
  # its engravings of the minute.
  static def figure(src, width, staff_space, sender = nil)
    ScoreSvg.marked_figure(src, width, staff_space, {}, sender)
  end

  # A figure with some of its items lit (see `engrave`).
  static def marked_figure(src, width, staff_space, marks, sender = nil)
    engraved = ScoreSvg.engrave(src, width, staff_space, 0, marks, sender)
    midi = engraved["error"].nil? ? ScoreSvg.midi(src, 100, sender) : {"file": nil}
    engraved.merge({
      "src": src,
      "midi": midi["file"].nil? ? nil : "data:audio/midi;base64," + midi["file"],
      "throttled": engraved["throttled"] == true || midi["throttled"] == true
    })
  end

  # Each source of `sources` (a hash, name to LilyPond) as a figure.
  static def figures(sources, width, staff_space)
    by_name = {}
    # `keys()`: a snippet is named "keys" (scores/syntax/keys.ly), and a bare
    # `sources.keys` reads that entry (Soli 2.30, C603: a key outranks a method).
    sources.keys().each do |name|
      by_name[name] = ScoreSvg.figure(sources[name], width, staff_space)
    end
    by_name
  end

  # The source as a Standard MIDI File, in a data: URL; nil when refused.
  # 100 a quarter when the source sets no tempo, as the editor plays it
  # (DEFAULT_BPM in public/eui-score/score-model.js).
  static def midi_url(src)
    encoded = ScoreSvg.midi_base64(src, 100)
    return nil if encoded.nil?

    "data:audio/midi;base64," + encoded
  end

  # Who asks for an engraving, for its limit (ENGRAVINGS_PER_MINUTE[kind]):
  # `user`, or, signed out, whoever asks from `ip`.
  static def sender(kind, user, ip)
    {"kind": kind, "key": user.nil? ? "ip:#{ip}" : "user:#{user._key}"}
  end

  # Whether `user` — or, signed out, whoever asks from `ip` — may have the
  # server make one more `kind` of engraving this minute; each asked counts.
  static def engraving_allowed?(kind, user, ip)
    ScoreSvg.allowed?(ScoreSvg.sender(kind, user, ip))
  end

  # Whether `sender` may have one more engraving made; always without one
  # (the site's own pieces, a job's). What was kept is read back without
  # asking: a source changed each time is what is made anew.
  static def allowed?(sender)
    return true if sender.nil?

    RateLimiter("engrave-#{sender["kind"]}:#{sender["key"]}", ENGRAVINGS_PER_MINUTE[sender["kind"]], 60).allowed()
  end

  # The answer to a sender past its engravings, `field` ("svg", "file")
  # left empty.
  static def throttled(field)
    answer = {"error": SiteText.t("security_540.too_many_engravings"), "throttled": true}
    answer[field] = nil
    answer
  end

  # A request answered "too many" (429), with when to come back.
  static def too_many
    {
      "status": 429,
      "headers": {"Content-Type": "text/plain; charset=utf-8", "Retry-After": ENGRAVING_RETRY_AFTER.to_s},
      "body": SiteText.t("security_540.too_many_engravings")
    }
  end

  # What a file made of `src` is kept under: its kind, what else made it
  # (the MIDI's tempo, the PDF's title), the drawing's format, the source.
  static def file_digest(kind, made_with, src)
    Crypto.sha256("#{kind}|#{ENGRAVING_FORMAT}|#{made_with}|#{src}")
  end

  # The MIDI file of `src` at `bpm` a quarter, in Base64; nil when refused.
  static def midi_base64(src, bpm)
    ScoreSvg.midi(src, bpm, nil)["file"]
  end

  # The MIDI file of `src` at `bpm` a quarter: {"file": in Base64, "error":
  # nil}, or {"file": nil, "error": why} — "throttled" past the sender's
  # engravings. Kept as an engraving is (Engraving), so a read page seen
  # again does not write it again.
  static def midi(src, bpm, sender = nil)
    digest = ScoreSvg.file_digest("midi", bpm, src)
    kept = Engraving.recall(digest)
    return ScoreSvg.said(kept) unless kept.nil?
    return ScoreSvg.throttled("file") unless ScoreSvg.allowed?(sender)

    written = nil
    try
      written = {"file": Base64.encode(eui_score_midi(src, {"bpm": bpm})), "error": nil}
    catch error
      written = {"file": nil, "error": ScoreSvg.engraver_message(error, "score: it could not be played")}
    end
    Engraving.remember(digest, written)
    ScoreSvg.said(written)
  end

  # The score printed, as a PDF titled `title`: {"file": the document,
  # "error": nil}, or {"file": nil, "error": why} — "throttled" past the
  # sender's engravings. Kept as an engraving is, when no bigger than
  # ENGRAVED_FILE_KEPT: a read page's PDF asked again is read, not printed
  # again.
  static def pdf(src, title, sender = nil)
    digest = ScoreSvg.file_digest("pdf", title, src)
    kept = Engraving.recall(digest)
    return ScoreSvg.said(kept) unless kept.nil?
    return ScoreSvg.throttled("file") unless ScoreSvg.allowed?(sender)

    printed = nil
    try
      printed = {"file": eui_score_pdf(src, title), "error": nil}
    catch error
      printed = {"file": nil, "error": ScoreSvg.engraver_message(error, "score: it could not be printed")}
    end
    Engraving.remember(digest, printed) if printed["file"].to_s.length <= ENGRAVED_FILE_KEPT
    ScoreSvg.said(printed)
  end

  # Why the engraver does not read `src` ({"error": why, in its own
  # English: the MCP tools answer it}), or {"error": nil} when it does —
  # "throttled" past the sender's engravings. Asked once the bounds read
  # without it hold (Score.bounds_refusal); its answer is kept as an
  # engraving is, and the engraver keeps its last layouts, so a source
  # checked, then saved, is laid out once.
  static def check(src, sender = nil)
    digest = ScoreSvg.file_digest("check", "", src)
    kept = Engraving.recall(digest)
    return kept unless kept.nil?
    return ScoreSvg.throttled("file") unless ScoreSvg.allowed?(sender)

    laid = eui_score_layout(src, ENGRAVER_LIMIT_WIDTH, {}) rescue {"error": "the engraver could not read it"}
    checked = {"file": nil, "error": laid.has_key("error") ? laid["error"].to_s : nil}
    Engraving.remember(digest, checked)
    checked
  end

  # The engraving alone, as an image a browser caches: the gallery's
  # previews, cut after the first systems.
  static def preview(src, sender = nil)
    ScoreSvg.preview_of(ScoreSvg.engrave(src, 560, 5.5, 230, {}, sender))
  end

  static def preview_of(engraved)
    svg = engraved["svg"] ?? "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\"/>"
    svg.replace("fill=\"currentColor\"", "fill=\"#111\"")
  end

  # A preview as the answer to an <img>: 200 and the picture, cached as
  # `cache_control` says; past the sender's engravings, 429 and a blank
  # picture of the same size, cached nowhere, with when to come back.
  static def preview_answer(src, sender, cache_control)
    engraved = ScoreSvg.engrave(src, 560, 5.5, 230, {}, sender)
    if engraved["throttled"] == true
      return {
        "status": 429,
        "headers": {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "no-store",
          "Retry-After": ENGRAVING_RETRY_AFTER.to_s
        },
        "body": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\">"
        + "<title>#{ScoreSvg.escape(engraved["error"])}</title></svg>"
      }
    end

    {
      "status": 200,
      "headers": {"Content-Type": "image/svg+xml", "Cache-Control": cache_control},
      "body": ScoreSvg.preview_of(engraved)
    }
  end

  # A kind-5 path as SVG's `d`, relative to its first point ("x", "y"), its
  # rightmost x, its lowest y and its highest.
  static def outline(shape)
    origin_x = shape[3]
    origin_y = shape[4]
    parts = []
    right = 0
    low = 0
    high = origin_y
    i = 2
    n = shape.length
    while i < n
      cmd = shape[i]
      if cmd == 4
        parts.push("Z")
        i += 1
        next
      end

      pairs = cmd == 3 ? 3 : (cmd == 2 ? 2 : 1)
      coords = []
      (0 .. pairs).each do |pair|
        x = shape[i + 1 + pair * 2]
        y = shape[i + 2 + pair * 2]
        right = x if x > right
        low = y if y > low
        high = y if y < high
        coords.push("#{ScoreSvg.px(x - origin_x)} #{ScoreSvg.px(y - origin_y)}")
      end
      parts.push(["M", "L", "Q", "C"][cmd] + coords.join(" "))
      i += 1 + pairs * 2
    end
    {
      "d": parts.join(""),
      "x": origin_x,
      "y": origin_y,
      "right": right,
      "low": low,
      "high": high
    }
  end

  # A length to a tenth of a pixel, without a trailing ".0".
  static def px(value)
    value.to_f.round(1).to_s
  end
end
