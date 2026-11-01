# The engraver's own limits (#540): music past them is refused as the
# engraver reads it — in milliseconds — wherever it comes from, said in the
# app's language, and what the site ships stays within them.

# 80 characters that write out to 262,144 notes.
const EL_BOMB = "{ \\repeat unfold 64 { \\repeat unfold 64 { \\repeat unfold 16 { c4 d e f } } } }"
# 14 characters of rest that write out to a million bars.
const EL_RESTS = "{ R1*1000000 }"
const EL_PASSWORD = "correct horse battery"
const EL_CATEGORIES = [
  "changelog",
  "drums",
  "ensembles",
  "guitar",
  "piano",
  "solos",
  "syntax",
  "voice"
]
# The bombs of the reviews (tests/fixtures/bombs), with the limit each
# passes: trills on every note, a key change in every bar, ledger lines a
# hundred commas deep, Scheme two thousand brackets deep, voices `\with`
# nested in repeats, a variable of a variable (`a'`) six deep.
const EL_FIXTURES = [
  ["trills", "notes"],
  ["keys", "notes"],
  ["ledgers", "pitch"],
  ["scheme", "nesting"],
  ["voices", "notes"],
  ["variables", "notes"]
]

def el_user
  user = User.new()
  user.email = "engraver-limit-#{uuid_v4}@example.com"
  user.set_password(EL_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

def el_bomb(name)
  File.read("tests/fixtures/bombs/#{name}.ly")
end

# Every source the site ships: the gallery, the syntax page, the changelog.
def el_shipped
  EL_CATEGORIES.map do |category|
    File.glob("scores/#{category}/*.ly")
  end.flatten
end

# The library's own sections (db/data/house_sections.json), each a source.
def el_house_sections
  JSON.parse(File.read("db/data/house_sections.json")).map do |seed|
    seed["source"].to_s
  end
end

describe("EngraverLimit") do
  test("the engraver refuses every bomb of the reviews as it reads it, in milliseconds") do
    EL_FIXTURES.each do |fixture|
      started = clock()
      refused = EngraverLimit.of(el_bomb(fixture[0]))
      assert_lt(clock() - started, 1.0, fixture[0])
      assert_not_null(refused, fixture[0])
      assert(refused.starts_with?("score: "), "the engraver's own words: #{refused}")
      assert_eq(EngraverLimit.kind_of(refused), fixture[1], fixture[0])
    end
    assert_contains(EngraverLimit.of(EL_BOMB), "more than 20,000 notes")
    assert_eq(EngraverLimit.kind_of(EngraverLimit.of(EL_RESTS)), "notes", "rest bars counted")
  end

  test("a source the engraver refuses for another reason is not one of its limits") do
    assert_null(EngraverLimit.of("{ c'4 \\shiver }"), "a command it does not know: still saved, as a draft")
    assert_null(EngraverLimit.of("{ c'4 d' e' f' }"))
    assert_null(EngraverLimit.of(""))
    assert_null(EngraverLimit.of(nil))
    assert_null(EngraverLimit.kind_of("score: \\shiver is not a command this reads (at character 6)"))
    assert_null(EngraverLimit.kind_of(nil))
  end

  test("knows each of the engraver's limits by what it says") do
    [
      ["score: this music writes out to more than 20,000 notes; the engraver stops there (at character 2)", "notes"],
      ["score: the variables write out to more music than this engraves (at character 9)", "music"],
      ["score: the repeat writes out to more music than this engraves (at character 9)", "music"],
      ["score: the source is longer than this engraves (at character 800000)", "length"],
      [
        "score: this music writes out to more than 40,000 characters of words; the engraver stops there "
        + "(at character 2)",
        "words"
      ],
      ["score: this music draws more than 400,000 shapes; the engraver stops there (at character 0)", "drawn"],
      [
        "score: this music draws more than 6,000,000 points of outline; the engraver stops there (at character 0)",
        "drawn"
      ],
      [
        "score: the music nests too deep — blocks, repeats or commands inside one another; "
        + "the engraver stops there (at character 3)",
        "nesting"
      ],
      ["score: '(' inside '(' more than 64 deep: the engraver stops there (at character 94)", "nesting"],
      ["score: a note beyond the keys of any instrument (C-1 to G9) is not drawn (at character 42)", "pitch"]
    ].each do |said|
      assert_eq(EngraverLimit.kind_of(said[0]), said[1], said[0])
      assert(EngraverLimit.limit?(said[0]))
    end
  end

  test("says a limit in the app's language, with where the source passes it; any other refusal as it is") do
    notes = "score: this music writes out to more than 20,000 notes; the engraver stops there (at character 2)"
    assert_eq(EngraverLimit.said(notes), SiteText.t("security_540.limits.notes") + " (at character 2)")
    assert_contains(EngraverLimit.said(notes), "20,000 notes")
    drawn = "score: this music draws more than 400,000 shapes; the engraver stops there (at character 0)"
    assert_eq(
      EngraverLimit.said(drawn),
      SiteText.t("security_540.limits.drawn"),
      "no place in the source to point to"
    )
    other = "score: \\shiver is not a command this reads (at character 6)"
    assert_eq(EngraverLimit.said(other), other)
    assert_null(EngraverLimit.said(nil))
    I18n.set_locale("fr")
    french = EngraverLimit.said(notes)
    I18n.set_locale("en")
    assert_contains(french, "20 000 notes")
    assert_contains(french, "(au caractère 2)")
  end

  test("every piece the site ships, and every section of the library's own, stays within the limits") do
    shipped = el_shipped()
    assert_eq(shipped.length, 90)
    shipped.each do |path|
      src = File.read(path)
      assert_null(EngraverLimit.of(src), path)
      assert_null(Score.refusal_of(src), path)
    end
    sections = el_house_sections()
    assert_gt(sections.length, 300)
    sections.each do |src|
      assert_null(EngraverLimit.of(src), src.substring(0, 60))
    end
  end
end

describe("Score and the engraver's limits (#540)") do
  test("refuses to save the bomb from the editor, says why, and writes nothing") do
    owner = el_user()
    score = Score.start(owner, Score.blank_source("Calm"))
    base = score.revision
    saved = score.save_from_editor(EL_BOMB, base, owner)
    assert_eq(saved["status"], 422)
    assert_eq(
      saved["body"]["error"],
      SiteText.t("security_540.not_saved", {"why": SiteText.t("security_540.limits.notes")
      + " (at character 2)"})
    )
    assert_eq(saved["body"]["revision"], base)
    rests = score.save_from_editor(EL_RESTS, base, owner)
    assert_eq(rests["status"], 422)
    pitch = score.save_from_editor(el_bomb("ledgers"), base, owner)
    assert_contains(pitch["body"]["error"], "C-1 to G9")
    stored = Score.find(score._key)
    assert_eq(stored.revision, base)
    assert_contains(stored.source, "r1")
    assert_eq(ScoreVersion.where({"score_id": score._key}).count, 0, "no version kept of it")
    draft = score.save_from_editor("\\header { title = \"Draft\" }\n{ c'4 \\shiver }", base, owner)
    assert_eq(draft["status"], 200, "a draft the engraver does not read yet is saved")
  end

  test("refuses to create one, whatever makes it: nothing stored") do
    owner = el_user()
    before = Score.where({"user_id": owner._key}).count
    created = Score.start(owner, EL_BOMB)
    assert_not_null(created._errors)
    assert_eq(created._errors[0]["field"], "source")
    assert_contains(created._errors[0]["message"], SiteText.t("security_540.limits.notes"))
    copied = Score.copy_of(owner._key, EL_RESTS, "Rests")
    assert_not_null(copied._errors)
    EL_FIXTURES.each do |fixture|
      assert_not_null(Score.start(owner, el_bomb(fixture[0]))._errors, fixture[0])
    end
    assert_eq(Score.where({"user_id": owner._key}).count, before)
  end

  test("a long score of plain music within the limits is kept") do
    owner = el_user()
    long = "\\header { title = \"Long\" }\n{ " + "c'4 d' e' f' | " * 3000 + "}"
    assert_null(EngraverLimit.of(long))
    score = Score.start(owner, long)
    assert_null(score._errors)
    assert_eq(Score.find(score._key).title, "Long")
  end

  test("a score stored past the limits can still be renamed, shared, trashed and restored") do
    owner = el_user()
    score = Score.start(owner, Score.blank_source("Stuck"))
    Score.where("doc._key == @key", {"key": score._key}).update_all({"source": "\\header { title = \"Stuck\" }\n"
    + EL_BOMB})
    stored = Score.find(score._key)
    assert(stored.make_visible("link"), "made visible")
    assert(stored.new_link, "a new link")
    assert(stored.move_to_trash, "trashed")
    assert(stored.restore_from_trash, "restored")
    assert(stored.rename("Unstuck"), "renamed")
    again = Score.find(score._key)
    assert_eq(again.title, "Unstuck")
    assert_eq(again.visibility, "link")
    assert_null(again.trashed_at)
    assert_contains(again.source, EL_BOMB)
  end

  test("a version past the limits is not restored, and nothing is kept") do
    owner = el_user()
    score = Score.start(owner, Score.blank_source("Versions"))
    bomb = ScoreVersion.keep(score, EL_BOMB, "manual", owner._key)
    calm = ScoreVersion.keep(score, Score.blank_source("Calm again"), "manual", owner._key)
    before = ScoreVersion.where({"score_id": score._key}).count
    assert_not(score.restore_version(bomb, owner))
    assert_eq(ScoreVersion.where({"score_id": score._key}).count, before, "the score as it stands not kept again")
    assert_not(Score.find(score._key).source.contains("unfold"))
    assert_contains(Score.restore_refusal(bomb), SiteText.t("security_540.limits.notes"))
    assert(score.restore_version(calm, owner))
    assert_eq(Score.find(score._key).title, "Calm again")
  end

  test("says it in French to a French editor") do
    I18n.set_locale("fr")
    refused = Score.refusal_of(EL_BOMB)
    I18n.set_locale("en")
    assert(refused.starts_with?("Non enregistrée : "), refused)
    assert_contains(refused, "20 000 notes")
  end
end

describe("ScoreSvg and the engraver's limits (#540)") do
  test("a stored bomb is refused as the engraver reads it, in milliseconds, and said in the app's language") do
    said = SiteText.t("security_540.limits.notes") + " (at character 2)"
    started = clock()
    engraved = ScoreSvg.draw(EL_BOMB, 1000, 7, 0, {})
    assert_lt(clock() - started, 1.0)
    assert_null(engraved["svg"])
    assert_contains(engraved["error"], "the engraver stops there", "drawn: the engraver's own words")
    assert_eq(ScoreSvg.engrave(EL_BOMB, 1000, 7, 0, {})["error"], said)
    assert_contains(
      Engraving.find(ScoreSvg.digest(EL_BOMB, 1000, 7, 0, {})).error,
      "the engraver stops there",
      "kept in its words, said in either language"
    )
    assert_eq(ScoreSvg.engrave(EL_BOMB, 1000, 7, 0, {})["error"], said, "read back, said again")
    assert_null(ScoreSvg.midi_url(EL_BOMB))
    assert_eq(ScoreSvg.midi(EL_BOMB, 100)["error"], said)
    printed = ScoreSvg.pdf(EL_RESTS, "Rests")
    assert_null(printed["file"])
    assert_eq(printed["error"], SiteText.t("security_540.limits.notes") + " (at character 4)")
    assert_contains(ScoreSvg.preview(EL_BOMB), "width=\"1\"")
    assert_contains(AiClient.problem(EL_BOMB), "more than 20,000 notes", "the AI is told in the engraver's words")
    assert_contains(ScoreSvg.check(EL_BOMB)["error"], "more than 20,000 notes", "the MCP tools too")
  end

  test("the engraver's words out of what Soli raises") do
    message = "score: this music draws more than 400,000 shapes; the engraver stops there (at character 0)"
    assert_eq(ScoreSvg.engraver_message("#{message} at app/services/score_svg.sl:80", "otherwise"), message)
    assert_eq(ScoreSvg.engraver_message("something else", "otherwise"), "otherwise")
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
    user = el_user()
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
    user = el_user()
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
