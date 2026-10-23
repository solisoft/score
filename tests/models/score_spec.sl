# The library's Score: its title lives in its source; the trash keeps it a
# while; each owner sees their own.

def score_owner
  user = User.new()
  user.email = "owner-#{uuid_v4}@example.com"
  user.set_password("correct horse battery")
  user.save
  user
end

# A score of `owner`'s, in the trash longer than SCORE_TRASH_DAYS.
def trashed_long_ago(owner, title)
  score = Score.start(owner, Score.blank_source(title))
  score.move_to_trash
  stale = Score.find(score._key)
  stale.trashed_at = DateTime.utc.to_unix - (SCORE_TRASH_DAYS + 1) * 86400
  stale.save
  stale
end

# A version, a share and an AI suggestion hanging off `score`.
def hang_off(score)
  ScoreVersion.keep(score, score.source, "manual")
  ScoreShare.invite(score, "friend-#{uuid_v4}@example.com", "read")
  ScoreSuggestion.create({
    "user_id": score.user_id,
    "score_id": score._key,
    "action": "improve",
    "request": "",
    "original": score.source,
    "state": "done",
    "created_at": DateTime.utc.to_unix
  })
end

# How many [versions, shares, suggestions] `score` still has.
def remains_of(score)
  [ScoreVersion, ScoreShare, ScoreSuggestion].map do |model|
    model.where({"score_id": score._key}).count
  end
end

