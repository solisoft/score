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

    test("is one line (#687): no line break, tab or control character reaches a mail's subject") do
      spam = "\\header { title = \"Buy\nnow\r\n\r\nBcc: x@example.com\t at\u0007once \" }\n{ c'4 }"
      assert_eq(Score.title_in(spam), "Buy now Bcc: x@example.com at once")
      assert_eq(Score.composer_in("\\header { composer = \"J.\n S.\n\nBach\" }"), "J. S. Bach")
      assert_null(Score.title_in("\\header { title = \"\n\r\t\" }"), "nothing but breaks: no title")
      assert_eq(Score.one_line(nil), "")
      assert_eq(Score.one_line("Ode à la joie — 2"), "Ode à la joie — 2", "the rest untouched")
      user = User.new()
      user.email = "one-line-#{uuid_v4}@example.com"
      user.set_password("correct horse battery")
      user.save
      score = Score.start(user, spam)
      assert_eq(Score.find(score._key).title, "Buy now Bcc: x@example.com at once", "as kept")
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

    test("names its files: letters and digits, accents kept, nothing that ends a header or names a folder") do
      score = Score.new()
      score.title = "Für \"Elise\" / op. 59; né\r\nX"
      assert_eq(score.file_name, "für-elise-op-59-né-x")
      disposition = score.content_disposition("inline", "pdf")
      assert_eq(
        disposition,
        "inline; filename=\"f-r-elise-op-59-n-x.pdf\"; filename*=UTF-8''f%C3%BCr-elise-op-59-n%C3%A9-x.pdf"
      )
      score.title = " /// "
      assert_eq(score.file_name, "score", "nothing left: score")
      assert_eq(
        score.content_disposition("attachment", "mid"),
        "attachment; filename=\"score.mid\"; filename*=UTF-8''score.mid"
      )
      score.title = "Élégie"
      assert_contains(score.content_disposition("inline", "pdf"), "filename=\"l-gie.pdf\"")
      score.title = "ü"
      assert_contains(
        score.content_disposition("inline", "pdf"),
        "filename=\"score.pdf\"; filename*=UTF-8''%C3%BC.pdf"
      )
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
      # A list reads no source.
      assert_null(Score.library(owner, "", "title")[0].source)
      assert_null(Score.recent(owner, 1)[0].source)
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

    test("is its owner's alone: those it is shared with lose it until it comes back (#542)") do
      owner = score_owner()
      reader = score_owner()
      writer = score_owner()
      score = Score.start(owner, Score.blank_source("Bourrée"))
      ScoreShare.invite(score, reader.email, "read")
      ScoreShare.invite(score, writer.email, "write")
      score.move_to_trash
      trashed = Score.find(score._key)
      assert_null(trashed.access_of(reader))
      assert_null(trashed.access_of(writer))
      assert_not(ScorePolicy.new({
        "user": reader,
        "record": trashed
      }).show?, "a reader may not open it")
      assert_not(ScorePolicy.new({
        "user": writer,
        "record": trashed
      }).show?, "nor a writer")
      assert_not(trashed.writable_by?(writer))
      # Its owner still sees it, to take it out; changing it waits until then.
      assert_eq(trashed.access_of(owner), "owner")
      assert(ScorePolicy.new({"user": owner, "record": trashed}).show?)
      assert(ScorePolicy.new({"user": owner, "record": trashed}).destroy?)
      assert_not(trashed.writable_by?(owner))
      # The shares stayed: taken out of the trash, the score is theirs again.
      trashed.restore_from_trash
      restored = Score.find(score._key)
      assert_eq(restored.access_of(reader), "read")
      assert_eq(restored.access_of(writer), "write")
      assert(restored.writable_by?(writer))
    end

    test("no longer shows what has been there more than 30 days, nor counts it") do
      owner = score_owner()
      old = trashed_long_ago(owner, "Old")
      Score.start(owner, Score.blank_source("Recent")).move_to_trash
      Score.start(owner, Score.blank_source("Kept"))
      assert_eq(Score.trash_of(owner).map(&{ |kept|
        kept.title
      }), ["Recent"])
      assert_eq(Score.trash_count(owner), 1)
      assert_eq(Score.library(owner, "", "updated").length, 1)
      # Not erased on the way: the nightly purge does that.
      assert_not_null(Score.find_by("_key", old._key))
    end

    test("lists and counts by the database, without the sources") do
      owner = score_owner()
      Score.start(owner, Score.blank_source("Light")).move_to_trash
      listed = Score.trash_of(owner)[0]
      assert_eq(listed.title, "Light")
      assert_not_null(listed.trashed_at)
      assert_null(listed.source)
      assert_eq(Score.library(score_owner(), "", "updated").length, 0)
      assert_eq(Score.trash_count(score_owner()), 0)
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
      assert_gt(Score.purge_all_trash, 0)
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

  describe("the editor's save") do
    test("of two saves over the same revision, one is written and the other is a conflict, kept") do
      owner = score_owner()
      score = Score.start(owner, Score.blank_source("Duet"))
      base = score.revision
      first_tab = Score.find(score._key)
      second_tab = Score.find(score._key)
      first = first_tab.save_from_editor("\\header { title = \"Duet\" }\n{ c'1 }", base)
      second = second_tab.save_from_editor("\\header { title = \"Duet\" }\n{ d'1 }", base)
      assert_eq(first["status"], 200)
      assert_eq(first["body"]["revision"], base + 1)
      assert_eq(second["status"], 409)
      assert_eq(second["body"]["revision"], base + 1)
      assert_contains(second["body"]["source"], "c'1")
      stored = Score.find(score._key)
      assert_eq(stored.revision, base + 1)
      assert_contains(stored.source, "c'1")
      conflicts = ScoreVersion.history(score).filter do |version|
        version.reason == "conflict"
      end
      assert_eq(conflicts.length, 1)
      assert_contains(ScoreVersion.find(conflicts[0]._key).source, "d'1")
    end

    test("sets what a save sets: the title from the source, the time, the next revision") do
      owner = score_owner()
      score = Score.start(owner, Score.blank_source("Before"))
      saved = score.save_from_editor("\\header { title = \"After\" }\n{ e'1 }", score.revision)
      stored = Score.find(score._key)
      assert_eq(saved["status"], 200)
      assert_eq(stored.title, "After")
      assert_eq(saved["body"]["title"], "After")
      assert_eq(stored.updated_at, saved["body"]["updated_at"])
      assert_eq(stored.visibility, "private")
      assert_eq(stored.share_token, score.share_token)
      assert_eq(stored.created_at, score.created_at)
    end

    test("refuses a source or a title too long, and writes nothing") do
      owner = score_owner()
      score = Score.start(owner, Score.blank_source("Long"))
      base = score.revision
      too_long = score.save_from_editor("{ c'1 }" + "x" * 1000000, base)
      assert_eq(too_long["status"], 422)
      assert_eq(too_long["body"]["error"], "Not saved: the score is too long to keep (a million characters at most).")
      titled = score.save_from_editor("\\header { title = \"#{"t" * 201}\" }\n{ c'1 }", base)
      assert_eq(titled["status"], 422)
      assert_eq(titled["body"]["error"], "Not saved: the title is too long (200 characters at most).")
      empty = score.save_from_editor("  ", base)
      assert_eq(empty["status"], 422)
      assert_eq(empty["body"]["error"], "Not saved: the score is empty.")
      stored = Score.find(score._key)
      assert_eq(stored.revision, base)
      assert_contains(stored.source, "r1")
      assert_eq(stored.title, "Long")
    end

    test("a title at the limit is saved") do
      owner = score_owner()
      score = Score.start(owner, Score.blank_source("Short"))
      title = "t" * 200
      saved = score.save_from_editor("\\header { title = \"#{title}\" }\n{ c'1 }", score.revision)
      assert_eq(saved["status"], 200)
      assert_eq(Score.find(score._key).title, title)
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

