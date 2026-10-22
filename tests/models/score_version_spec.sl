# Saving from the editor, and the history it leaves.

def history_owner
  user = User.new()
  user.email = "history-#{uuid_v4}@example.com"
  user.set_password("correct horse battery")
  user.save
  user
end

describe("Score#save_from_editor") do
  test("saves over the revision it was given, and answers the next one") do
    score = Score.start(history_owner(), Score.blank_source("Air"))
    source = Score.with_title("{ c'4 d' e' f' }", "Air on a string")
    saved = score.save_from_editor(source, score.revision)
    assert_eq(saved["status"], 200)
    stored = Score.find(score._key)
    assert_eq(stored.source, source)
    assert_eq(stored.title, "Air on a string")
    assert_eq(saved["body"]["revision"], stored.revision)
  end

  test("refuses to overwrite a score saved elsewhere since, and keeps what it refused") do
    score = Score.start(history_owner(), Score.blank_source("Canon"))
    opened_at = score.revision
    score.save_from_editor(Score.with_title("{ c'1 }", "Canon"), opened_at)
    refused = Score.find(score._key).save_from_editor(Score.with_title("{ g'1 }", "Canon"), opened_at)
    assert_eq(refused["status"], 409)
    assert_contains(refused["body"]["source"], "c'1")
    stored = Score.find(score._key)
    assert_contains(stored.source, "c'1")
    kept = ScoreVersion.history(stored).filter do |version|
      version.reason == "conflict"
    end
    assert_eq(kept.length, 1)
    assert_contains(kept[0].source, "g'1")
  end

  test("refuses an empty score") do
    score = Score.start(history_owner(), Score.blank_source("Rondo"))
    refused = score.save_from_editor("   ", score.revision)
    assert_eq(refused["status"], 422)
    assert_contains(Score.find(score._key).source, "r1")
  end

  test("keeps a version on the way, not at every save") do
    score = Score.start(history_owner(), Score.blank_source("Fugue"))
    score.save_from_editor(Score.with_title("{ c'1 }", "Fugue"), score.revision)
    current = Score.find(score._key)
    current.save_from_editor(Score.with_title("{ d'1 }", "Fugue"), current.revision)
    assert_eq(ScoreVersion.history(current).length, 1)
    assert_contains(ScoreVersion.history(current)[0].source, "r1")
    aged = ScoreVersion.history(current)[0]
    aged.created_at = DateTime.utc.to_unix - SCORE_VERSION_EVERY - 1
    aged.save
    later = Score.find(score._key)
    later.save_from_editor(Score.with_title("{ e'1 }", "Fugue"), later.revision)
    assert_eq(ScoreVersion.history(later).length, 2)
    assert_contains(ScoreVersion.history(later)[0].source, "d'1")
  end

  test("restoring a version keeps what the score was just before") do
    score = Score.start(history_owner(), Score.blank_source("Toccata"))
    first = ScoreVersion.keep(score, score.source, "manual")
    score.save_from_editor(Score.with_title("{ a'1 }", "Toccata"), score.revision)
    current = Score.find(score._key)
    current.restore_version(first)
    assert_contains(Score.find(score._key).source, "r1")
    before = ScoreVersion.history(current).filter do |version|
      version.reason == "restore"
    end
    assert_contains(before[0].source, "a'1")
  end

  test("a version needs a known reason") do
    score = Score.start(history_owner(), Score.blank_source("Suite"))
    odd = ScoreVersion.keep(score, score.source, "whim")
    assert_eq(odd._errors[0]["field"], "reason")
  end
end
