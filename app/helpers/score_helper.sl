# Showing an engraved score: the figure that holds it, its buttons, and its
# LilyPond source highlighted.
#
# The engraving itself is `ScoreSvg`'s (app/services), which a view cannot
# call: controllers build each figure with `ScoreSvg.figure(src, width,
# staff_space)` and hand it over — {"src", "svg", "error", "midi"}.

# LilyPond as escaped HTML, its commands, strings, comments, numbers and
# brackets each in a span the stylesheet colours.
def score_highlight(src)
  chars = src.chars()
  out = []
  i = 0
  while i < chars.length
    token = _score_token(chars, i)
    out.push(token[0].nil? ? html_escape(chars[i]) : _score_span(token[0], chars, i, token[1]))
    i = token[1]
  end
  out.join("")
end

# The token starting at `i`: [its CSS class, or nil for plain text, and
# the index just past it].
def _score_token(chars, i)
  ch = chars[i]
  following = i + 1 < chars.length ? chars[i + 1] : ""
  return ["ly-comment", _score_skip_until(chars, i, "\n")] if ch == "%"
  return ["ly-string", [_score_skip_until(chars, i + 1, "\"") + 1, chars.length].min()] if ch == "\""
  return ["ly-command", i + 2] if ch == "\\" && following.present? && "\\<>!".contains(following)
  return ["ly-command", _score_skip_while(chars, i + 1, _score_letters())] if ch == "\\"
  return ["ly-bracket", i + 1] if "{}<>".contains(ch)
  return ["ly-number", _score_skip_while(chars, i, "0123456789/.*")] if "0123456789".contains(ch)

  [nil, i + 1]
end

# A function, not a `const`: a view does not see the helpers' constants.
def _score_letters
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
end

def _score_skip_while(chars, j, allowed)
  while j < chars.length && allowed.contains(chars[j])
    j += 1
  end
  j
end

def _score_skip_until(chars, j, stop)
  while j < chars.length && chars[j] != stop
    j += 1
  end
  j
end

def _score_span(css_class, chars, start, stop)
  "<span class=\"#{css_class}\">" + html_escape(chars.slice(start, stop).join("")) + "</span>"
end

# The paper a source's PDF is printed on, as a button names it: "A4" when
# its \paper sets none, "Letter", "A3 landscape"… The editor names it the
# same way (paperLabel, public/eui-score/score-model.js): a change here goes
# there too.
def paper_label(src)
  sizes = Regex.find_all("set-paper-size\\s+\"[A-Za-z0-9]+\"(\\s+'landscape)?", src.to_s)
  return "A4" if sizes.length == 0

  text = sizes[0]["match"]
  name = text.split("\"")[1].downcase
  turned = text.ends_with?("'landscape") || name.ends_with?("landscape")
  name = name.substring(0, name.length - 9) if name.ends_with?("landscape")
  names = {
    "a4": "A4",
    "letter": "Letter",
    "a3": "A3",
    "a5": "A5",
    "a6": "A6",
    "b4": "B4",
    "b5": "B5",
    "legal": "Legal",
    "tabloid": "Tabloid",
    "11x17": "11×17"
  }
  label = names[name] ?? name
  turned ? "#{label} landscape" : label
end

