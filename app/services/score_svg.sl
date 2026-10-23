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
class ScoreSvg
  # {"svg": markup, "error": nil}, or {"svg": nil, "error": the engraver's
  # refusal, "score: … (at character N)"}. `width` and `staff_space` in px;
  # `max_height` px keeps only the bands that start above it (a preview),
  # 0 keeps them all. `marks` lights items as an editor shows a selection:
  # an item's number among the notes and rests, from 0, as a string, to a
  # CSS colour; their paths are drawn again over the score in it.
  static def engrave(src, width, staff_space, max_height, marks)
    laid = eui_score_layout(src, width / staff_space, {})
    if laid.has_key("error")
      return {"svg": nil, "error": laid["error"]}
    end

    total = (laid["height"] * staff_space).ceil()
    bands = eui_score_bands(laid, staff_space, {
      "colour": "ink",
      "marks": marks
    }, total)
    prefix = "g" + Crypto.sha256("#{width}|#{staff_space}|#{max_height}|#{src}").substring(0, 8)
    glyph_ids = {}
    glyphs = []
    shapes = []
    lit = []
    right = 0
    bottom = 0
    ink = 0
    high = 0
    bands.each do |band|
      top = band["y"]
      next if max_height > 0 && top > 0 && top >= max_height

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
    svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 #{-lift} #{view_width} #{height}\" "
    + "width=\"#{view_width}\" height=\"#{height}\" role=\"img\" aria-labelledby=\"#{prefix}-t #{prefix}-d\">"
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
  # URL (nil when refused).
  static def figure(src, width, staff_space)
    ScoreSvg.marked_figure(src, width, staff_space, {})
  end

  # A figure with some of its items lit (see `engrave`).
  static def marked_figure(src, width, staff_space, marks)
    engraved = ScoreSvg.engrave(src, width, staff_space, 0, marks)
    engraved.merge({"src": src, "midi": engraved["error"].nil? ? ScoreSvg.midi_url(src) : nil})
  end

  # Each source of `sources` (a hash, name to LilyPond) as a figure.
  static def figures(sources, width, staff_space)
    by_name = {}
    sources.keys.each do |name|
      by_name[name] = ScoreSvg.figure(sources[name], width, staff_space)
    end
    by_name
  end

  # The source as a Standard MIDI File, in a data: URL; nil when refused.
  static def midi_url(src)
    bytes = eui_score_midi(src, {}) rescue nil
    return nil if bytes.nil?

    "data:audio/midi;base64," + Base64.encode(bytes)
  end

  # The engraving alone, as an image a browser caches: the gallery's
  # previews, cut after the first systems.
  static def preview(src)
    engraved = ScoreSvg.engrave(src, 560, 5.5, 230, {})
    svg = engraved["svg"] ?? "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\"/>"
    svg.replace("fill=\"currentColor\"", "fill=\"#111\"")
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
