# What the app tells people (#385): a share, a reply in a thread they wrote
# in, an @mention, a change to a score they may see (once an hour a score);
# never the person who did it; read one by one or all at once.

def notice_person(name = nil)
  user = User.new()
  user.email = "notice-#{uuid_v4}@example.com"
  user.name = name unless name.nil?
  user.set_password("correct horse battery")
  user.save
  user
end

# A score of `owner`'s shared with `writer` (write) and `reader` (read).
def notice_score(owner, writer, reader)
  score = Score.start(owner, Score.blank_source("Told about"))
  ScoreShare.invite(score, writer.email, "write")
  ScoreShare.invite(score, reader.email, "read")
  score
end

def notices_of(user, kind)
  UserNotification.where({"user_id": user._key, "kind": kind}).all
end

describe("UserNotification") do
  test("a share tells its person in the app, without a second e-mail; nobody without an account") do
    owner = notice_person()
    friend = notice_person()
    score = Score.start(owner, Score.blank_source("Shared"))
    share = ScoreShare.invite(score, friend.email, "read")
    told = UserNotification.shared(share, score, owner)
    assert_eq(told.user_id, friend._key)
    assert_eq(told.mail, "none")
    assert_eq(told.sentence, "#{owner.email} shared “Shared” with you")
    stranger_share = ScoreShare.invite(score, "nobody-#{uuid_v4}@example.com", "read")
    assert_null(UserNotification.shared(stranger_share, score, owner))
  end

  test("nobody is told of what they did themselves") do
    owner = notice_person()
    score = Score.start(owner, Score.blank_source("Mine"))
    assert_null(UserNotification.tell(owner._key, "reply", score, owner))
    assert_eq(notices_of(owner, "reply").length, 0)
  end

  test("a reply tells those who wrote in the thread before; a mention tells who it names, once") do
    owner = notice_person()
    writer = notice_person("Wanda")
    reader = notice_person()
    score = notice_score(owner, writer, reader)
    thread = ScoreThread.start(score, owner, 0, [0, 1], "Bars 1–2, Piano", "What do you think?")["thread"]
    first = thread.reply(writer, "Fine by me")["comment"]
    assert_eq(UserNotification.commented(thread, first, score, writer), 1)
    reply = notices_of(owner, "reply")
    assert_eq(reply.length, 1)
    assert_eq(reply[0].sentence, "Wanda replied in a thread on “Told about”, Bars 1–2, Piano")
    assert_eq(reply[0].excerpt, "Fine by me")
    assert_eq(reply[0].mail, "pending")
    assert_eq(notices_of(writer, "reply").length, 0)
    assert_eq(notices_of(reader, "reply").length, 0, "the reader wrote nothing there")
    # The reader mentions the owner and the writer: a mention each, no reply on top.
    second = thread.reply(reader, "@wanda and @#{owner.email.split("@")[0]}: louder")["comment"]
    assert_eq(UserNotification.commented(thread, second, score, reader), 2)
    assert_eq(notices_of(writer, "mention").length, 1)
    assert_eq(notices_of(owner, "mention").length, 1)
    assert_eq(notices_of(owner, "reply").length, 1)
    assert_eq(
      notices_of(writer, "mention")[0].sentence,
      "#{reader.email} mentioned you on “Told about”, Bars 1–2, Piano"
    )
  end

  test("someone no longer of the score is not told of a reply") do
    owner = notice_person()
    writer = notice_person()
    reader = notice_person()
    score = notice_score(owner, writer, reader)
    thread = ScoreThread.start(score, writer, 0, [0, 0], "", "Here")["thread"]
    ScoreShare.leave(score, writer)
    comment = thread.reply(owner, "Answered")["comment"]
    assert_eq(UserNotification.commented(thread, comment, score, owner), 0)
    assert_eq(notices_of(writer, "reply").length, 0)
  end

  test("a change tells everyone else of the score, once an hour, gathering who changed it") do
    owner = notice_person("Olga")
    writer = notice_person("Wim")
    reader = notice_person()
    score = notice_score(owner, writer, reader)
    assert_eq(UserNotification.changed(score, writer), 2)
    assert_eq(UserNotification.changed(score, writer), 0, "again within the hour: nothing new")
    assert_eq(UserNotification.changed(score, owner), 1, "the writer, told of the owner's change")
    assert_eq(notices_of(writer, "changed").length, 1)
    for_reader = notices_of(reader, "changed")
    assert_eq(for_reader.length, 1)
    assert_eq(for_reader[0].actor_names, ["Wim", "Olga"])
    assert_eq(for_reader[0].sentence, "Wim and Olga changed “Told about”")
    # An hour later: a new one.
    stale = for_reader[0]
    stale.created_at = DateTime.utc.to_unix - NOTIFICATION_CHANGED_SECONDS - 5
    stale.save
    UserNotification.changed(score, writer)
    assert_eq(notices_of(reader, "changed").length, 2)
  end

  test("read one by one, or all at once; each person's own") do
    owner = notice_person()
    writer = notice_person()
    reader = notice_person()
    score = notice_score(owner, writer, reader)
    UserNotification.changed(score, owner)
    UserNotification.tell(reader._key, "mention", score, writer)
    assert_eq(UserNotification.unread_count(reader), 2)
    one = UserNotification.recent(reader)[0]
    assert_null(UserNotification.of(writer, one._key), "nobody else's")
    assert_eq(UserNotification.of(reader, one._key)._key, one._key)
    one.read!
    assert(UserNotification.find(one._key).read?)
    assert_eq(UserNotification.unread_count(reader), 1)
    assert_eq(UserNotification.read_all(reader), 1)
    assert_eq(UserNotification.unread_count(reader), 0)
    assert_eq(UserNotification.unread_count(writer), 1, "the writer's stay unread")
  end

  test("says who did it: one, two, three names; an excerpt is cut") do
    note = UserNotification.new()
    note.actor_names = []
    assert_eq(note.actors_said, "Someone")
    note.actor_names = [
      "Ana",
      "Ben",
      "Chloé"
    ]
    assert_eq(note.actors_said, "Ana, Ben and Chloé")
    long = UserNotification.excerpt("a  b\n" + ("z" * 300))
    assert_eq(long.chars().length, NOTIFICATION_EXCERPT_LENGTH)
    assert(long.starts_with?("a b z"))
    assert(long.ends_with?("…"))
  end

  test("goes with its score and with its person") do
    owner = notice_person()
    writer = notice_person()
    reader = notice_person()
    score = notice_score(owner, writer, reader)
    UserNotification.changed(score, owner)
    reader.erase_account
    assert_eq(UserNotification.where({"user_id": reader._key}).count, 0)
    assert_eq(UserNotification.where({"user_id": writer._key}).count, 1)
    score.erase
    assert_eq(UserNotification.where({"score_id": score._key}).count, 0)
  end
end

describe("User e-mail settings") do
  test("every kind is e-mailed until turned off; turned on again") do
    user = notice_person()
    NOTIFICATION_KINDS.each do |kind|
      assert(user.mails?(kind), kind)
    end
    user.keep_mail_prefs(["reply"])
    stored = User.find(user._key)
    assert(stored.mails?("reply"))
    assert_not(stored.mails?("mention"))
    assert_not(stored.mails?("changed"))
    assert_not(stored.mails?("shared"))
    stored.keep_mail_prefs(NOTIFICATION_KINDS)
    assert(User.find(user._key).mails?("changed"))
  end
end
