# The bell and the notifications page (#385): each person's own, opened
# (and read) to the editor or the read page as they may, marked read one by
# one or all at once; the e-mail settings on the account page; the read
# page's comments, for the people the score is shared with only.

const BELL_PASSWORD = "correct horse battery"

def bell_user
  user = User.new()
  user.email = "bell-#{uuid_v4}@example.com"
  user.set_password(BELL_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

def bell_sign_in(user)
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": BELL_PASSWORD}
  )
end

# A score of `owner`'s shared with `reader` to read, and `reader` told of a
# mention in thread "t9" of it: answers the notification.
def bell_mention(owner, reader)
  score = Score.start(owner, Score.blank_source("Rung"))
  ScoreShare.invite(score, reader.email, "read")
  UserNotification.tell(reader._key, "mention", score, owner, {
    "thread_id": "t9",
    "label": "Bar 1, staff 1"
  })
end

describe("AppNotificationsController") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  test("a guest is sent to sign in, and the count is refused") do
    assert_eq(res_status(get("/app/notifications")), 302)
    set_header("Accept", "application/json")
    assert_eq(res_status(get("/app/notifications/unread")), 401)
    clear_headers()
  end

  test("lists one's own notifications, the unread marked, and counts them for the bell") do
    owner = bell_user()
    reader = bell_user()
    bell_mention(owner, reader)
    bell_sign_in(reader)
    page = get("/app/notifications")
    assert_eq(res_status(page), 200)
    assert_contains(res_body(page), "#{owner.email} mentioned you on “Rung”, Bar 1, staff 1")
    assert_contains(res_body(page), "app-notification-unread")
    assert_contains(res_body(page), "Mark all read")
    assert_contains(res_body(page), "data-bell")
    assert_eq(res_json(get("/app/notifications/unread"))["count"], 1)
    bell_sign_in(owner)
    assert_eq(res_json(get("/app/notifications/unread"))["count"], 0)
    assert_not(res_body(get("/app/notifications")).contains("mentioned you"))
  end

  test("opening one reads it and goes to the thread: the read page for a reader, the editor for an editor") do
    owner = bell_user()
    reader = bell_user()
    note = bell_mention(owner, reader)
    bell_sign_in(reader)
    opened = get("/app/notifications/#{note._key}/open")
    assert_eq(res_status(opened), 302)
    score = Score.find(note.score_id)
    assert_eq(res_location(opened), "/s/#{score.share_token}#thread-t9")
    assert(UserNotification.find(note._key).read?)
    ScoreShare.invite(score, reader.email, "write")
    assert_eq(res_location(get("/app/notifications/#{note._key}/open")), "/app/scores/#{score._key}#thread-t9")
  end

  test("a score gone or no longer shared opens the list instead, with a word") do
    owner = bell_user()
    reader = bell_user()
    note = bell_mention(owner, reader)
    ScoreShare.leave(Score.find(note.score_id), reader)
    bell_sign_in(reader)
    opened = get("/app/notifications/#{note._key}/open")
    assert_eq(res_location(opened), "/app/notifications")
    assert_contains(res_body(get("/app/notifications")), "no longer there for you")
  end

  test("nobody opens or marks someone else's (404), and it stays unread") do
    owner = bell_user()
    reader = bell_user()
    note = bell_mention(owner, reader)
    bell_sign_in(owner)
    assert_eq(res_status(get("/app/notifications/#{note._key}/open")), 404)
    assert_eq(res_status(post("/app/notifications/#{note._key}/read", {})), 404)
    assert_eq(res_status(post("/app/notifications/no-such/read", {})), 404)
    assert_not(UserNotification.find(note._key).read?)
  end

  test("marked read one by one, then all at once, one's own only") do
    owner = bell_user()
    reader = bell_user()
    first = bell_mention(owner, reader)
    second = bell_mention(owner, reader)
    other = bell_mention(reader, owner)
    bell_sign_in(reader)
    assert_eq(res_status(post("/app/notifications/#{first._key}/read", {})), 302)
    assert(UserNotification.find(first._key).read?)
    assert_not(UserNotification.find(second._key).read?)
    assert_eq(res_location(post("/app/notifications/read-all", {})), "/app/notifications")
    assert(UserNotification.find(second._key).read?)
    assert_not(UserNotification.find(other._key).read?, "the owner's stays unread")
  end
end

describe("E-mail settings") do
  before_each() do
    as_guest()
    clear_cookies()
  end

  test("the account page shows each kind, all on at first; saved as checked") do
    user = bell_user()
    bell_sign_in(user)
    page = res_body(get("/app/account"))
    assert_contains(page, "id=\"notifications\"")
    assert_contains(page, "value=\"changed\" checked")
    saved = post("/app/account/notifications", {"kinds": [
      "none",
      "reply",
      "mention",
      "bogus"
    ]})
    assert_eq(res_status(saved), 302)
    stored = User.find(user._key)
    assert(stored.mails?("reply"))
    assert(stored.mails?("mention"))
    assert_not(stored.mails?("changed"))
    assert_not(stored.mails?("shared"))
    assert_null(stored.mail_prefs["bogus"])
    assert_not(res_body(get("/app/account")).contains("value=\"changed\" checked"))
  end

  test("a guest cannot change them") do
    assert_eq(res_status(post("/app/account/notifications", {"kinds": ["none"]})), 401)
  end

  test("someone who turned share e-mails off gets no invitation e-mail, only the app's word") do
    owner = bell_user()
    friend = bell_user()
    friend.keep_mail_prefs(["reply"])
    score = Score.start(owner, Score.blank_source("Quiet share"))
    share = ScoreShare.invite(score, friend.email, "read")
    assert_not(share.mail_wanted?)
    assert(ScoreShare.invite(score, "nobody-#{uuid_v4}@example.com", "read").mail_wanted?)
    bell_sign_in(owner)
    invited = post(
      "/app/scores/#{score._key}/invitations",
      {"email": friend.email, "role": "write"}
    )
    assert_eq(res_status(invited), 302)
    assert_not(res_body(get("/app/scores/#{score._key}/share")).contains("could not be sent"))
    assert_eq(UserNotification.where({
      "user_id": friend._key,
      "kind": "shared"
    }).count, 1)
  end
end

describe("The read page's comments") do
  before_each() do
    as_guest()
    clear_cookies()
  end

  test("shown to the people it is shared with, not to a stranger nor a guest of a link") do
    owner = bell_user()
    reader = bell_user()
    score = Score.start(owner, Score.blank_source("Read and said"))
    ScoreShare.invite(score, reader.email, "read")
    score.make_visible("link")
    bell_sign_in(reader)
    page = res_body(get("/s/#{score.share_token}"))
    assert_contains(page, "data-read-comments")
    assert_contains(page, "/app/scores/#{score._key}/comments")
    bell_sign_in(bell_user())
    assert_not(res_body(get("/s/#{score.share_token}")).contains("data-read-comments"))
    clear_cookies()
    assert_not(res_body(get("/s/#{score.share_token}")).contains("data-read-comments"))
  end
end