describe("Score, its composer and its pages") do
  test("the composer is read from the header, and kept at every save") do
    assert_eq(Score.composer_in("\\header { title = \"Ode\" composer = \"Beethoven\" }\n{ c'4 }"), "Beethoven")
    assert_null(Score.composer_in("\\header { title = \"Ode\" }\n{ c'4 }"))
    assert_null(Score.composer_in("\\header { composer = \" \" }"))
    owner = score_owner()
    score = Score.start(owner, "\\header { title = \"Air\" composer = \"J. S. Bach\" }\n{ c'1 }")
    assert_eq(Score.find(score._key).composer, "J. S. Bach")
    saved = score.save_from_editor(
      "\\header { title = \"Air\" composer = \"Handel\" }\n{ d'1 }",
      score.revision,
      owner
    )
    assert_eq(saved["status"], 200)
    assert_eq(Score.find(score._key).composer, "Handel")
    none = Score.start(owner, Score.blank_source("Nobody's"))
    assert_eq(Score.find(none._key).composer, "")
  end

  test("the library finds a score by its composer as well as its title, the owner's only") do
    owner = score_owner()
    Score.start(owner, "\\header { title = \"Ode to Joy\" composer = \"Beethoven\" }\n{ c'1 }")
    Score.start(owner, "\\header { title = \"Minuet\" composer = \"Petzold\" }\n{ c'1 }")
    Score.start(owner, Score.blank_source("Beethoven's cat"))
    Score.start(score_owner(), "\\header { title = \"Not mine\" composer = \"Beethoven\" }\n{ c'1 }")
    found = Score.library(owner, "beeTHOVEN", "title").map(&:title)
    assert_eq(found, ["Beethoven's cat", "Ode to Joy"])
    assert_eq(Score.library(owner, "petz", "title").map(&:title), ["Minuet"])
    assert_eq(Score.library(owner, "Mozart", "title").length, 0)
  end

  test("a score saved before composers were kept is found once backfilled, its times and revision untouched") do
    owner = score_owner()
    score = Score.start(owner, "\\header { title = \"Old\" composer = \"Satie\" }\n{ c'1 }")
    Score.where("doc._key == @key", {"key": score._key}).update_all({"composer": nil})
    before = Score.find(score._key)
    assert_null(before.composer)
    assert_eq(Score.library(owner, "satie", "title").length, 0)
    assert(Score.backfill_composers(2) >= 1)
    after = Score.find(score._key)
    assert_eq(after.composer, "Satie")
    assert_eq(after.revision, before.revision)
    assert_eq(after.updated_at, before.updated_at)
    assert_eq(Score.library(owner, "satie", "title").map(&:title), ["Old"])
    assert_eq(Score.backfill_composers(2), 0)
  end

  test("pages of SCORE_PAGE_SIZE: the last full page says there is more, the next holds the rest") do
    owner = score_owner()
    (0 .. SCORE_PAGE_SIZE + 1).each do |i|
      Score.start(owner, Score.blank_source("Piece #{1000 + i}"))
    end
    first = Score.library_page(owner, "", "title", 1)
    assert_eq(first["scores"].length, SCORE_PAGE_SIZE)
    assert(first["more"])
    assert_eq(first["scores"][0].title, "Piece 1000")
    second = Score.library_page(owner, "", "title", 2)
    assert_eq(second["scores"].map(&:title), ["Piece #{1000 + SCORE_PAGE_SIZE}"])
    assert_not(second["more"])
    third = Score.library_page(owner, "", "title", 3)
    assert_eq(third["scores"].length, 0)
    assert_not(third["more"])
  end

  test("exactly one page: no more") do
    owner = score_owner()
    (0 .. SCORE_PAGE_SIZE).each do |i|
      Score.start(owner, Score.blank_source("Etude #{i}"))
    end
    page = Score.library_page(owner, "", "updated", 1)
    assert_eq(page["scores"].length, SCORE_PAGE_SIZE)
    assert_not(page["more"])
  end

  test("a page number that is not one reads as the first") do
    assert_eq(Score.page_number("3"), 3)
    assert_eq(Score.page_number("0"), 1)
    assert_eq(Score.page_number("-2"), 1)
    assert_eq(Score.page_number("two"), 1)
    assert_eq(Score.page_number(nil), 1)
  end

  test("emptying the trash erases the owner's trashed scores and what hangs off them, nothing else") do
    owner = score_owner()
    stranger = score_owner()
    kept = Score.start(owner, Score.blank_source("Kept"))
    hang_off(kept)
    thrown = Score.start(owner, Score.blank_source("Thrown"))
    hang_off(thrown)
    thrown.move_to_trash
    old = trashed_long_ago(owner, "Long gone")
    theirs = Score.start(stranger, Score.blank_source("Theirs"))
    theirs.move_to_trash
    assert_eq(Score.empty_trash_of(owner), 2)
    assert_null(Score.find_by("_key", thrown._key))
    assert_null(Score.find_by("_key", old._key))
    assert_eq(remains_of(thrown), [
      0,
      0,
      0
    ])
    assert_not_null(Score.find_by("_key", kept._key))
    assert_eq(remains_of(kept), [
      1,
      1,
      1
    ])
    assert(Score.find(theirs._key).trashed?)
    assert_eq(Score.empty_trash_of(owner), 0)
  end

  test("many scores erased go in one statement a kind, not one a score, with all that hangs off them (#689)") do
    owner = score_owner()
    friend = score_owner()
    kept = Score.start(owner, Score.blank_source("Still here"))
    hang_off(kept)
    thrown = (0 .. 4).map do |i|
      score = Score.start(owner, Score.blank_source("Thrown #{i}"))
      hang_off(score)
      started = ScoreThread.start(score, friend, 0, [0, 0], "", "Here")
      assert_not_null(started["comment"], "a comment on it")
      UserNotification.tell(friend._key, "changed", score, owner)
      score.move_to_trash
      score
    end
    one_by_one = Mock.spy_class(ScoreVersion, "where")
    assert_eq(Score.empty_trash_of(owner), 4)
    assert_eq(one_by_one.call_count("where"), 1, "the versions of all four, in one statement")
    thrown.each do |score|
      assert_null(Score.find_by("_key", score._key))
      assert_eq(remains_of(score), [
        0,
        0,
        0
      ])
      assert_eq(ScoreThread.where({"score_id": score._key}).count, 0)
      assert_eq(ScoreComment.where({"score_id": score._key}).count, 0)
      assert_eq(UserNotification.where({"score_id": score._key}).count, 0)
    end
    assert_eq(remains_of(kept), [
      1,
      1,
      1
    ])
    assert_eq(Score.erase_keys([]), 0)
  end
end
