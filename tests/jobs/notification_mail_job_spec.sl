# The notifications' e-mails (#385), sent by NotificationMailJob every five
# minutes: a reply or a mention each its own, the changes gathered in one
# digest once their hour is over; none of what a person turned off, nor a
# second one for a share, whose invitation is the e-mail.

def mail_person(name = nil)
  user = User.new()
  user.email = "mail-#{uuid_v4}@example.com"
  user.name = name unless name.nil?
  user.set_password("correct horse battery")
  user.save
  user
end

def mail_score(owner, title)
  Score.start(owner, Score.blank_source(title))
end

# The notification `note` made older than its hour.
def mail_hour_over(note)
  note.created_at = DateTime.utc.to_unix - NOTIFICATION_CHANGED_SECONDS - 60
  note.save
  note
end

def mails_to(user)
  Mailer.deliveries().filter do |mail|
    mail["to"] == user.email
  end
end

describe("NotificationMailJob") do
  before_each() do
    Mailer.clear_deliveries()
    # What other specs left pending is not this spec's to send.
    UserNotification.where({"mail": "pending"}).update_all({"mail": "none"})
  end

  test("runs every five minutes") do
    assert_eq(NotificationMailJob.cron, Cron.every("5 minutes"))
  end

  test("mails a mention at once, with the thread's link, and only once") do
    owner = mail_person("Olga")
    friend = mail_person()
    score = mail_score(owner, "Mailed")
    note = UserNotification.tell(friend._key, "mention", score, owner, {
      "thread_id": "t1",
      "label": "Bar 2, Piano",
      "excerpt": "Look <here> & there"
    })
    done = NotificationMailJob.perform_now({})
    assert_eq(done["sent"], 1)
    sent = mails_to(friend)
    assert_eq(sent.length, 1)
    assert_eq(sent[0]["subject"], "Olga mentioned you on “Mailed”, Bar 2, Piano")
    assert_contains(sent[0]["text"], "/app/notifications/#{note._key}/open")
    assert_contains(sent[0]["text"], "/app/account#notifications")
    assert_contains(sent[0]["html"], "Look &lt;here&gt; &amp; there")
    assert_not(sent[0]["html"].contains("<here>"))
    stored = UserNotification.find(note._key)
    assert_eq(stored.mail, "sent")
    assert_not_null(stored.mailed_at)
    Mailer.clear_deliveries()
    assert_eq(NotificationMailJob.perform_now({})["sent"], 0)
    assert_eq(mails_to(friend).length, 0)
  end

  test("sends nothing its person turned off, nor to someone gone, and marks it so") do
    owner = mail_person()
    friend = mail_person()
    gone = mail_person()
    friend.keep_mail_prefs(["mention"])
    score = mail_score(owner, "Quiet")
    reply = UserNotification.tell(friend._key, "reply", score, owner)
    lost = UserNotification.tell(gone._key, "mention", score, owner)
    gone.delete
    done = NotificationMailJob.perform_now({})
    assert_eq(done["off"], 2)
    assert_eq(done["sent"], 0)
    assert_eq(mails_to(friend).length, 0)
    assert_eq(UserNotification.find(reply._key).mail, "off")
    assert_eq(UserNotification.find(lost._key).mail, "off")
  end

  test("never mails a share: the invitation did") do
    owner = mail_person()
    friend = mail_person()
    score = mail_score(owner, "Shared")
    UserNotification.shared(ScoreShare.invite(score, friend.email, "read"), score, owner)
    NotificationMailJob.perform_now({})
    assert_eq(mails_to(friend).length, 0)
  end

  test("gathers the changes in one digest a person, once their hour is over") do
    owner = mail_person("Olga")
    friend = mail_person()
    first = mail_score(owner, "First")
    second = mail_score(owner, "Second")
    third = mail_score(owner, "Third")
    [first, second, third].each do |score|
      ScoreShare.invite(score, friend.email, "read")
      UserNotification.changed(score, owner)
    end
    waiting = NotificationMailJob.perform_now({})
    assert_eq(waiting["waiting"], 3)
    assert_eq(mails_to(friend).length, 0, "not one an hour is over for")
    notes = UserNotification.where({
      "user_id": friend._key,
      "kind": "changed"
    }).all
    notes.each do |note|
      mail_hour_over(note) unless note.score_id == third._key
    end
    done = NotificationMailJob.perform_now({})
    assert_eq(done["sent"], 1)
    digest = mails_to(friend)
    assert_eq(digest.length, 1)
    assert_eq(digest[0]["subject"], "2 scores shared with you were changed")
    assert_contains(digest[0]["text"], "Olga changed “First”.")
    assert_contains(digest[0]["text"], "Olga changed “Second”.")
    assert_not(digest[0]["text"].contains("Third"))
    assert_contains(digest[0]["text"], "/app/notifications")
    assert_eq(UserNotification.where({
      "user_id": friend._key,
      "kind": "changed",
      "mail": "pending"
    }).count, 1)
  end

  test("a digest of one change names the score and opens it") do
    owner = mail_person()
    friend = mail_person()
    score = mail_score(owner, "Alone")
    ScoreShare.invite(score, friend.email, "write")
    UserNotification.changed(score, owner)
    note = mail_hour_over(UserNotification.where({"user_id": friend._key}).first)
    NotificationMailJob.perform_now({})
    digest = mails_to(friend)
    assert_eq(digest.length, 1)
    assert_eq(digest[0]["subject"], "#{owner.email} changed “Alone”")
    assert_contains(digest[0]["text"], "/app/notifications/#{note._key}/open")
  end

  test("a mail that cannot be sent is tried again, three times at most") do
    owner = mail_person()
    friend = mail_person()
    score = mail_score(owner, "Unlucky")
    note = UserNotification.tell(friend._key, "reply", score, owner)
    done = {
      "sent": 0,
      "off": 0,
      "failed": 0,
      "waiting": 0
    }
    UserNotification.mailed([note], false, DateTime.utc.to_unix, done)
    assert_eq(UserNotification.find(note._key).mail, "pending")
    UserNotification.mailed([note], false, DateTime.utc.to_unix, done)
    UserNotification.mailed([note], false, DateTime.utc.to_unix, done)
    assert_eq(UserNotification.find(note._key).mail, "failed")
    assert_eq(done["failed"], 3)
  end
end
