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
end