# The score, its buttons and its source. `figure` is `ScoreSvg.figure`'s;
# `opts`:
#   "name"     "syntax/notes" or "piano/waltz": the MIDI file's name, and
#              what the sandbox opens with
#   "sandbox"  the sandbox's path, `playground_path()` — route helpers are
#              the view's, not visible from a helper's own functions
#   "pdf"      the PDF's URL, when there is one
#   "title"    the PDF's footer, for a source whose \header names none
#   "source"   "open" (default), "closed" or "none"
#   "caption"  a line under the score
def score_figure(figure, opts)
  html = ["<figure class=\"score-figure\">"]
  if figure["error"].nil?
    html.push("<div class=\"score-sheet\">#{figure["svg"]}</div>")
  else
    message = html_escape(figure["error"])
    html.push("<div class=\"score-sheet score-sheet-refused\"><p class=\"score-error\">#{message}</p></div>")
  end
  html.push("<figcaption>#{html_escape(opts["caption"])}</figcaption>") unless opts["caption"].blank?
  html.push(_score_actions(figure, opts))
  source_mode = opts["source"] ?? "open"
  unless source_mode == "none"
    open_attr = source_mode == "open" ? " open" : ""
    html.push("<details class=\"score-source\"#{open_attr}><summary>#{I18n.translate("score.source")}</summary>")
    copy = I18n.translate("score.copy")
    html.push("<div class=\"score-code\"><button type=\"button\" class=\"score-copy\" data-score-copy>#{copy}</button>")
    html.push("<pre><code>#{score_highlight(figure["src"])}</code></pre></div></details>")
  end
  html.push("</figure>")
  html.join("")
end

def _score_actions(figure, opts)
  return "" unless figure["error"].nil?

  name = opts["name"]
  file_name = name.blank? ? "score" : name.split("/").last
  buttons = []
  midi = figure["midi"]
  unless midi.nil?
    # The source rides along: a piece with repeats is played out in the
    # browser (public/js/score.js), the server's MIDI playing them once.
    play_attrs = "data-score-play data-midi=\"#{midi}\" data-src=\"#{html_escape(figure["src"])}\""
    # A section of the library: looped until Stop, its bars read from its data (#457).
    looped = " data-section=\"#{html_escape(opts["section"])}\" data-loop"
    play_attrs = play_attrs + looped unless opts["section"].blank?
    buttons.push("<button type=\"button\" class=\"score-btn score-btn-play\" #{play_attrs}>"
    + "<span aria-hidden=\"true\">▶</span> #{I18n.translate("score.play")}</button>")
    # The MIDI link saves the file as Play plays it (score.js), repeats and all.
    midi_attrs = "data-score-midi href=\"#{midi}\" download=\"#{html_escape(file_name)}.mid\""
    buttons.push("<a class=\"score-btn\" #{midi_attrs}>MIDI</a>")
  end
  unless opts["pdf"].blank?
    # Printed in the browser, on the paper the source's \paper sets
    # (score.js); the server's, which the link fetches without it, is on A4.
    pdf_attrs = "data-score-pdf href=\"#{html_escape(opts["pdf"])}\" download=\"#{html_escape(file_name)}.pdf\""
    pdf_attrs += " data-title=\"#{html_escape(opts["title"])}\"" unless opts["title"].blank?
    buttons.push("<a class=\"score-btn\" #{pdf_attrs}>#{paper_label(figure["src"])} PDF</a>")
  end
  unless name.blank? || opts["sandbox"].blank?
    href = "#{html_escape(opts["sandbox"])}?source=#{html_escape(name)}"
    buttons.push("<a class=\"score-btn score-btn-ghost\" href=\"#{href}\">#{I18n.translate("score.edit")}</a>")
  end
  "<div class=\"score-actions\">#{buttons.join("")}<div class=\"score-player\" data-score-player></div></div>"
end

# A snippet of the syntax page: `figures` is the page's, `name` the
# snippet's file under scores/syntax/.
def score_snippet(figures, name, sandbox)
  score_figure(
    figures[name],
    {
      "name": "syntax/" + name,
      "sandbox": sandbox
    }
  )
end

# The pickups the editor's menus offer: [value, label], the value as
# \partial writes it (score-model.js reads it with pickupOf), "" for none.
def editor_pickups
  [
    ["", _editor_t("app.editor.pickup_none")],
    ["16", _editor_t("app.editor.pickup_sixteenth")],
    ["8", _editor_t("app.editor.pickup_eighth")],
    ["8.", _editor_t("app.editor.pickup_dotted_eighth")],
    ["4", _editor_t("app.editor.pickup_quarter")],
    ["4.", _editor_t("app.editor.pickup_dotted_quarter")],
    ["2", _editor_t("app.editor.pickup_half")],
    ["2.", _editor_t("app.editor.pickup_dotted_half")]
  ]
