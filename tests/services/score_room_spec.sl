# The room of a score open in the editor: who gets in, and what it hears.

def room_user
  user = User.new()
  user.email = "room-#{uuid_v4}@example.com"
  user.set_password("correct horse battery")
  user.save
  user
end

describe("ScoreRoom") do
  test("a ticket lets its holder into its score's room, until it runs out") do
    user = room_user()
    score = Score.start(user, Score.blank_source("Together"))
    now = DateTime.utc.to_unix
    ticket = ScoreRoom.ticket(score, user, now)
    admitted = ScoreRoom.admit(ticket, now)
    assert_eq(admitted["score"], score._key)
    assert_eq(admitted["user"], user._key)
    assert_null(ScoreRoom.admit(ticket, now + SCORE_ROOM_TICKET_SECONDS + 1))
  end

  test("a ticket changed by hand, or made up, lets nobody in") do
    user = room_user()
    score = Score.start(user, Score.blank_source("Guarded"))
    ticket = ScoreRoom.ticket(score, user, DateTime.utc.to_unix)
    parts = ticket.split(".")
    other_score = parts[0].reverse + "." + parts[1] + "." + parts[2] + "." + parts[3]
    assert_null(ScoreRoom.admit(other_score, DateTime.utc.to_unix))
    assert_null(ScoreRoom.admit("nonsense", DateTime.utc.to_unix))
    assert_null(ScoreRoom.admit(nil, DateTime.utc.to_unix))
  end

  test("connecting with a ticket joins the room and is seen there; without one, is refused") do
    user = room_user()
    score = Score.start(user, Score.blank_source("Live"))
    now = DateTime.utc.to_unix
    event = {
      "type": "connect",
      "connection_id": "c1",
      "query": {"ticket": ScoreRoom.ticket(score, user, now)}
    }
    joined = ScoreRoom.on_event(event, now)
    assert_eq(joined["join"], "score:#{score._key}")
    assert_eq(joined["track"]["user_id"], user._key)
    assert_eq(joined["track"]["name"], user.email)
    refused = ScoreRoom.on_event(
      {"type": "connect", "query": {"ticket": "forged"}},
      now
    )
    assert_contains(refused["send"], "refused")
    assert_eq(ScoreRoom.on_event(
      {"type": "message", "message": "hello"},
      now
    ), {})
  end

  test("a save is told to the room with the score as it now stands") do
    user = room_user()
    score = Score.start(user, Score.blank_source("News"))
    news = ScoreRoom.saved_news(score, "editor-1")
    assert_eq(news["revision"], score.revision)
    assert_eq(news["origin"], "editor-1")
    assert_contains(news["source"], "News")
  end

  test("a ticket lasts an hour, and an expired one is refused at the door") do
    user = room_user()
    score = Score.start(user, Score.blank_source("Hourly"))
    issued = DateTime.utc.to_unix
    ticket = ScoreRoom.ticket(score, user, issued)
    assert_eq(SCORE_ROOM_TICKET_SECONDS, 3600)
    assert_not_null(ScoreRoom.admit(ticket, issued + 3600))
    assert_null(ScoreRoom.admit(ticket, issued + 3601))
    refused = ScoreRoom.on_event(
      {"type": "connect", "query": {"ticket": ticket}},
      issued + 3601
    )
    assert_contains(refused["send"], "refused")
    assert_null(refused["join"])
  end

  test("a well-signed ticket of someone the score is not shared with is refused") do
    owner = room_user()
    stranger = room_user()
    score = Score.start(owner, Score.blank_source("Mine"))
    now = DateTime.utc.to_unix
    refused = ScoreRoom.on_event(
      {"type": "connect", "query": {"ticket": ScoreRoom.ticket(score, stranger, now)}},
      now
    )
    assert_contains(refused["send"], "refused")
    assert_null(refused["join"])
  end

  test("shared to read only, removed, trashed or deleted: the door stays shut") do
    owner = room_user()
    friend = room_user()
    score = Score.start(owner, Score.blank_source("Closing"))
    now = DateTime.utc.to_unix
    connect = {"type": "connect", "query": {"ticket": ScoreRoom.ticket(score, friend, now)}}
    share = ScoreShare.invite(score, friend.email, "write")
    assert_eq(ScoreRoom.on_event(connect, now)["join"], "score:#{score._key}")
    ScoreShare.invite(score, friend.email, "read")
    assert_contains(ScoreRoom.on_event(connect, now)["send"], "refused")
    ScoreShare.invite(score, friend.email, "write")
    share.delete
    assert_contains(ScoreRoom.on_event(connect, now)["send"], "refused")
    owners = {"type": "connect", "query": {"ticket": ScoreRoom.ticket(score, owner, now)}}
    assert_eq(ScoreRoom.on_event(owners, now)["join"], "score:#{score._key}")
    score.move_to_trash
    assert_contains(ScoreRoom.on_event(owners, now)["send"], "refused")
    score.delete
    assert_contains(ScoreRoom.on_event(owners, now)["send"], "refused")
  end

  test("once the invitation is removed, saves go to the others and the person is shown out") do
    owner = room_user()
    friend = room_user()
    score = Score.start(owner, Score.blank_source("Ensemble"))
    share = ScoreShare.invite(score, friend.email, "write")
    presences = [
      {"user_id": owner._key, "metas": [{"connection_id": "owner-tab-1"}, {"connection_id": "owner-tab-2"}]},
      {"user_id": friend._key, "metas": [{"connection_id": "friend-tab"}]},
      {"user_id": "no-such-user", "metas": [{"connection_id": "ghost-tab"}]}
    ]
    before = ScoreRoom.delivery(score, presences)
    assert_eq(before["send"], [
      "owner-tab-1",
      "owner-tab-2",
      "friend-tab"
    ])
    assert_eq(before["close"], ["ghost-tab"])
    share.delete
    after = ScoreRoom.delivery(score, presences)
    assert_eq(after["send"], ["owner-tab-1", "owner-tab-2"])
    assert_eq(after["close"], ["friend-tab", "ghost-tab"])
    score.move_to_trash
    trashed = ScoreRoom.delivery(score, presences)
    assert_eq(trashed["send"], [])
    assert_eq(trashed["close"].length, 4)
  end

  # (tell_saved and deliver reach the socket runtime, which only the server
  # has: they run in the controller specs' saves.)
  test("an empty room: nobody to tell, nobody to show out") do
    user = room_user()
    score = Score.start(user, Score.blank_source("Empty room"))
    assert_eq(
      ScoreRoom.delivery(score, []),
      {"send": [], "close": []}
    )
  end

  test("tickets are signed with the server's secret, and there is no stand-in for it") do
    assert_eq(ScoreRoom.secret_from("session-secret", "app-secret"), "session-secret")
    assert_eq(ScoreRoom.secret_from(nil, "app-secret"), "app-secret")
    assert_eq(ScoreRoom.secret_from("", "app-secret"), "app-secret")
    assert_raises("set SOLI_SESSION_SECRET") do
      ScoreRoom.secret_from(nil, "")
    end
    assert_raises("set SOLI_SESSION_SECRET") do
      ScoreRoom.secret_from(nil, nil)
    end
  end
end
