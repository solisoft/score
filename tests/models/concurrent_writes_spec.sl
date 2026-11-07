# Two changes at once must not undo each other (#685). `save` and `update`
# write the whole copy a request read (stale_write_facts_spec), so each
# write that may race another is made field by field, or over the revision
# it read. Each test plays the race in order: copy A read, the other change
# written, then A's write; the other change must still be there.

const RACE_PASSWORD = "correct horse battery"

def race_user(name = nil)
  user = User.new()
  user.email = "race-#{uuid_v4}@example.com"
  user.name = name unless name.nil?
  user.set_password(RACE_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  User.find(user._key)
end

# A new password set from another copy: the sessions' version moves on.
def race_password_changed(user)
  other = User.find(user._key)
  other.change_password("another horse battery staple")
  User.find(user._key)
end

def race_score(owner, title = "Raced")
  Score.start(owner, Score.blank_source(title))
end

# The editor's save of `source` over the score as stored, from a fresh copy.
def race_editor_save(score, source)
  fresh = Score.find(score._key)
  answer = fresh.save_from_editor(source, fresh.revision, User.find(score.user_id))
  assert_eq(answer["status"], 200, "the editor's save went through")
  Score.find(score._key)
end

def race_section(author)
  fields = {
    "title": "Raced groove",
    "description": "Bass, then two chords.",
    "instrument": "guitar",
    "style": "waltz",
    "time": "3/4",
    "key": "G major",
    "bpm": 96,
    "bars": 2,
    "tracks": 1,
    "section": {"bars": 2, "parts": [{
      "offset": 0,
      "voice": 1,
      "pieces": [{"ticks": 6720, "content": {"rest": true}}]
    }]},
    "source": "\\header { title = \"Waltz\" }\n\\new Staff { \\time 3/4 g4 b d' | c'2. }\n"
  }
  SharedSection.publish(author, fields)["section"]
end

def race_thread(score, user)
  ScoreThread.start(score, user, 1, [2, 3], "Bars 3–4, Oboe", "Look")["thread"]
end

# Bars 2 and 3 taken away, lanes 1 and 2 swapped: a thread on bars 3–4 of
# lane 1 goes to bars 1–2 of lane 2.
def race_moves
  ScoreThread.moves_of({
    "from": 4,
    "to": 4,
    "bars": [[0, 0, 1], [
      2,
      1,
      2
    ]],
    "lanes": [0, 2, -1]
  })
end

def race_done
  {
    "sent": 0,
    "off": 0,
    "failed": 0,
    "waiting": 0
  }
end

def race_mails_to(user)
  Mailer.deliveries().filter do |mail|
    mail["to"] == user.email
  end
end

describe("Two changes of an account at once") do
  test("a remembered browser from an older copy keeps a new password and its sessions' version") do
    user = race_user()
    stale = User.find(user._key)
    changed = race_password_changed(user)
    stale.start_remember_me
    stored = User.find(user._key)
    assert_eq(stored.session_version, changed.session_version)
    assert_eq(stored.password_digest, changed.password_digest)
    assert_not_null(stored.remember_token_digest)
  end

  test("a forgotten browser and the language kept, from older copies, keep a new password") do
    user = race_user()
    first = User.find(user._key)
    first.start_remember_me
    stale = User.find(user._key)
    other = User.find(user._key)
    changed = race_password_changed(user)
    stale.forget_me
    AppLocale.remember(other, "fr")
    stored = User.find(user._key)
    assert_eq(stored.session_version, changed.session_version)
    assert_eq(stored.password_digest, changed.password_digest)
    assert_eq(stored.locale, "fr")
  end

  test("two sign-outs of every session at once each move the sessions' version on") do
    user = race_user()
    stale = User.find(user._key)
    before = stale.current_session_version
    changed = race_password_changed(user)
    assert_eq(changed.session_version, before + 1)
    stale.change_password("a third horse battery staple")
    assert_eq(User.find(user._key).session_version, before + 2, "a session opened after the first stays out")
    assert_eq(stale.session_version, before + 2)
  end

  test("the lockout counts written meanwhile survive a write from an older copy") do
    user = race_user()
    source = User.failure_source("192.0.2.80")
    User.count_failure(user._key, source, DateTime.utc.to_unix)
    stale = User.find(user._key)
    User.count_failure(user._key, source, DateTime.utc.to_unix)
    counted = User.find(user._key)
    assert_eq(counted.account_failures["count"], 2)
    stale.keep_mail_prefs(["reply"])
    stored = User.find(user._key)
    assert_eq(stored.account_failures, counted.account_failures)
    assert_eq(stored.sign_in_failures, counted.sign_in_failures)
    assert_not(stored.mails?("mention"))
    assert(stored.mails?("reply"))
  end

  test("Stripe's webhook, from a copy read before a new password, keeps it") do
    user = race_user()
    stale = User.find(user._key)
    changed = race_password_changed(user)
    outcome = Billing.subscribed(
      {
        "id": "sub_race",
        "customer": "cus_race",
        "status": "active",
        "current_period_end": DateTime.utc.to_unix + 86400,
        "cancel_at_period_end": false,
        "metadata": {"plan": "pro"}
      },
      stale
    )
    assert_eq(outcome, "processed")
    stored = User.find(user._key)
    assert_eq(stored.plan, "pro")
    assert_eq(stored.stripe_subscription_id, "sub_race")
    assert_eq(stored.session_version, changed.session_version)
    assert_eq(stored.password_digest, changed.password_digest)
  end

  test("an admin's offer of Pro, from an older copy, keeps a new password") do
    user = race_user()
    stale = User.find(user._key)
    changed = race_password_changed(user)
    assert_null(stale.gift_pro(30, DateTime.utc.to_unix))
    stored = User.find(user._key)
    assert(stored.pro?)
    assert_eq(stored.password_digest, changed.password_digest)
  end

  test("a name given from an older copy keeps a new password") do
    user = race_user()
    stale = User.find(user._key)
    changed = race_password_changed(user)
    assert_null(stale.name_as("Racer"))
    stored = User.find(user._key)
    assert_eq(stored.name, "Racer")
    assert_eq(stored.password_digest, changed.password_digest)
    assert_eq(stale.session_version, changed.session_version, "the copy reads what is stored")
  end
end

describe("Invitations sent at once") do
  test("two requests that both read one invitation left send one, not two") do
    owner = race_user()
    score = race_score(owner)
    most = ScoreShare.invitations_per_day(owner)
    now = DateTime.utc.to_unix
    owner.invitations_sent = (0 .. most - 1).map do |i|
      now - i - 1
    end
    owner.save_changes
    first = User.find(owner._key)
    second = User.find(owner._key)
    assert_eq(ScoreShare.invitations_left(second), 1)
    sent = ScoreShare.invite_by(first, score, "first-#{uuid_v4}@example.com", "read", false)
    assert_not_null(sent._key)
    refused = ScoreShare.invite_by(second, score, "second-#{uuid_v4}@example.com", "read", false)
    assert(refused["limit"], "the second is refused: the day's are sent")
    assert_eq(User.find(owner._key).invitations_sent.length, most)
    assert_eq(ScoreShare.where({"score_id": score._key}).count, 1)
  end

  test("an invitation refused gives its place back, and writes nothing else of the account") do
    owner = race_user()
    score = race_score(owner)
    stale = User.find(owner._key)
    changed = race_password_changed(owner)
    refused = ScoreShare.invite_by(stale, score, owner.email, "read", false)
    assert_not_null(refused["error"])
    stored = User.find(owner._key)
    assert_eq((stored.invitations_sent ?? []).length, 0)
    assert_eq(stored.session_version, changed.session_version)
  end
end

describe("Passwords asked by a signed-in page") do
  test("their tries are counted in the database, where every worker reads them") do
    user = race_user()
    (0 .. ACCOUNT_PASSWORD_TRIES).each do |_|
      assert_not(user.confirms_password?("wrong"))
    end
    name = "password-check:#{user._key}:#{user.password_round.to_s.to_i}"
    row = RateCount.find_by("_key", Crypto.sha256(name))
    assert_not_null(row, "the tries are a row of rate_counts")
    assert_eq(row.count, ACCOUNT_PASSWORD_TRIES)
    other = User.find(user._key)
    assert(other.password_tries_spent?, "another copy, as another worker, sees them spent")
    assert_not(other.confirms_password?(RACE_PASSWORD), "even the right one is refused")
    assert_not(race_user().password_tries_spent?, "another account's are its own")
  end
end

describe("A shared section rated while an admin hides it") do
  test("the rating, from a copy read before, leaves it hidden, and counts") do
    section = race_section(race_user())
    rater = race_user()
    stale = SharedSection.find(section._key)
    SharedSection.where({"_key": section._key}).update_all({"hidden": true})
    assert_null(SectionRating.rate(stale, rater, 4))
    stored = SharedSection.find(section._key)
    assert(stored.hidden, "still hidden")
    assert_eq(stored.rating_count, 1)
    assert_eq(stored.rating_sum, 4)
    assert_eq(stale.average, 4, "the copy holds the counts written")
  end

  test("a comment, from a copy read before, leaves it hidden, and counts only the comments shown") do
    section = race_section(race_user())
    stale = SharedSection.find(section._key)
    SharedSection.where({"_key": section._key}).update_all({"hidden": true})
    written = SectionComment.write(stale, race_user(), "Groovy")
    assert_null(written["error"])
    SectionComment.create({
      "section_id": section._key,
      "user_id": "someone",
      "body": "Hidden one",
      "hidden": true,
      "created_at": DateTime.utc.to_unix
    })
    stale.recount
    stored = SharedSection.find(section._key)
    assert(stored.hidden)
    assert_eq(stored.comments_count, 1)
  end
end

describe("A score changed while its editor saves") do
  test("trashed, shared, or given a new link from an older copy: the editor's text stays") do
    owner = race_user()
    score = race_score(owner, "First")
    stale = Score.find(score._key)
    saved = race_editor_save(score, Score.blank_source("Edited"))
    stale.make_visible("link")
    stale.new_link
    stale.move_to_trash
    stored = Score.find(score._key)
    assert_eq(stored.source, saved.source)
    assert_eq(stored.title, "Edited")
    assert_eq(stored.visibility, "link")
    assert_ne(stored.share_token, saved.share_token)
    assert_not_null(stored.trashed_at)
    assert_eq(stored.revision, saved.revision + 3, "each write is a revision")
    assert_eq(stale.revision, stored.revision, "the copy holds what was written")
    stale.restore_from_trash
    assert_null(Score.find(score._key).trashed_at)
    assert_eq(Score.find(score._key).source, saved.source)
  end

  test("renamed from an older copy: the new title goes into the editor's text") do
    owner = race_user()
    score = race_score(owner, "First")
    stale = Score.find(score._key)
    edited = Score.blank_source("Edited") + "\n% the editor's line\n"
    race_editor_save(score, edited)
    assert(stale.rename("Renamed"))
    stored = Score.find(score._key)
    assert_eq(stored.title, "Renamed")
    assert_contains(stored.source, "% the editor's line")
    assert_not(stale.rename("t" * 201), "a title too long is refused")
    assert_eq(Score.find(score._key).title, "Renamed")
  end

  test("a version restored from an older copy keeps the editor's text as a version first") do
    owner = race_user()
    score = race_score(owner, "First")
    ScoreVersion.keep(score, score.source, "manual")
    version = ScoreVersion.where({"score_id": score._key}).first
    stale = Score.find(score._key)
    edited = Score.blank_source("Edited") + "\n% newer\n"
    race_editor_save(score, edited)
    assert(stale.restore_version(version, owner))
    stored = Score.find(score._key)
    assert_eq(stored.source, version.source)
    kept = ScoreVersion.where({"score_id": score._key}).all.map(&:source)
    assert(kept.includes?(edited), "the editor's text is kept as a version")
  end

  test("the editor's save, over a revision a change of visibility moved past, is a conflict") do
    owner = race_user()
    score = race_score(owner, "First")
    editor_copy = Score.find(score._key)
    Score.find(score._key).make_visible("public")
    answer = editor_copy.save_from_editor(Score.blank_source("Edited"), editor_copy.revision, owner)
    assert_eq(answer["status"], 409)
    stored = Score.find(score._key)
    assert_eq(stored.visibility, "public")
    assert_eq(stored.title, "First")
  end
end

describe("A comment thread resolved while an editor's save moves it") do
  test("moved from a copy read before it was resolved: it stays resolved") do
    owner = race_user()
    score = race_score(owner)
    thread = race_thread(score, owner)
    stale = ScoreThread.find(thread._key)
    ScoreThread.find(thread._key).resolve(owner)
    assert(stale.follow_moves(race_moves()))
    stored = ScoreThread.find(thread._key)
    assert(stored.resolved, "still resolved")
    assert_eq(stored.resolved_by, owner._key)
    assert_eq(stored.lane, 2)
    assert_eq(stored.bars, [1, 2])
  end

  test("resolved, then reopened, from a copy read before it moved: it stays where it went") do
    owner = race_user()
    score = race_score(owner)
    thread = race_thread(score, owner)
    stale = ScoreThread.find(thread._key)
    ScoreThread.find(thread._key).follow_moves(race_moves())
    stale.resolve(owner)
    assert(ScoreThread.find(thread._key).resolved)
    stale.reopen
    stored = ScoreThread.find(thread._key)
    assert_not(stored.resolved)
    assert_null(stored.resolved_by)
    assert_eq(stored.lane, 2)
    assert_eq(stored.bars, [1, 2])
    assert_eq(stored.label, "Bars 2–3, Oboe")
  end
end

describe("Notification e-mails sent by two runs at once") do
  before_each() do
    Mailer.clear_deliveries()
    UserNotification.where({"mail": "pending"}).update_all({"mail": "none"})
  end

  test("rows another run read pending are sent once") do
    owner = race_user("Olga")
    friend = race_user()
    score = race_score(owner)
    UserNotification.tell(friend._key, "reply", score, owner)
    now = DateTime.utc.to_unix
    read_by_second_run = UserNotification.where({
      "user_id": friend._key,
      "mail": "pending"
    }).all
    assert_eq(read_by_second_run.length, 1)
    assert_eq(UserNotification.mail_due(now)["sent"], 1)
    done = race_done()
    assert_not(UserNotification.send_claimed(read_by_second_run, friend, now, done), "nothing left to claim")
    assert_eq(done["sent"], 0)
    assert_eq(race_mails_to(friend).length, 1)
    assert_eq(UserNotification.mail_due(now)["sent"], 0)
    assert_eq(race_mails_to(friend).length, 1)
  end

  test("a notification read from a copy taken before its mail was sent is not sent again") do
    owner = race_user()
    friend = race_user()
    score = race_score(owner)
    note = UserNotification.tell(friend._key, "mention", score, owner, {"label": "Bar 1"})
    stale = UserNotification.find(note._key)
    UserNotification.mail_due(DateTime.utc.to_unix)
    stale.read!
    stored = UserNotification.find(note._key)
    assert_eq(stored.mail, "sent")
    assert_not_null(stored.read_at)
    assert_eq(UserNotification.mail_due(DateTime.utc.to_unix)["sent"], 0)
    assert_eq(race_mails_to(friend).length, 1)
  end

  test("a run that claimed rows and stopped leaves them to the next run, after a while") do
    owner = race_user()
    friend = race_user()
    score = race_score(owner)
    note = UserNotification.tell(friend._key, "reply", score, owner)
    long_ago = DateTime.utc.to_unix - NOTIFICATION_CLAIM_SECONDS - 60
    assert_eq(UserNotification.claimed([note], long_ago).length, 1)
    assert_eq(UserNotification.claimed([note], long_ago).length, 0, "claimed once")
    assert_eq(UserNotification.find(note._key).mail, "sending")
    assert_eq(UserNotification.mail_due(DateTime.utc.to_unix)["sent"], 1)
    assert_eq(UserNotification.find(note._key).mail, "sent")
    claimed_now = UserNotification.tell(friend._key, "reply", score, owner)
    UserNotification.claimed([claimed_now], DateTime.utc.to_unix)
    UserNotification.mail_due(DateTime.utc.to_unix)
    assert_eq(UserNotification.find(claimed_now._key).mail, "sending", "a fresh claim is left alone")
  end

  test("a name joined from an older copy keeps the read mark and the mail's state") do
    owner = race_user("Olga")
    friend = race_user()
    other = race_user("Ben")
    score = race_score(owner)
    ScoreShare.invite(score, friend.email, "write")
    UserNotification.changed(score, owner)
    note = UserNotification.where({
      "user_id": friend._key,
      "kind": "changed"
    }).first
    stale = UserNotification.find(note._key)
    UserNotification.find(note._key).read!
    UserNotification.where({"_key": note._key}).update_all({"mail": "sent"})
    stale.joined_by(other)
    stored = UserNotification.find(note._key)
    assert_eq(stored.mail, "sent")
    assert_not_null(stored.read_at)
    assert(stored.actor_ids.includes?(other._key))
  end
end
