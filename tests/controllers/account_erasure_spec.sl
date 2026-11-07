# Deleting an account deletes everything of it (#686, AccountErasure): its
# scores, and what the person wrote on other people's scores and in the
# library, their tokens, codes, devices, counts and queued mail — and
# nothing of anyone else's. Interrupted, it finishes when run again, by
# them or by the nightly cleanup; a library of any size goes whole.

const ERASURE_PASSWORD = "correct horse battery"
const ERASURE_WAV = "RIFF....WAVEfmt data of a short take"

def erasure_user(name)
  user = User.new()
  user.email = "erasure-#{uuid_v4}@example.com"
  user.name = name
  user.set_password(ERASURE_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

def erasure_sign_in(user)
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": ERASURE_PASSWORD}
  )
end

# A take recorded by whoever is signed in onto `score`'s `track`, over HTTP:
# the uploader stores its sound in the server only.
def erasure_take(score, track)
  details = {
    "track": track.to_s,
    "name": "Voice",
    "offset": "0",
    "rate": "1",
    "duration": "2"
  }
  boundary = "----soli-erasure-spec"
  payload = ""
  details.keys().each do |key|
    payload = payload + "--#{boundary}\r\nContent-Disposition: form-data; name=\"#{key}\"\r\n\r\n#{details[key]}\r\n"
  end
  payload = payload + "--#{boundary}\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"take.wav\"\r\n"
  + "Content-Type: audio/wav\r\n\r\n#{ERASURE_WAV}\r\n--#{boundary}--\r\n"
  set_header("Content-Type", "multipart/form-data; boundary=#{boundary}")
  answer = post("/app/scores/#{score._key}/takes", payload)
  clear_headers()
  answer
end

# A section of the library by `user`, made directly.
def erasure_section(user, title)
  SharedSection.create({
    "user_id": user._key,
    "title": title,
    "description": "",
    "instrument": SECTION_INSTRUMENTS[0],
    "style": SECTION_STYLES[0],
    "time": "4/4",
    "bars": 1,
    "tracks": 1,
    "section": {"parts": [{}]},
    "source": "{ c'4 }",
    "rating_sum": 0,
    "rating_count": 0,
    "rating": 0,
    "comments_count": 0,
    "hidden": false,
    "created_at": DateTime.utc.to_unix
  })
end

# How many sound blobs of takes there are with `key`.
def erasure_blob_count(key)
  rows = @sdbql{
    FOR blob IN score_take_audio
    FILTER blob._key == #{key}
    RETURN blob._key
  }
  type(rows) == "array" ? rows.length : -1
end