describe("Score") do
  describe("its title") do
    test("is read from the source's header") do
      assert_eq(Score.title_in("\\header { title = \"Ode\" composer = \"B\" }\n{ c'4 }"), "Ode")
      assert_eq(Score.title_in("\\header {\n  composer = \"B\"\n  title = \"Late\"\n}"), "Late")
      assert_null(Score.title_in("{ c'4 }"))
      assert_null(Score.title_in("\\header { title = \"  \" }"))
    end

    test("is written into the header, or a header of its own") do
      assert_eq(
        Score.with_title("\\header { title = \"Old\" }\n{ c'4 }", "New"),
        "\\header { title = \"New\" }\n{ c'4 }"
      )
      assert_eq(Score.title_in(Score.with_title("\\header { composer = \"B\" }\n{ c'4 }", "Given")), "Given")
      assert_eq(Score.with_title("{ c'4 }", "Fresh"), "\\header { title = \"Fresh\" }\n{ c'4 }")
    end

    test("leaves out what would end the LilyPond string, and is never empty") do
      assert_eq(Score.title_in(Score.with_title("{ c'4 }", "A \"quoted\\\" title")), "A quoted title")
      assert_eq(Score.title_in(Score.with_title("{ c'4 }", "   ")), SCORE_UNTITLED)
    end

    test("follows the source on every save") do
      score = Score.start(score_owner(), Score.blank_source("First"))
      assert_eq(score.title, "First")
      score.rename("Second")
      stored = Score.find(score._key)
      assert_eq(stored.title, "Second")
      assert_eq(Score.title_in(stored.source), "Second")
      assert_gt(stored.revision, 1)
    end
  end

  test("refuses a score with no owner or no source") do
    nobody = Score.create({"source": "{ c'4 }", "title": "x"})
    assert_eq(nobody._errors[0]["field"], "user_id")
    empty = Score.create({
      "user_id": "someone",
      "source": "",
      "title": "x"
    })
    assert_eq(empty._errors[0]["field"], "source")
  end

  describe("the library") do
    test("holds its owner's scores out of the trash, matching the search, in the order asked") do
      owner = score_owner()
      other = score_owner()
      older = Score.start(owner, Score.blank_source("Bourrée"))
      older.created_at = DateTime.utc.to_unix - 3600
      older.save
      Score.start(owner, Score.blank_source("Allemande"))
      Score.start(owner, Score.blank_source("Courante")).move_to_trash
      Score.start(other, Score.blank_source("Allemande of someone else"))
      titles = Score.library(owner, "", "title").map do |score|
        score.title
      end
      assert_eq(titles, ["Allemande", "Bourrée"])
      assert_eq(Score.library(owner, "ALLEM", "updated").map(&{ |score|
        score.title
      }), ["Allemande"])
      assert_eq(Score.library(owner, "nothing like it", "updated").length, 0)
      assert_eq(Score.library(owner, "", "created")[0].title, "Allemande")
    end
  end

  describe("the trash") do
    test("takes a score out of the library, and gives it back") do
      owner = score_owner()
      score = Score.start(owner, Score.blank_source("Gigue"))
      score.move_to_trash
      assert_eq(Score.library(owner, "", "updated").length, 0)
      assert_eq(Score.trash_of(owner).map(&{ |kept|
        kept.title
      }), ["Gigue"])
      Score.find(score._key).restore_from_trash
      assert_eq(Score.library(owner, "", "updated").length, 1)
      assert_eq(Score.trash_of(owner).length, 0)
    end

    test("lets go of what has been there more than 30 days, and only that") do
      owner = score_owner()
      old = Score.start(owner, Score.blank_source("Old"))
      old.move_to_trash
      stale = Score.find(old._key)
      stale.trashed_at = DateTime.utc.to_unix - (SCORE_TRASH_DAYS + 1) * 86400
      stale.save
      Score.start(owner, Score.blank_source("Recent")).move_to_trash
      Score.start(owner, Score.blank_source("Kept"))
      Score.purge_trash(owner)
      assert_eq(Score.trash_of(owner).map(&{ |kept|
        kept.title
      }), ["Recent"])
      assert_eq(Score.library(owner, "", "updated").length, 1)
    end
  end

  test("a copy has its own title and the same music") do
    owner = score_owner()
    score = Score.start(owner, Score.blank_source("Sarabande"))
    copy = score.duplicate
    assert_eq(copy.title, "Sarabande (copy)")
    assert_ne(copy._key, score._key)
    assert_contains(copy.source, "r1 | r1 | r1 | r1")
    assert_eq(Score.library(owner, "", "title").length, 2)
  end

  describe("erased for good") do
    test("the trash's purge takes the versions, shares and suggestions with the score, and only that score's") do
      owner = score_owner()
      old = trashed_long_ago(owner, "Old")
      kept = Score.start(owner, Score.blank_source("Kept"))
      [old, kept].each do |score|
        hang_off(score)
      end
      assert_eq(Score.purge_trash(owner), 1)
      assert_null(Score.find_by("_key", old._key))
      assert_eq(remains_of(old), [
        0,
        0,
        0
      ])
      assert_eq(remains_of(kept), [
        1,
        1,
        1
      ])
    end

    test("erase leaves nothing of the score behind") do
      score = Score.start(score_owner(), Score.blank_source("Gone"))
      hang_off(score)
      score.erase
      assert_null(Score.find_by("_key", score._key))
      assert_eq(remains_of(score), [
        0,
        0,
        0
      ])
    end

    test("the purge for everyone takes every owner's expired trash, and nothing recent") do
      first = trashed_long_ago(score_owner(), "First")
      second = trashed_long_ago(score_owner(), "Second")
      recent_owner = score_owner()
      Score.start(recent_owner, Score.blank_source("Recent")).move_to_trash
      hang_off(first)
      assert_gt(Score.purge_all_trash, 1)
      assert_null(Score.find_by("_key", first._key))
      assert_null(Score.find_by("_key", second._key))
      assert_eq(remains_of(first), [
        0,
        0,
        0
      ])
      assert_eq(Score.trash_of(recent_owner).length, 1)
    end
  end

  test("goes with its owner's account, trash and all") do
    owner = score_owner()
    Score.start(owner, Score.blank_source("One"))
    Score.start(owner, Score.blank_source("Two")).move_to_trash
    Score.delete_all_of(owner)
    assert_eq(Score.where("doc.user_id == @user", {"user": owner._key}).all.length, 0)
  end
end
