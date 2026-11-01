# How much music a source writes out to (#540), read without engraving it:
# what keeps a few characters of nested repeats from being stored, and from
# being engraved when they were stored before the bound.

# 80 characters that lay out 262,144 notes: seconds of engraving a page.
const WO_BOMB = "{ \\repeat unfold 64 { \\repeat unfold 64 { \\repeat unfold 16 { c4 d e f } } } }"
# 14 characters of rest that lay out a million bars.
const WO_RESTS = "{ R1*1000000 }"
const WO_PASSWORD = "correct horse battery"
const WO_CATEGORIES = [
  "changelog",
  "drums",
  "ensembles",
  "guitar",
  "piano",
  "solos",
  "syntax",
  "voice"
]

def wo_user
  user = User.new()
  user.email = "written-out-#{uuid_v4}@example.com"
  user.set_password(WO_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

# Every source the site ships: the gallery, the syntax page, the changelog.
def wo_shipped
  WO_CATEGORIES.map do |category|
    File.glob("scores/#{category}/*.ly")
  end.flatten
end

# The notes and rests the engraver lays out for `src`.
def wo_laid_items(src)
  laid = eui_score_layout(src, 150, {})
  items = 0
  laid["systems"].each do |system|
    (system["staves"] ?? [{"bars": system["bars"]}]).each do |staff|
      staff["bars"].each do |bar|
        items = items + bar["items"].length
      end
    end
  end
  items
end

# `times` uses of `b`, a variable of ten uses of `a`, itself a repeat
# written out to 256 notes: some 2,600 × `times` in all.
def wo_variables(times)
  uses = (0 .. times).map do |_|
    "\\b"
  end.join(" ")
  "a = { \\repeat unfold 64 { c4 d e f } }\nb = { \\a \\a \\a \\a \\a \\a \\a \\a \\a \\a }\n{ #{uses} }"
end

# `depth` repeats of `times` nested around one note.
def wo_nested(depth, times)
  opening = "\\repeat unfold " + times.to_s + " { "
  "{ " + opening * depth + "c4" + " }" * depth + " }"
end

# The library's own sections (db/data/house_sections.json), each a source.
def wo_house_sections
  JSON.parse(File.read("db/data/house_sections.json")).map do |seed|
    seed["source"].to_s
  end
end

describe("WrittenOut") do
  test("counts nested repeats as they play, and the bomb past the bound") do
    assert_eq(WrittenOut.count(WO_BOMB), SCORE_MOST_WRITTEN_OUT + 1, "never more than one past the bound")
    assert_eq(WrittenOut.count("{ \\repeat unfold 16 { \\repeat unfold 16 { c4 d e f } } }"), 1024)
    assert_eq(WrittenOut.count("{ \\repeat unfold 4 { c4 d e f } }"), 16)
    assert_eq(WrittenOut.count("{ \\repeat percent 8 { c4 d e f } }"), 32)
  end

  test("a repeat of one note, of a repeat, and of music a command introduces") do
    assert_eq(WrittenOut.count("{ \\repeat unfold 64 \\repeat unfold 64 c4 }"), 4096)
    unfolded = WrittenOut.count("\\repeat unfold 64 \\relative c' { \\repeat unfold 64 { c4 d e f } }")
    assert_gt(unfolded, 64 * 64 * 4)
    assert_lt(unfolded, 64 * 64 * 6 + 200)
    assert_eq(WrittenOut.count("{ \\repeat unfold 3 c4 d e }"), 5, "only the note after it repeats")
  end

  test("a volta repeat is drawn once") do
    assert_lt(WrittenOut.count("{ \\repeat volta 64 { \\repeat volta 64 { c4 d e f } } }"), 20)
  end

  test("counts a whole-bar rest or a spacer as its bars") do
    assert_eq(WrittenOut.count(WO_RESTS), SCORE_MOST_WRITTEN_OUT + 1)
    assert_eq(WrittenOut.count("{ R1*2000 }"), 2002)
    assert_eq(WrittenOut.count("{ s1*20 }"), 22)
    assert_eq(WrittenOut.count("{ R2.*3/2 c4 }"), 4, "a fraction of a bar counts once")
    assert_eq(WrittenOut.times_of("R1*12"), 12)
    assert_eq(WrittenOut.times_of("c4"), 1)
    assert_eq(WrittenOut.times_of("R1*0"), 1)
    assert_eq(type(WrittenOut.times_of("R2.*3/2")), "int", "a whole number of bars")
    assert_eq(WrittenOut.times_of("R1*99999999999999999999999"), SCORE_MOST_WRITTEN_OUT + 1)
  end

  test("reads `R1 * n` with spaces, or a comment, around the star as the engraver does") do
    assert_eq(WrittenOut.count("{ R1 * 1000000 }"), SCORE_MOST_WRITTEN_OUT + 1)
    assert_eq(WrittenOut.count("{ R1*%{ a comment %}1000000 }"), SCORE_MOST_WRITTEN_OUT + 1)
    assert_eq(WrittenOut.count("{ s1\n*\n1000000 c4 }"), SCORE_MOST_WRITTEN_OUT + 1)
    assert_eq(WrittenOut.count("{ R1 * 4 }"), 6)
  end

  test("a comment between a repeat's words, its count and its block is a space") do
    [
      "\\repeat %{%} unfold 64 { \\repeat unfold 64 { c4 d e f g a b c } }",
      "\\repeat % x\nunfold 64 { \\repeat unfold 64 { c4 d e f g a b c } }",
      "\\repeat unfold %{%} 64 { \\repeat unfold 64 { c4 d e f g a b c } }",
      "\\repeat unfold 64 %{%} { \\repeat unfold 64 { c4 d e f g a b c } }"
    ].each do |src|
      assert_eq(WrittenOut.count("{ #{src} }"), SCORE_MOST_WRITTEN_OUT + 1, src)
    end
    assert_gt(WrittenOut.count("{ \\time %{%} 1/64 R1*2000 }"), SCORE_MOST_WRITTEN_OUT)
    assert_eq(WrittenOut.count("{ \\repeat unfold 4 %{ x %} { c4 d e f } }"), 16)
  end

  test("counts a repeat or a rest whose count is a variable") do
    assert_gt(
      WrittenOut.count("n = 64\n{ \\repeat unfold \\n { \\repeat unfold \\n { c4 d e f g a b c } } }"),
      SCORE_MOST_WRITTEN_OUT
    )
    assert_gt(WrittenOut.count("n = 1000000\n{ R1*\\n }"), SCORE_MOST_WRITTEN_OUT)
    assert_gt(
      WrittenOut.count("m = 64\nn = \\m\n{ \\repeat unfold \\n { \\repeat unfold \\m { c4 d e f g a b c } } }"),
      SCORE_MOST_WRITTEN_OUT
    )
    assert_gt(
      WrittenOut.count("n = 4 x = 1\n{ \\repeat unfold \\n { c4 d e f } }"),
      16,
      "a number before another definition"
    )
  end

  test("reads a variable named with a dash or an underscore") do
    hyphenated = "a-x = { \\repeat unfold 64 { c4 d e f } }\nb-y = { " + "\\a-x " * 64 + "}\n{ \\b-y \\b-y }"
    assert_gt(WrittenOut.count(hyphenated), SCORE_MOST_WRITTEN_OUT)
    underscored = "a_x = { \\repeat unfold 64 { c4 d e f } }\nb_y = { " + "\\a_x " * 64 + "}\n{ \\b_y \\b_y }"
    assert_gt(WrittenOut.count(underscored), SCORE_MOST_WRITTEN_OUT)
    once = WrittenOut.count("left-hand = { c4 d }\n{ \\left-hand }")
    twice = WrittenOut.count("left-hand = { c4 d }\n{ \\left-hand \\left-hand }")
    assert_eq(twice - once, 2, "each use counts its music")
  end

  test("counts the endings of an unfolded repeat as often as it plays") do
    endings = "{ " + "c4 " * 200 + "}"
    unfolded = "{ \\repeat unfold 64 { \\repeat unfold 64 { c4 } \\alternative { #{endings} #{endings} } } }"
    assert_gt(WrittenOut.count(unfolded), SCORE_MOST_WRITTEN_OUT)
    assert_eq(WrittenOut.count("{ \\repeat unfold 4 { c4 } \\alternative { { d4 } { e4 } } }"), 13)
    named = "music = { c4 }\nends = { { d4 } { e4 } }\n{ \\repeat unfold 4 \\music \\alternative \\ends }"
    assert_gt(WrittenOut.count(named), 4 + 2 * 4, "the endings of a variable's repeat, through a variable")
    assert_lt(WrittenOut.count("{ \\repeat volta 4 { c4 } \\alternative { { d4 } { e4 } } }"), 20, "drawn once")
  end

  test("never overflows: nested repeats past what an Int holds are one past the bound") do
    assert_eq(WrittenOut.count(wo_nested(11, 64)), SCORE_MOST_WRITTEN_OUT + 1)
    assert_eq(WrittenOut.count(wo_nested(63, 2)), SCORE_MOST_WRITTEN_OUT + 1)
    assert_eq(WrittenOut.count(wo_nested(70, 64) + " " + wo_nested(70, 64)), SCORE_MOST_WRITTEN_OUT + 1)
    assert_eq(WrittenOut.count("{ \\repeat unfold 99999999999999999999 { c4 } }"), SCORE_MOST_WRITTEN_OUT
    + 1)
    assert_eq(WrittenOut.count(wo_nested(3, 4)), 64)
  end

  test("counts a note longer than a short metre's bar as the bars it is tied over") do
    assert_gt(WrittenOut.count("{ \\time 1/64 R1*2000 }"), SCORE_MOST_WRITTEN_OUT)
    assert_gt(WrittenOut.count("{ \\time 1/64 " + "c1 " * 600 + "}"), SCORE_MOST_WRITTEN_OUT)
    assert_gt(WrittenOut.count("{ \\time 1/64 c1 " + "d " * 600 + "}"), SCORE_MOST_WRITTEN_OUT, "a length carried on")
    reader = WrittenOut.new()
    assert_eq(reader.bar_of("\\time 1/64"), [1, 64])
    assert_eq(reader.bar_of("\\time 3/8 c4 \\time 1/16 c4"), [1, 16], "the shortest of them")
    assert_eq(reader.bar_of("\\time 2+1/16"), [3, 16], "beats added up")
    assert_eq(reader.bar_of("\\time 3/4 \\time 6/8 \\time 2/4 \\time 4/4")[1], 0, "within the margin")
    reader.bar_of("\\time 1/4")
    assert_eq(reader.span("c1"), 5, "four bars, and the one it may start in")
    assert_eq(reader.span("d"), 5, "the length goes on")
    assert_eq(reader.span("e4"), 1)
    assert_eq(reader.span("|"), 1)
    assert_eq(reader.span("R1*3"), 13)
    assert_eq(type(reader.span("c2..")), "int")
  end

  test("does not multiply the notes a short metre's bar holds") do
    eighths = "{ \\time 3/8 " + "c8 d e " * 100 + "}"
    assert_eq(WrittenOut.count(eighths), 304, "a 3/8 of eighths counts its words")
    quarters = "{ \\time 1/4 " + "c4 " * 100 + "}"
    assert_eq(WrittenOut.count(quarters), 104)
    assert_eq(type(WrittenOut.count("{ \\time 3/8 c4 c2 }")), "int")
  end

  test("counts a variable as often as it is used, a variable in a variable multiplied") do
    within = WrittenOut.count(wo_variables(10))
    assert_gt(within, 10 * 10 * 64 * 4)
    assert_lt(within, SCORE_MOST_WRITTEN_OUT)
    assert_gt(WrittenOut.count(wo_variables(12)), SCORE_MOST_WRITTEN_OUT)
    one = WrittenOut.count("melody = \\relative c' { c4 d e f }\n{ \\melody }")
    four = WrittenOut.count("melody = \\relative c' { c4 d e f }\n{ \\melody \\melody \\melody \\melody }")
    assert_eq(one, 13)
    assert_eq(four, 31, "each use counts its music")
    assert_eq(WrittenOut.count("staffsize = 20\nname = \"Piano\"\n{ \\name c4 }"), 6, "a value that is not music")
    assert_eq(WrittenOut.count("music = { c4 d }\n{ \\repeat unfold 8 \\music }"), 19)
  end

  test("does not count what a comment or a string holds") do
    words = (0 .. 1000).map do |_|
      "c4"
    end.join(" ")
    assert_lt(WrittenOut.count("% #{words}\n{ c4 }"), 5)
    assert_lt(WrittenOut.count("%{ #{words} %}\n{ c4 }"), 5)
    assert_lt(WrittenOut.count("\\header { title = \"#{words}\" }\n{ c4 }"), 12)
    assert_eq(WrittenOut.count(""), 0)
    assert_eq(WrittenOut.count(nil), 0)
  end

  test("every piece the site ships stays far below the bound, and is never counted low") do
    shipped = wo_shipped()
    assert_eq(shipped.length, 90)
    shipped.each do |path|
      src = File.read(path)
      count = WrittenOut.count(src)
      assert_lt(count, SCORE_MOST_WRITTEN_OUT / 30, path)
      assert_null(Score.refusal_of(src), path)
      assert_null(ScoreSvg.refusal(src), path)
      laid = eui_score_layout(src, 150, {})
      assert_gt(count + 1, wo_laid_items(src), path) unless laid.has_key("error")
    end
  end

  test("every section of the library's own stays far below the bound") do
    sections = wo_house_sections()
    assert_gt(sections.length, 300)
    sections.each do |src|
      assert_lt(WrittenOut.count(src), SCORE_MOST_WRITTEN_OUT / 30, src.substring(0, 60))
    end
  end

  test("never counts low what the engraver writes out") do
    [
      "{ \\repeat %{ x %} unfold 8 { c4 d e f } }",
      "{ R1 * 40 }",
      "a-x = { c4 d }\n{ \\a-x \\a-x \\a-x }",
      "n = 8\n{ \\repeat unfold \\n { c4 d } R1*\\n }",
      "{ \\repeat unfold 4 { c4 } \\alternative { { d4 e f g } { a4 } } }",
      "{ \\time 1/64 c1 d e f }",
      "{ \\time 1/64 c8 c1 c4 }",
      "{ \\time 3/8 c4 c4 c4 c2 }",
      "{ \\repeat unfold 32 { c4 d e f } }",
      wo_variables(2),
      "\\repeat unfold 8 \\relative c' { \\repeat unfold 8 { c4 d e f } }",
      "{ \\repeat percent 16 { c4 d e f } }",
      "{ R1*200 }",
      "{ \\time 1/64 c1 c1 R1*4 }",
      "{ \\time 3/4 c1 d1 e1 }",
      "\\new PianoStaff \\autoChange \\relative c' { \\repeat unfold 16 { g4 a b c | c,1 } }"
    ].each do |src|
      assert_gt(WrittenOut.count(src) + 1, wo_laid_items(src), src)
    end
  end

  # About 0.1 s for the plain path and 0.8 s for the tokens' on a laptop
  # (scratch measure); not timed here: coverage instruments every line.
  test("reads a source of a million characters, either way") do
    plain = "{ c4 d e f g a b c d e f g }\n" * 34000
    assert_eq(WrittenOut.count(plain), SCORE_MOST_WRITTEN_OUT + 1)
    looped = "a = { c4 }\n" + plain
    assert_eq(WrittenOut.count(looped), SCORE_MOST_WRITTEN_OUT + 1)
    assert_eq(
      WrittenOut.count("a = { c4 }\n" + "{ c4 d e f g a b c d e f g }\n" * 100),
      1202,
      "the runs of words counted as words"
    )
    short = "{ \\time 1/64 " + "c64 " * 400000 + "}"
    assert_eq(WrittenOut.count(short), SCORE_MOST_WRITTEN_OUT + 1, "word after word, until past the bound")
  end
end

describe("Score and the music it writes out (#540)") do
  test("refuses to save the bomb from the editor, and writes nothing") do
    owner = wo_user()
    score = Score.start(owner, Score.blank_source("Calm"))
    base = score.revision
    saved = score.save_from_editor(WO_BOMB, base, owner)
    assert_eq(saved["status"], 422)
    assert_eq(saved["body"]["error"], SiteText.t("security_540.not_saved_too_much_music"), "the estimator's refusal")
    assert_contains(saved["body"]["error"], "30,000")
    assert_eq(saved["body"]["revision"], base)
    rests = score.save_from_editor(WO_RESTS, base, owner)
    assert_eq(rests["status"], 422)
    stored = Score.find(score._key)
    assert_eq(stored.revision, base)
    assert_contains(stored.source, "r1")
    assert_eq(ScoreVersion.where({"score_id": score._key}).count, 0, "no version kept of it")
  end

  test("refuses to create one, whatever makes it: nothing stored") do
    owner = wo_user()
    before = Score.where({"user_id": owner._key}).count
    created = Score.start(owner, WO_BOMB)
    assert_not_null(created._errors)
    assert_eq(created._errors[0]["field"], "source")
    assert_contains(created._errors[0]["message"], "30,000")
    copied = Score.copy_of(owner._key, WO_RESTS, "Rests")
    assert_not_null(copied._errors)
    assert_eq(Score.where({"user_id": owner._key}).count, before)
  end

  test("a long score of plain music within the bound is kept") do
    owner = wo_user()
    long = "\\header { title = \"Long\" }\n{ " + "c'4 d' e' f' | " * 5000 + "}"
    assert_lt(WrittenOut.count(long), SCORE_MOST_WRITTEN_OUT)
    score = Score.start(owner, long)
    assert_null(score._errors)
    assert_eq(Score.find(score._key).title, "Long")
  end

  test("a score stored past the bound can still be renamed, shared, trashed and restored") do
    owner = wo_user()
    score = Score.start(owner, Score.blank_source("Stuck"))
    Score.where("doc._key == @key", {"key": score._key}).update_all({"source": "\\header { title = \"Stuck\" }\n"
    + WO_BOMB})
    stored = Score.find(score._key)
    WrittenOut.last_source = nil
    readings = WrittenOut.readings
    assert(stored.make_visible("link"), "made visible")
    assert(stored.new_link, "a new link")
    assert(stored.move_to_trash, "trashed")
    assert(stored.restore_from_trash, "restored")
    assert(stored.rename("Unstuck"), "renamed")
    assert_eq(WrittenOut.readings, readings, "none of them counted its music")
    again = Score.find(score._key)
    assert_eq(again.title, "Unstuck")
    assert_eq(again.visibility, "link")
    assert_null(again.trashed_at)
    assert_contains(again.source, WO_BOMB)
  end

  test("a version that writes out to too much music is not restored, and nothing is kept") do
    owner = wo_user()
    score = Score.start(owner, Score.blank_source("Versions"))
    bomb = ScoreVersion.keep(score, WO_BOMB, "manual", owner._key)
    calm = ScoreVersion.keep(score, Score.blank_source("Calm again"), "manual", owner._key)
    before = ScoreVersion.where({"score_id": score._key}).count
    assert_not(score.restore_version(bomb, owner))
    assert_eq(ScoreVersion.where({"score_id": score._key}).count, before, "the score as it stands not kept again")
    assert_not(Score.find(score._key).source.contains("unfold"))
    assert(score.restore_version(calm, owner))
    assert_eq(Score.find(score._key).title, "Calm again")
  end

  test("reads a source once for its bounds and its validation") do
    owner = wo_user()
    src = "\\header { title = \"Once #{uuid_v4}\" }\n{ c'4 d' e' f' }"
    readings = WrittenOut.readings
    assert_null(Score.refusal_of(src))
    score = Score.start(owner, src)
    assert_null(score._errors)
    assert_eq(WrittenOut.readings, readings + 1)
  end

  test("says it in French to a French editor") do
    assert_contains(SiteText.t("security_540.not_saved_too_much_music", {}, "fr"), "30 000")
    assert_contains(SiteText.t("security_540.too_much_to_engrave", {}, "fr"), "graver")
  end
end

describe("ScoreSvg and the music it writes out (#540)") do
  test("refuses to engrave a stored bomb before the engraver sees it, and says why") do
    refused = SiteText.t("security_540.too_much_to_engrave")
    engraved = ScoreSvg.draw(WO_BOMB, 1000, 7, 0, {})
    assert_null(engraved["svg"])
    assert_eq(engraved["error"], refused, "the estimator's refusal, not the engraver's")
    assert_null(ScoreSvg.midi_url(WO_BOMB))
    assert_null(Engraving.find_by("_key", ScoreSvg.file_digest("midi", 100, WO_BOMB)), "no MIDI written, nor kept")
    printed = ScoreSvg.pdf(WO_RESTS, "Rests")
    assert_null(printed["file"])
    assert_eq(printed["error"], refused)
    assert_contains(ScoreSvg.preview(WO_BOMB), "width=\"1\"")
    assert_eq(Engraving.find(ScoreSvg.digest(WO_BOMB, 560, 5.5, 230, {})).error, refused)
    assert_eq(AiClient.problem(WO_BOMB), refused)
  end

  test("prints a PDF once, then reads it back") do
    src = "\\header { title = \"Kept #{uuid_v4}\" }\n{ c'4 d' e' f' }"
    first = ScoreSvg.pdf(src, "Kept")
    assert(first["file"].starts_with?("%PDF"))
    assert_null(first["error"])
    digest = ScoreSvg.file_digest("pdf", "Kept", src)
    kept = Engraving.find(digest)
    assert_eq(kept.file, first["file"], "kept byte for byte")
    assert_eq(kept.bytes, first["file"].length)
    assert_eq(ScoreSvg.pdf(src, "Kept")["file"], first["file"], "read back the same")
    Engraving.upsert(
      digest,
      {
        "file": "%PDF kept",
        "error": nil,
        "created_at": DateTime.utc.to_unix
      }
    )
    assert_eq(ScoreSvg.pdf(src, "Kept")["file"], "%PDF kept")
    assert(ScoreSvg.pdf(src, "Other title")["file"].starts_with?("%PDF"), "another title, another PDF")
  end

  test("writes a MIDI file once, then reads it back; a refused one is nil") do
    src = "{ c'4 d' e' f' r#{uuid_v4.length % 2 + 1} }"
    encoded = ScoreSvg.midi_base64(src, 96)
    assert_not_null(encoded)
    assert(ScoreSvg.midi_url(src).starts_with?("data:audio/midi;base64,"))
    Engraving.upsert(
      ScoreSvg.file_digest("midi", 96, src),
      {
        "file": "a2VwdA==",
        "error": nil,
        "created_at": DateTime.utc.to_unix
      }
    )
    assert_eq(ScoreSvg.midi_base64(src, 96), "a2VwdA==")
    assert_null(ScoreSvg.midi_base64("{ c'4 \\shiver }", 96), "the engraver refuses it")
    assert_null(ScoreSvg.midi_base64("{ c'4 \\shiver }", 96), "and again, from what was kept")
  end

  test("holds a sender to so many files a minute: an address signed out, an account signed in") do
    ip = "198.51.100.#{uuid_v4}"
    (0 .. ENGRAVINGS_PER_MINUTE["pdf"]).each do |n|
      assert(ScoreSvg.engraving_allowed?("pdf", nil, ip), "pdf #{n}")
    end
    assert_not(ScoreSvg.engraving_allowed?("pdf", nil, ip))
    assert(ScoreSvg.engraving_allowed?("midi", nil, ip), "another kind is counted apart")
    assert(ScoreSvg.engraving_allowed?("pdf", nil, "203.0.113.#{uuid_v4}"), "another address")
    user = wo_user()
    assert(ScoreSvg.engraving_allowed?("pdf", user, ip), "an account is counted on its own")
  end

  test("counts what it makes against a sender, not what it reads back") do
    sender = ScoreSvg.sender("preview", nil, "198.51.100.#{uuid_v4}")
    kept = "{ c'4 d' e' f' }\n% #{uuid_v4}"
    assert_not_null(ScoreSvg.engrave(kept, 560, 5.5, 230, {}, sender)["svg"])
    (0 .. ENGRAVINGS_PER_MINUTE["preview"] + 5).each do |n|
      assert_not_null(ScoreSvg.engrave(kept, 560, 5.5, 230, {}, sender)["svg"], "read back #{n}")
    end
    (0 .. ENGRAVINGS_PER_MINUTE["preview"] - 1).each do |n|
      made = ScoreSvg.engrave("{ c'4 d' e' f' }\n% #{n} #{uuid_v4}", 560, 5.5, 230, {}, sender)
      assert_not_null(made["svg"], "made #{n}")
    end
    src = "{ c'4 d' e' f' }\n% past #{uuid_v4}"
    held = ScoreSvg.engrave(src, 560, 5.5, 230, {}, sender)
    assert(held["throttled"])
    assert_null(held["svg"])
    assert_eq(held["error"], SiteText.t("security_540.too_many_engravings"))
    assert_null(Engraving.find_by("_key", ScoreSvg.digest(src, 560, 5.5, 230, {})), "nothing kept of it")
    assert_not_null(ScoreSvg.engrave(src, 560, 5.5, 230, {})["svg"], "without a sender, no limit")
  end

  test("a figure, a PDF, a MIDI file and a check past the sender's minute are held back") do
    ip = "198.51.100.#{uuid_v4}"
    page = ScoreSvg.sender("page", nil, ip)
    (0 .. ENGRAVINGS_PER_MINUTE["page"] / 2).each do |n|
      figure = ScoreSvg.figure("{ c'4 d' }\n% #{n} #{uuid_v4}", 1040, 7, page)
      assert_not(figure["throttled"], "figure #{n}")
      assert_not_null(figure["midi"])
    end
    held = ScoreSvg.figure("{ c'4 d' }\n% #{uuid_v4}", 1040, 7, page)
    assert(held["throttled"])
    assert_null(held["svg"])
    assert_null(held["midi"])
    pdf = ScoreSvg.sender("pdf", nil, ip)
    (0 .. ENGRAVINGS_PER_MINUTE["pdf"]).each do |n|
      ScoreSvg.pdf("{ c'4 }\n% #{n} #{uuid_v4}", "T", pdf)
    end
    assert(ScoreSvg.pdf("{ c'4 }\n% #{uuid_v4}", "T", pdf)["throttled"])
    midi = ScoreSvg.sender("midi", nil, ip)
    (0 .. ENGRAVINGS_PER_MINUTE["midi"]).each do |n|
      ScoreSvg.midi("{ c'4 }\n% #{n} #{uuid_v4}", 100, midi)
    end
    assert(ScoreSvg.midi("{ c'4 }\n% #{uuid_v4}", 100, midi)["throttled"])
    user = wo_user()
    mcp = ScoreSvg.sender("mcp", user, nil)
    (0 .. ENGRAVINGS_PER_MINUTE["mcp"]).each do |n|
      assert_null(ScoreSvg.check("{ c'4 }\n% #{n} #{uuid_v4}", mcp)["error"], "check #{n}")
    end
    assert(ScoreSvg.check("{ c'4 }\n% #{uuid_v4}", mcp)["throttled"])
  end

  test("keeps a check's answer: a source checked again is not laid out again") do
    src = "{ c'4 \\shiver }\n% #{uuid_v4}"
    refused = ScoreSvg.check(src)
    assert_contains(refused["error"], "shiver")
    Engraving.upsert(
      ScoreSvg.file_digest("check", "", src),
      {
        "file": nil,
        "error": "kept answer",
        "created_at": DateTime.utc.to_unix
      }
    )
    assert_eq(ScoreSvg.check(src)["error"], "kept answer")
    assert_null(ScoreSvg.check("{ c'4 d' }\n% #{uuid_v4}")["error"])
  end

  test("answers too many with when to come back: a text, or a blank picture") do
    answer = ScoreSvg.too_many
    assert_eq(answer["status"], 429)
    assert_eq(answer["headers"]["Retry-After"], "60")
    assert_eq(answer["body"], SiteText.t("security_540.too_many_engravings"))
    sender = ScoreSvg.sender("preview", nil, "198.51.100.#{uuid_v4}")
    (0 .. ENGRAVINGS_PER_MINUTE["preview"]).each do |n|
      ScoreSvg.preview_answer("{ c'4 }\n% #{n} #{uuid_v4}", sender, "public, max-age=3600")
    end
    picture = ScoreSvg.preview_answer("{ c'4 }\n% #{uuid_v4}", sender, "public, max-age=3600")
    assert_eq(picture["status"], 429)
    assert_eq(picture["headers"]["Content-Type"], "image/svg+xml")
    assert_eq(picture["headers"]["Retry-After"], "60")
    assert_eq(picture["headers"]["Cache-Control"], "no-store")
    assert(picture["body"].starts_with?("<svg "))
    shown = ScoreSvg.preview_answer("{ c'4 d' }", nil, "public, max-age=3600")
    assert_eq(shown["status"], 200)
    assert_eq(shown["headers"]["Cache-Control"], "public, max-age=3600")
    assert_contains(shown["body"], "fill=\"#111\"")
  end
end