def erasure_jobs_for(args_key, value)
  rows = @sdbql{
    FOR job IN _jobs
    FILTER job.args[#{args_key}] == #{value} AND job.state != "running"
    RETURN job._key
  }
  type(rows) == "array" ? rows.length : -1
end

def erasure_rate_key(name)
  Crypto.sha256(name)
end

# A query that finds the same score each time, as one whose delete fails
# would come back.
class ErasureStuckQuery
  # Only the keys are read (Score.erase_each, #689).
  def select(field)
    this
  end

  def limit(count)
    this
  end

  def all
    [@score]
  end
end

describe("Deleting an account") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  test("leaves nothing of the person, and everything of the others") do
    leaving = erasure_user("Lea")
    other = erasure_user("Otto")
    third = erasure_user("Tess")

    # Lea's own score, shared with Otto, with a version and Otto's thread.
    own = Score.start(leaving, Score.blank_source("Lea's"))
    ScoreVersion.keep(own, own.source, "manual", leaving._key)
    ScoreShare.invite(own, other.email, "write")
    ScoreThread.start(own, other, 0, [0, 0], "", "Nice")

    # Otto's score, shared with Lea and Tess, on which Lea wrote and saved.
    theirs = Score.start(other, Score.blank_source("Otto's"))
    ScoreShare.invite(theirs, leaving.email, "write")
    ScoreShare.invite(theirs, third.email, "write")
    kept_version = ScoreVersion.keep(theirs, theirs.source, "manual", leaving._key)
    others_version = ScoreVersion.keep(theirs, theirs.source, "manual", other._key)
    Score.where({"_key": theirs._key}).update_all({"saved_by": leaving._key})
    answered = ScoreThread.start(theirs, leaving, 0, [0, 1], "", "Mine, answered")["thread"]
    otto_reply = answered.reply(other, "Otto answers")["comment"]
    alone = ScoreThread.start(theirs, leaving, 0, [2, 2], "", "Mine alone")["thread"]
    ottos = ScoreThread.start(theirs, other, 1, [0, 0], "", "Otto's question")["thread"]
    ottos.reply(leaving, "Lea's answer")
    ottos.resolve(leaving)

    # Takes on Otto's score: Lea's (its sound too) and Otto's own.
    erasure_sign_in(leaving)
    assert_eq(res_status(erasure_take(theirs, 1)), 201)
    lea_take = ScoreTake.where({"user_id": leaving._key}).first
    lea_blob = lea_take.audio_blob_id
    assert_eq(erasure_blob_count(lea_blob), 1)
    erasure_sign_in(other)
    assert_eq(res_status(erasure_take(theirs, 2)), 201)
    otto_take = ScoreTake.where({"user_id": other._key}).first

    # Notifications: to Lea; to Otto of what Lea alone did; to Otto of a
    # change by Lea and Tess.
    UserNotification.tell(leaving._key, "shared", theirs, other)
    UserNotification.tell(other._key, "reply", theirs, leaving)
    both = UserNotification.tell(other._key, "changed", theirs, third)
    both.joined_by(leaving)
    by_tess = UserNotification.tell(other._key, "mention", theirs, third)

    # The library: Lea's section, rated, commented and reported by others;
    # Otto's, rated and commented by Lea and Tess, Lea's comment reported.
    lea_section = erasure_section(leaving, "Lea's groove")
    SectionRating.rate(lea_section, other, 4)
    SectionComment.write(lea_section, other, "Great")
    SectionReport.file(lea_section, nil, third, "Copied")
    otto_section = erasure_section(other, "Otto's groove")
    SectionRating.rate(otto_section, leaving, 1)
    SectionRating.rate(otto_section, third, 5)
    lea_comment = SectionComment.write(otto_section, leaving, "Meh")["comment"]
    SectionComment.write(otto_section, third, "Lovely")
    SectionReport.file(otto_section, lea_comment, third, "Rude")
    SectionReport.file(otto_section, nil, leaving, "Too loud")
    SectionReport.file(otto_section, nil, third, "Too quiet")

    # Requests, devices, tokens, codes, counts, queued mail.
    ScoreReading.create({
      "user_id": leaving._key,
      "state": "done",
      "picture": "base64-jpeg",
      "created_at": DateTime.utc.to_unix
    })
    ScoreSuggestion.create({
      "user_id": leaving._key,
      "score_id": theirs._key,
      "action": "ask",
      "request": "A coda",
      "original": theirs.source,
      "state": "done",
      "created_at": DateTime.utc.to_unix
    })
    PushSubscription.keep(leaving, {
      "endpoint": "https://fcm.googleapis.com/fcm/send/erasure-#{uuid_v4}",
      "keys": {"p256dh": "p", "auth": "a"}
    }, "Phone")
    AccessToken.issue(leaving, "Laptop")
    OauthCode.issue("client-erasure", leaving, "https://example.com/back", "challenge")
    TwoStepGuard.of(leaving)
    RateCount.take("reading-photo:#{leaving._key}", 5, 600)
    RateCount.take("engrave-pdf:user:#{leaving._key}", 5, 600)
    RateCount.take("engrave-pdf:user:#{other._key}", 5, 600)
    Job.enqueue_in("AuthMailJob", "1 hour", {
      "kind": "reset",
      "email": leaving.email
    })
    Job.enqueue_in("PushTestJob", "1 hour", {"user_id": leaving._key})
    Job.enqueue_in("AuthMailJob", "1 hour", {
      "kind": "reset",
      "email": other.email
    })

    # Erased in the server, as the account page does: the takes' sounds are
    # the server's to delete.
    erasure_sign_in(leaving)
    assert_eq(res_status(request("DELETE", "/app/account", {"password": ERASURE_PASSWORD}, {})), 302)

    key = leaving._key
    # Nothing of Lea's.
    assert_null(User.find_by("_key", key))
    assert_eq(Score.where({"user_id": key}).count, 0, "scores")
    assert_eq(ScoreVersion.where({"user_id": key}).count, 0, "versions of their scores")
    assert_eq(ScoreVersion.where({"author_id": key}).count, 0, "versions they saved")
    assert_eq(Score.where({"saved_by": key}).count, 0, "scores naming them")
    assert_eq(ScoreShare.where({"owner_id": key}).count, 0, "shares they made")
    assert_eq(ScoreShare.where({"email": leaving.email}).count, 0, "shares to them")
    assert_eq(ScoreThread.where({"score_id": own._key}).count, 0, "threads of their score")
    assert_eq(ScoreComment.where({"user_id": key}).count, 0, "messages")
    assert_eq(ScoreThread.where({"resolved_by": key}).count, 0, "resolved by them")
    assert_null(ScoreThread.find_by("_key", alone._key))
    assert_eq(ScoreTake.where({"user_id": key}).count, 0, "takes")
    assert_eq(erasure_blob_count(lea_blob), 0, "a take's sound")
    assert_eq(UserNotification.where({"user_id": key}).count, 0, "notifications to them")
    assert_eq(UserNotification.where("@user IN doc.actor_ids", {"user": key}).count, 0, "notifications of them")
    assert_eq(SharedSection.where({"user_id": key}).count, 0, "sections")
    assert_eq(SectionRating.where({"section_id": lea_section._key}).count, 0, "ratings of their section")
    assert_eq(SectionComment.where({"section_id": lea_section._key}).count, 0, "comments on their section")
    assert_eq(SectionReport.where({"section_id": lea_section._key}).count, 0, "reports on their section")
    assert_eq(SectionRating.where({"user_id": key}).count, 0, "ratings")
    assert_eq(SectionComment.where({"user_id": key}).count, 0, "library comments")
    assert_eq(SectionReport.where({"user_id": key}).count, 0, "reports filed")
    assert_eq(SectionReport.where({"target_id": lea_comment._key}).count, 0, "reports on their comment")
    assert_eq(ScoreReading.where({"user_id": key}).count, 0, "readings")
    assert_eq(ScoreSuggestion.where({"user_id": key}).count, 0, "suggestions")
    assert_eq(PushSubscription.where({"user_id": key}).count, 0, "devices")
    assert_eq(AccessToken.where({"user_id": key}).count, 0, "tokens")
    assert_eq(OauthCode.where({"user_id": key}).count, 0, "oauth codes")
    assert_eq(TwoStepGuard.where({"user_id": key}).count, 0, "second step")
    assert_null(RateCount.find_by("_key", erasure_rate_key("reading-photo:#{key}")))
    assert_null(RateCount.find_by("_key", erasure_rate_key("engrave-pdf:user:#{key}")))
    assert_eq(erasure_jobs_for("email", leaving.email), 0, "mail queued to them")
    assert_eq(erasure_jobs_for("user_id", key), 0, "jobs queued for them")

    # Everything of the others'.
    assert_not_null(User.find_by("_key", other._key))
    assert_eq(Score.find(theirs._key).title, "Otto's")
    assert_eq(ScoreShare.where({"score_id": theirs._key}).count, 1, "Otto's share to Tess")
    assert_eq(ScoreVersion.find(kept_version._key).author_id, nil)
    assert_eq(ScoreVersion.find(others_version._key).author_id, other._key)
    left = ScoreComment.where({"thread_id": answered._key}).all
    assert_eq(left.length, 1)
    assert_eq(left[0]._key, otto_reply._key)
    assert_not_null(ScoreThread.find_by("_key", answered._key))
    kept_thread = ScoreThread.find(ottos._key)
    assert_eq(kept_thread.resolved, true)
    assert_null(kept_thread.resolved_by)
    assert_eq(ScoreComment.where({"thread_id": ottos._key}).count, 1)
    assert_not_null(ScoreTake.find_by("_key", otto_take._key))
    assert_eq(erasure_blob_count(otto_take.audio_blob_id), 1)
    changed = UserNotification.find(both._key)
    assert_eq(changed.actor_ids, [third._key])
    assert_eq(changed.actor_names, [third.display_name])
    assert_not_null(UserNotification.find_by("_key", by_tess._key))
    section = SharedSection.find(otto_section._key)
    assert_eq(section.rating_count, 1)
    assert_eq(section.rating_sum, 5)
    assert_eq(section.comments_count, 1)
    assert_eq(SectionReport.where({
      "section_id": otto_section._key,
      "user_id": third._key,
      "target": "section"
    }).count, 1)
    assert_not_null(RateCount.find_by("_key", erasure_rate_key("engrave-pdf:user:#{other._key}")))
    assert_eq(erasure_jobs_for("email", other.email), 1, "mail queued to someone else")
  end

  test("a library of any size goes whole, read a batch at a time") do
    leaving = erasure_user("Many")
    other = erasure_user("Kept")
    (0 .. 5).each do |i|
      Score.start(leaving, Score.blank_source("Mine #{i}"))
    end
    gone = Score.start(leaving, Score.blank_source("Trashed"))
    gone.move_to_trash
    kept = Score.start(other, Score.blank_source("Theirs"))
    query = Score.where("doc.user_id == @user AND doc.trashed_at == null", {"user": leaving._key})
    assert_eq(Score.erase_each(query, 2), 5)
    assert_eq(Score.where({"user_id": leaving._key}).count, 1)
    leaving.erase_account(2)
    assert_eq(Score.where({"user_id": leaving._key}).count, 0)
    assert_not_null(Score.find_by("_key", kept._key))
  end

  test("a score that cannot be deleted stops the erasure instead of looping on it") do
    owner = erasure_user("Stuck")
    score = Score.start(owner, Score.blank_source("Comes back"))
    query = ErasureStuckQuery.new()
    query.score = score
    message = assert_raises("could not be erased") do
      Score.erase_each(query, 1)
    end
    assert_contains(message, score._key)
  end

  test("interrupted, it finishes when run again: by the nightly cleanup, never too early") do
    leaving = erasure_user("Halfway")
    bystander = erasure_user("Bystander")
    Score.start(leaving, Score.blank_source("Left behind"))
    section = erasure_section(leaving, "Left behind too")
    AccessToken.issue(leaving, "Laptop")
    # Stopped after the mark and the scores.
    AccountErasure.mark(leaving)
    AccountErasure.their_scores(leaving, 10)
    marked = User.find(leaving._key)
    assert_not_null(marked.erasing_at)
    assert_eq(Score.where({"user_id": leaving._key}).count, 0)
    assert_not_null(SharedSection.find_by("_key", section._key))

    # Not yet: it may still be running.
    assert_eq(AccountErasure.resume_all, 0)
    assert_not_null(User.find_by("_key", leaving._key))

    assert_eq(AccountErasure.resume_all(DateTime.utc.to_unix + ERASE_RESUME_AFTER_SECONDS + 60), 1)
    assert_null(User.find_by("_key", leaving._key))
    assert_null(SharedSection.find_by("_key", section._key))
    assert_eq(AccessToken.where({"user_id": leaving._key}).count, 0)
    assert_not_null(User.find_by("_key", bystander._key), "an account not being erased stays")
    assert_null(User.find(bystander._key).erasing_at)

    # The nightly job does it, and says how many it finished.
    again = erasure_user("Again")
    User.where({"_key": again._key}).update_all({"erasing_at": DateTime.utc.to_unix - ERASE_RESUME_AFTER_SECONDS - 60})
    done = DataCleanupJob.perform_now({})
    assert_gt(done["erasures"], 0)
    assert_null(User.find_by("_key", again._key))
  end

  test("a reading or a suggestion whose account went answers its job quietly") do
    assert_eq(ScoreReadingJob.perform({"reading_id": "gone-#{uuid_v4}"}), true)
    assert_eq(ScoreSuggestionJob.perform({"suggestion_id": "gone-#{uuid_v4}"}), true)
  end

  test("DELETE /app/account erases it all, the person's comment on another's score included") do
    leaving = erasure_user("Web")
    other = erasure_user("Host")
    theirs = Score.start(other, Score.blank_source("Host's"))
    ScoreShare.invite(theirs, leaving.email, "write")
    ScoreThread.start(theirs, leaving, 0, [0, 0], "", "Hello")
    erasure_sign_in(leaving)
    response = request("DELETE", "/app/account", {"password": ERASURE_PASSWORD}, {})
    assert_eq(res_status(response), 302)
    assert_null(User.find_by("_key", leaving._key))
    assert_eq(ScoreComment.where({"user_id": leaving._key}).count, 0)
    assert_eq(ScoreThread.where({"score_id": theirs._key}).count, 0)
    assert_not_null(Score.find_by("_key", theirs._key))
  end
end
