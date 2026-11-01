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

# `stack` copies of `inner` used one inside the other through variables.
def wo_variables(times)
  uses = (0 .. times).map do |_|
    "\\b"
  end.join(" ")
  "a = { \\repeat unfold 64 { c4 d e f } }\nb = { \\a \\a \\a \\a \\a \\a \\a \\a \\a \\a }\n{ #{uses} }"
end

describe("WrittenOut") do
  test("counts nested repeats as they play, and the bomb past the bound") do
    assert_eq(WrittenOut.count(WO_BOMB), 262144)
    assert_gt(WrittenOut.count(WO_BOMB), SCORE_MOST_WRITTEN_OUT)
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
    assert_eq(WrittenOut.count(WO_RESTS), 1000002)
    assert_eq(WrittenOut.count("{ s1*20 }"), 22)
    assert_eq(WrittenOut.count("{ R2.*3/2 c4 }"), 4, "a fraction of a bar counts once")
    assert_eq(WrittenOut.times_of("R1*12"), 12)
    assert_eq(WrittenOut.times_of("c4"), 1)
    assert_eq(WrittenOut.times_of("R1*0"), 1)
  end

  test("counts a whole note as the bars a short metre cuts it into") do
    assert_gt(WrittenOut.count("{ \\time 1/64 R1*2000 }"), SCORE_MOST_WRITTEN_OUT)
    assert_eq(WrittenOut.short_bars("\\time 1/64"), 64)
    assert_eq(WrittenOut.short_bars("\\time 3/8 c4 \\time 1/16 c4"), 16, "the shortest of them")
    assert_eq(WrittenOut.short_bars("\\time 2+1/16"), 6, "beats added up")
    assert_eq(WrittenOut.short_bars("\\time 3/4 \\time 6/8 \\time 2/4 \\time 4/4"), 1, "within the margin")
    assert_eq(WrittenOut.short_bars("{ c4 }"), 1)
  end

  test("counts a variable as often as it is used, a variable in a variable multiplied") do
    within = WrittenOut.count(wo_variables(10))
    assert_gt(within, 10 * 10 * 64 * 4)
    assert_lt(within, SCORE_MOST_WRITTEN_OUT)
    assert_gt(WrittenOut.count(wo_variables(40)), SCORE_MOST_WRITTEN_OUT)
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
    assert_gt(shipped.length, 80)
    shipped.each do |path|
      src = File.read(path)
      count = WrittenOut.count(src)
      assert_lt(count, SCORE_MOST_WRITTEN_OUT / 50, path)
      assert_null(Score.refusal_of(src), path)
      assert_null(ScoreSvg.refusal(src), path)
      laid = eui_score_layout(src, 150, {})
      assert_gt(count + 1, wo_laid_items(src), path) unless laid.has_key("error")
    end
  end

  test("never counts low what the engraver writes out") do
    [
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
    assert_eq(WrittenOut.count(plain), 476000)
    looped = "a = { c4 }\n" + plain
    assert_eq(WrittenOut.count(looped), 408002, "the runs of words counted as words")
  end
end

describe("Score and the music it writes out (#540)") do
  test("refuses to save the bomb from the editor, and writes nothing") do
    owner = wo_user()
    score = Score.start(owner, Score.blank_source("Calm"))
    base = score.revision
    started = clock()
    saved = score.save_from_editor(WO_BOMB, base, owner)
    assert_lt(clock() - started, 1.0, "refused without engraving")
    assert_eq(saved["status"], 422)
    assert_contains(saved["body"]["error"], "Not saved")
    assert_contains(saved["body"]["error"], "100,000")
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
    assert_contains(created._errors[0]["message"], "100,000")
    copied = Score.copy_of(owner._key, WO_RESTS, "Rests")
    assert_not_null(copied._errors)
    assert_eq(Score.where({"user_id": owner._key}).count, before)
  end

  test("a long score of plain music within the bound is kept") do
    owner = wo_user()
    long = "\\header { title = \"Long\" }\n{ " + "c'4 d' e' f' | " * 9000 + "}"
    assert_lt(WrittenOut.count(long), SCORE_MOST_WRITTEN_OUT)
    score = Score.start(owner, long)
    assert_null(score._errors)
    assert_eq(Score.find(score._key).title, "Long")
  end

  test("says it in French to a French editor") do
    assert_contains(SiteText.t("security_540.not_saved_too_much_music", {}, "fr"), "100 000")
    assert_contains(SiteText.t("security_540.too_much_to_engrave", {}, "fr"), "graver")
  end
end

describe("ScoreSvg and the music it writes out (#540)") do
  test("refuses to engrave a stored bomb, quickly, and says why") do
    started = clock()
    engraved = ScoreSvg.draw(WO_BOMB, 1000, 7, 0, {})
    assert_null(engraved["svg"])
    assert_contains(engraved["error"], "Too much music to engrave")
    assert_null(ScoreSvg.midi_url(WO_BOMB))
    printed = ScoreSvg.pdf(WO_RESTS, "Rests")
    assert_null(printed["file"])
    assert_contains(printed["error"], "Too much music")
    assert_contains(ScoreSvg.preview(WO_BOMB), "width=\"1\"")
    assert_lt(clock() - started, 1.5, "nothing engraved")
    assert_contains(ScoreMcp.engraver_refusal(WO_BOMB), "Too much music")
    assert_contains(AiClient.problem(WO_BOMB), "Too much music")
  end

  test("prints a PDF once, then reads it back") do
    src = "\\header { title = \"Kept #{uuid_v4}\" }\n{ c'4 d' e' f' }"
    first = ScoreSvg.pdf(src, "Kept")
    assert(first["file"].starts_with?("%PDF"))
    assert_null(first["error"])
    digest = ScoreSvg.file_digest("pdf", "Kept", src)
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
end
