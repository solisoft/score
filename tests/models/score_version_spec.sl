# Saving from the editor, and the history it leaves.

def history_owner
  user = User.new()
  user.email = "history-#{uuid_v4}@example.com"
  user.set_password("correct horse battery")
  user.save
  user
end

# A version of `score` kept `age` seconds ago.
def aged_version(score, age)
  ScoreVersion.create({
    "score_id": score._key,
    "user_id": score.user_id,
    "source": score.source,
    "title": score.title,
    "revision": score.revision,
    "reason": "auto",
    "created_at": DateTime.utc.to_unix - age
  })
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
    assert_contains(ScoreVersion.find(kept[0]._key).source, "g'1")
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
    assert_contains(ScoreVersion.find(ScoreVersion.history(current)[0]._key).source, "r1")
    aged = ScoreVersion.find(ScoreVersion.history(current)[0]._key)
    aged.created_at = DateTime.utc.to_unix - SCORE_VERSION_EVERY - 1
    aged.save
    later = Score.find(score._key)
    later.save_from_editor(Score.with_title("{ e'1 }", "Fugue"), later.revision)
    assert_eq(ScoreVersion.history(later).length, 2)
    assert_contains(ScoreVersion.find(ScoreVersion.history(later)[0]._key).source, "d'1")
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
    assert_contains(ScoreVersion.find(before[0]._key).source, "a'1")
  end

  test("keeps the latest SCORE_VERSIONS_KEPT, and lets the oldest go") do
    score = Score.start(history_owner(), Score.blank_source("Partita"))
    oldest = []
    (0 .. SCORE_VERSIONS_KEPT + 2).each do |i|
      version = aged_version(score, SCORE_VERSIONS_KEPT + 10 - i)
      oldest.push(version._key) if i < 3
    end
    ScoreVersion.keep(score, score.source, "manual")
    assert_eq(ScoreVersion.of(score).count, SCORE_VERSIONS_KEPT)
    oldest.each do |key|
      assert_null(ScoreVersion.find_by("_key", key))
    end
  end

  test("lets none go while there are no more than SCORE_VERSIONS_KEPT") do
    score = Score.start(history_owner(), Score.blank_source("Chaconne"))
    (0 .. SCORE_VERSIONS_KEPT - 1).each do |i|
      aged_version(score, SCORE_VERSIONS_KEPT - i)
    end
    ScoreVersion.keep(score, score.source, "manual")
    assert_eq(ScoreVersion.of(score).count, SCORE_VERSIONS_KEPT)
  end

  test("lists the history without the sources, the latest first") do
    score = Score.start(history_owner(), Score.blank_source("Bourrée"))
    aged_version(score, 100)
    ScoreVersion.keep(score, score.source, "manual")
    listed = ScoreVersion.history(score)
    assert_eq(listed.map(&:reason), ["manual", "auto"])
    assert_eq(listed[0].title, "Bourrée")
    assert_null(listed[0].source)
    assert_contains(ScoreVersion.find(listed[0]._key).source, "r1")
    assert_eq(ScoreVersion.history(Score.start(history_owner(), Score.blank_source("None"))).length, 0)
  end

  test("a version needs a known reason") do
    score = Score.start(history_owner(), Score.blank_source("Suite"))
    odd = ScoreVersion.keep(score, score.source, "whim")
    assert_eq(odd._errors[0]["field"], "reason")
  end
end

describe("ScoreVersion, who saved it") do
  test("auto, manual, restore and conflict versions each name who saved them") do
    owner = history_owner()
    friend = history_owner()
    score = Score.start(owner, Score.blank_source("Duet"))
    assert_eq(score.saved_by, owner._key)
    opened_at = score.revision
    # The first save keeps the score as it stood: the owner's work.
    score.save_from_editor(Score.with_title("{ c'1 }", "Duet"), opened_at, friend)
    current = Score.find(score._key)
    assert_eq(current.saved_by, friend._key)
    auto = ScoreVersion.history(current).filter do |version|
      version.reason == "auto"
    end
    assert_eq(auto.map(&:author_id), [owner._key])
    # A stale save by the owner: refused, the text kept as theirs, the
    # answer naming who saved last.
    refused = Score.find(score._key).save_from_editor(Score.with_title("{ g'1 }", "Duet"), opened_at, owner)
    assert_eq(refused["status"], 409)
    assert_eq(refused["body"]["saved_by"], friend.email)
    conflict = ScoreVersion.history(current).filter do |version|
      version.reason == "conflict"
    end
    assert_eq(conflict.map(&:author_id), [owner._key])
    manual = ScoreVersion.keep(current, current.source, "manual", owner._key)
    assert_eq(manual.author_id, owner._key)
    Score.find(score._key).restore_version(manual, owner)
    restored = Score.find(score._key)
    assert_eq(restored.saved_by, owner._key)
    before_restore = ScoreVersion.history(restored).filter do |version|
      version.reason == "restore"
    end
    assert_eq(before_restore.map(&:author_id), [friend._key])
    names = ScoreVersion.authors_of(ScoreVersion.history(restored))
    assert_eq(names[owner._key], owner.email)
    assert_eq(names[friend._key], friend.email)
  end

  test("a stale save from another window of the same person names nobody") do
    owner = history_owner()
    score = Score.start(owner, Score.blank_source("Solo"))
    opened_at = score.revision
    score.save_from_editor(Score.with_title("{ c'1 }", "Solo"), opened_at, owner)
    refused = Score.find(score._key).save_from_editor(Score.with_title("{ d'1 }", "Solo"), opened_at, owner)
    assert_eq(refused["status"], 409)
    assert_null(refused["body"]["saved_by"])
  end

  test("a version kept before authors were recorded names nobody") do
    score = Score.start(history_owner(), Score.blank_source("Old"))
    aged_version(score, 10)
    versions = ScoreVersion.history(score)
    assert_null(versions[0].author_id)
    assert_eq(ScoreVersion.authors_of(versions), {})
    assert_eq(User.names_of(["no-such-user"]), {})
  end
end
