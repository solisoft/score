# The nightly clean-up: the expired trash of everyone, and the AI jobs a
# restart cut off.

def cleanup_owner
  user = User.new()
  user.email = "cleanup-#{uuid_v4}@example.com"
  user.set_password("correct horse battery")
  user.save
  user
end

# A reading of `user`'s, still "reading", started `age` seconds ago (made
# here, without its job, as a restart leaves it).
def reading_started(user, age)
  ScoreReading.create({
    "user_id": user._key,
    "state": "reading",
    "picture": "base64-jpeg",
    "created_at": DateTime.utc.to_unix - age
  })
end

def suggestion_started(user, score, age)
  ScoreSuggestion.create({
    "user_id": user._key,
    "score_id": score._key,
    "action": "ask",
    "request": "Add a coda",
    "original": score.source,
    "state": "working",
    "created_at": DateTime.utc.to_unix - age
  })
end

describe("DataCleanupJob") do
  test("runs every day") do
    assert_eq(DataCleanupJob.cron, Cron.daily_at("03:30"))
  end

  test("purges the trash of an owner who never opens the library, versions and shares included") do
    owner = cleanup_owner()
    score = Score.start(owner, Score.blank_source("Forgotten"))
    ScoreVersion.keep(score, score.source, "manual")
    ScoreShare.invite(score, "friend-#{uuid_v4}@example.com", "write")
    score.move_to_trash
    stale = Score.find(score._key)
    stale.trashed_at = DateTime.utc.to_unix - (SCORE_TRASH_DAYS + 1) * 86400
    stale.save
    recent = Score.start(owner, Score.blank_source("Just trashed"))
    recent.move_to_trash
    done = DataCleanupJob.perform_now({})
    assert_gt(done["scores"], 0)
    assert_null(Score.find_by("_key", score._key))
    assert_eq(ScoreVersion.where({"score_id": score._key}).count, 0)
    assert_eq(ScoreShare.where({"score_id": score._key}).count, 0)
    assert(Score.find(recent._key).trashed?, "a score trashed today stays")
  end

  test("fails a reading stuck past ten minutes, its photo kept to read again, and leaves a recent one alone") do
    user = cleanup_owner()
    stuck = reading_started(user, SCORE_AI_STUCK_SECONDS + 60)
    fresh = reading_started(user, 60)
    done = DataCleanupJob.perform_now({})
    assert_gt(done["readings"], 0)
    failed = ScoreReading.find(stuck._key)
    assert_eq(failed.state, "failed")
    assert_eq(failed.picture, "base64-jpeg", "kept for Read it again; let go after a week (#465)")
    assert_contains(failed.error, "interrupted")
    assert_not_null(failed.finished_at)
    untouched = ScoreReading.find(fresh._key)
    assert_eq(untouched.state, "reading")
    assert_eq(untouched.picture, "base64-jpeg")
  end

  test("a reading still streaming its answer is not stuck, however long ago it started (#435)") do
    user = cleanup_owner()
    streaming = reading_started(user, SCORE_AI_STUCK_SECONDS * 3)
    streaming.progressed_at = DateTime.utc.to_unix - 30
    streaming.save
    silent = reading_started(user, SCORE_AI_STUCK_SECONDS * 3)
    silent.progressed_at = DateTime.utc.to_unix - SCORE_AI_STUCK_SECONDS - 60
    silent.save
    DataCleanupJob.perform_now({})
    assert_eq(ScoreReading.find(streaming._key).state, "reading")
    assert_eq(ScoreReading.find(silent._key).state, "failed", "no news for ten minutes")
  end

  test("fails a suggestion stuck past ten minutes and lets its text go, and leaves a recent one alone") do
    user = cleanup_owner()
    score = Score.start(user, Score.blank_source("Asked"))
    stuck = suggestion_started(user, score, SCORE_AI_STUCK_SECONDS + 60)
    fresh = suggestion_started(user, score, 60)
    done = DataCleanupJob.perform_now({})
    assert_gt(done["suggestions"], 0)
    failed = ScoreSuggestion.find(stuck._key)
    assert_eq(failed.state, "failed")
    assert_null(failed.original)
    assert_null(failed.request)
    assert_contains(failed.error, "interrupted")
    untouched = ScoreSuggestion.find(fresh._key)
    assert_eq(untouched.state, "working")
    assert_eq(untouched.request, "Add a coda")
  end

  test("lets the engravings past their days go, and keeps a recent one") do
    old_digest = Crypto.sha256("old-#{uuid_v4}")
    Engraving.upsert(
      old_digest,
      {
        "svg": "<svg/>",
        "error": nil,
        "created_at": DateTime.utc.to_unix - ENGRAVING_DAYS * 86400 - 60
      }
    )
    recent_digest = Crypto.sha256("recent-#{uuid_v4}")
    Engraving.upsert(
      recent_digest,
      {
        "svg": "<svg/>",
        "error": nil,
        "created_at": DateTime.utc.to_unix
      }
    )
    done = DataCleanupJob.perform_now({})
    assert_gt(done["engravings"], 0)
    assert_null(Engraving.find_by("_key", old_digest))
    assert_not_null(Engraving.find_by("_key", recent_digest))
  end

  test("leaves finished readings as they are") do
    user = cleanup_owner()
    finished = reading_started(user, SCORE_AI_STUCK_SECONDS * 10)
    finished.state = "done"
    finished.picture = nil
    finished.source = "{ c'1 }"
    finished.save
    DataCleanupJob.perform_now({})
    kept = ScoreReading.find(finished._key)
    assert_eq(kept.state, "done")
    assert_eq(kept.source, "{ c'1 }")
  end
end