end

# The metres the editor's menus offer: the usual, the odd, the added up.
def editor_metres
  ["2/4", "3/4", "4/4", "5/4", "6/4", "7/4", "2/2", "3/2", "3/8", "5/8", "6/8", "7/8", "9/8", "12/8"]
  + ["2+3/8", "3+2/8", "2+2+3/8", "3+3+2/8", "13/8", "15/16"]
end

# The keys the menus offer, from seven flats to seven sharps: [fifths, its
# name, major and minor], e.g. [-3, "E♭ major / C minor"], in the app's
# language (#508): [-3, "Mi♭ majeur / do mineur"]. The Start page and the
# editor list the same keys.
def editor_keys
  majors = ["C♭", "G♭", "D♭", "A♭", "E♭", "B♭", "F", "C", "G", "D", "A", "E", "B", "F♯", "C♯"]
  minors = ["A♭", "E♭", "B♭", "F", "C", "G", "D", "A", "E", "B", "F♯", "C♯", "G♯", "D♯", "A♯"]
  major_names = _editor_t("app.editor.major_note_names").split(" ")
  minor_names = _editor_t("app.editor.minor_note_names").split(" ")
  range(-7, 8).map do |fifths|
    major = _editor_note_name(majors[fifths + 7], major_names)
    minor = _editor_note_name(minors[fifths + 7], minor_names)
    name = _editor_t(
      "app.editor.key_name",
      {"major": major, "minor": minor}
    )
    [fifths, name]
  end
end

# `key` in the request's language, its {name}s replaced by `vars`: t() as
# the views have it, which a helper does not see. A spec run outside the
# server has no locale files loaded: SiteText reads them (the server's views
# do not see SiteText, but never need it).
def _editor_t(key, vars = {})
  text = I18n.translate(key)
  text = SiteText.t(key) if text == key
  for name in vars.keys
    text = text.replace("{#{name}}", vars[name].to_s)
  end
  text
end

# "E♭" with its letter named from `names` (C D E F G A B, in that order).
def _editor_note_name(note, names)
  names["CDEFGAB".index_of(note.substring(0, 1))] + note.substring(1, note.length)
end

# What the editor's page script says (app/views/app/scores/show.html.slv),
# in the app's language (#508): its name => the words.
def editor_page_words
  words = {"keep_version": _editor_t("app.layout.keep_version")}
  # Its words' names, under app.editor.page.
  names = [
    "not_allowed",
    "signed_out",
    "sign_in_again",
    "to_save",
    "saved_note",
    "saved",
    "saved_by",
    "saved_elsewhere",
    "changed_by",
    "changed_elsewhere",
    "merged_note_by",
    "merged_note_window",
    "merged_by",
    "merged_window",
    "merged_mine",
    "merged_theirs",
    "loaded_theirs",
    "saving_copy",
    "saving",
    "not_saved",
    "unsaved",
    "offline",
    "greeting",
    "opening_new",
    "someone",
    "someone_lower",
    "with",
    "reading",
    "also_editing",
    "you_elsewhere",
    "changed_window",
    "updated",
    "bars_gone",
    "back_offline",
    "version_kept",
    "not_kept",
    "sending_photo",
    "photo_not_read",
    "see_plans",
    "ai_working",
    "ai_proposes",
    "ai_timeout",
    "ai_not_sent",
    "ai_applied",
    "chords_title",
    "chords_about",
    "chords_hint",
    "harmonize_title",
    "harmonize_about",
    "harmonize_hint",
    "improve_title",
    "improve_about",
    "improve_hint",
    "ask_title",
    "ask_about",
    "ask_hint"
  ]
  for name in names
    words[name] = _editor_t("app.editor.page.#{name}")
  end
  words
end
