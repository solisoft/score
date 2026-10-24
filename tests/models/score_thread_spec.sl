# Comment threads on a score's bars (#385): started on a staff and its
# bars, replied to, resolved and reopened, each message changed or deleted
# by its author only; and the @mentions read in them.

def thread_person(name = nil)
  user = User.new()
  user.email = "thread-#{uuid_v4}@example.com"
  user.name = name unless name.nil?
  user.set_password("correct horse battery")
  user.save
  user
end

def thread_score(owner)
  Score.start(owner, Score.blank_source("Talked about"))
end

describe("ScoreThread") do
  test("starts on a staff and its bars, with its first message, and lists it") do
    owner = thread_person()
    score = thread_score(owner)
    started = ScoreThread.start(score, owner, 1, [2, 4], "Bars 3–5, Piano", "  Louder here?  ")
    assert_null(started["error"])
    thread = ScoreThread.find(started["thread"]._key)
    assert_eq(thread.score_id, score._key)
    assert_eq(thread.lane, 1)
    assert_eq(thread.bars, [2, 4])
    assert_eq(thread.label, "Bars 3–5, Piano")
    assert_not(thread.resolved)
    assert_eq(started["comment"].body, "Louder here?")
    listing = ScoreThread.listing(score)
    assert_eq(listing.length, 1)
    assert_eq(listing[0]["messages"].length, 1)
    assert_eq(listing[0]["messages"][0]["author"], owner.email)
    assert_eq(listing[0]["messages"][0]["author_id"], owner._key)
  end

  test("refuses a thread with no place, a place out of bounds, or nothing said, and writes nothing") do
    owner = thread_person()
    score = thread_score(owner)
    assert_contains(ScoreThread.start(score, owner, nil, nil, "", "Hi")["error"], "Select some bars")
    assert_contains(ScoreThread.start(score, owner, 0, [3, 1], "", "Hi")["error"], "Select some bars")
    assert_contains(ScoreThread.start(score, owner, 64, [0, 0], "", "Hi")["error"], "Select some bars")
    assert_contains(ScoreThread.start(score, owner, "0", [0, 0], "", "Hi")["error"], "Select some bars")
    assert_contains(ScoreThread.start(score, owner, 0, [0, 0], "", "   ")["error"], "Write something")
    too_long = "x" * (SCORE_COMMENT_LENGTH + 1)
    assert_contains(ScoreThread.start(score, owner, 0, [0, 0], "", too_long)["error"], "at most")
    assert_eq(ScoreThread.where({"score_id": score._key}).count, 0)
    assert_eq(ScoreComment.where({"score_id": score._key}).count, 0)
  end

  test("without a label, names its bars and staff counted from 1; a long one is cut") do
    assert_eq(ScoreThread.label_for(
      "",
      {"lane": 0, "bars": [2, 2]}
    ), "Bar 3, staff 1")
    assert_eq(ScoreThread.label_for(
      nil,
      {"lane": 2, "bars": [0, 3]}
    ), "Bars 1–4, staff 3")
    assert_eq(ScoreThread.label_for(
      "y" * 300,
      {"lane": 0, "bars": [0, 0]}
    ).length, SCORE_THREAD_LABEL_LENGTH)
  end

  test("replies, resolves (nobody replies then) and reopens") do
    owner = thread_person()
    friend = thread_person()
    score = thread_score(owner)
    thread = ScoreThread.start(score, owner, 0, [0, 0], "", "Is this right?")["thread"]
    assert_null(thread.reply(friend, "Yes.")["error"])
    assert_contains(thread.reply(friend, "")["error"], "Write something")
    thread.resolve(friend)
    stored = ScoreThread.find(thread._key)
    assert(stored.resolved)
    assert_eq(stored.resolved_by, friend._key)
    assert_contains(stored.reply(owner, "One more")["error"], "resolved")
    assert_eq(ScoreComment.where({"thread_id": thread._key}).count, 2)
    view = stored.shown
    assert_eq(view["resolved_by"], friend.email)
    stored.reopen
    reopened = ScoreThread.find(thread._key)
    assert_not(reopened.resolved)
    assert_null(reopened.resolved_by)
    assert_null(reopened.reply(owner, "One more")["error"])
    assert_eq(reopened.writers.length, 2)
  end

  test("lists the open threads first, the latest first, and the resolved after") do
    owner = thread_person()
    score = thread_score(owner)
    first = ScoreThread.start(score, owner, 0, [0, 0], "", "First")["thread"]
    second = ScoreThread.start(score, owner, 0, [1, 1], "", "Second")["thread"]
    done = ScoreThread.start(score, owner, 0, [2, 2], "", "Done")["thread"]
    first.updated_at = DateTime.utc.to_unix - 100
    first.save
    done.resolve(owner)
    keys = ScoreThread.listing(score).map do |view|
      view["id"]
    end
    assert_eq(keys, [second._key, first._key, done._key])
  end

  test("a message is changed or deleted by its author only; the thread goes with its last") do
    owner = thread_person()
    friend = thread_person()
    score = thread_score(owner)
    started = ScoreThread.start(score, owner, 0, [0, 0], "", "Mine")
    thread = started["thread"]
    reply = thread.reply(friend, "Theirs")["comment"]
    assert_contains(started["comment"].edit_by(friend, "Hacked"), "Only its author")
    assert_eq(ScoreComment.find(started["comment"]._key).body, "Mine")
    assert_contains(started["comment"].edit_by(owner, " "), "Write something")
    assert_null(started["comment"].edit_by(owner, "Mine, better"))
    changed = ScoreComment.find(started["comment"]._key)
    assert_eq(changed.body, "Mine, better")
    assert_not_null(changed.edited_at)
    assert_contains(reply.remove_by(owner), "Only its author")
    assert_not_null(ScoreComment.find_by("_key", reply._key))
    assert_null(reply.remove_by(friend))
    assert_null(ScoreComment.find_by("_key", reply._key))
    assert_not_null(ScoreThread.find_by("_key", thread._key))
    assert_null(changed.remove_by(owner))
    assert_null(ScoreThread.find_by("_key", thread._key))
  end

  test("goes with its score, erased") do
    owner = thread_person()
    score = thread_score(owner)
    ScoreThread.start(score, owner, 0, [0, 0], "", "Soon gone")
    score.erase
    assert_eq(ScoreThread.where({"score_id": score._key}).count, 0)
    assert_eq(ScoreComment.where({"score_id": score._key}).count, 0)
  end
end

describe("ScoreComment.mentioned") do
  test("finds the people of the score named with an @: address, its first part, name, first name") do
    ana = thread_person("Ana Vieira")
    ben = thread_person()
    chloe = thread_person()
    people = [ana, ben, chloe]
    ben_handle = ben.email.split("@")[0]
    found = ScoreComment.mentioned("@ana, look at this; and @#{ben_handle}.", people)
    assert_eq(found.map(&:_key).sort(), [ana._key, ben._key].sort())
    assert_eq(ScoreComment.mentioned("Thanks @#{chloe.email}!", people).map(&:_key), [chloe._key])
    assert_eq(ScoreComment.mentioned("Ask @AnaVieira", people).map(&:_key), [ana._key])
  end

  test("names nobody without an @, nor someone who is not of the score") do
    ana = thread_person("Ana")
    assert_eq(ScoreComment.mentioned("ana, look", [ana]).length, 0)
    assert_eq(ScoreComment.mentioned("@zoe look", [ana]).length, 0)
    assert_eq(ScoreComment.mentioned("an email: ana@example.com", [ana]).length, 0)
  end
end
