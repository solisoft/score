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
    # Reading an event's type must not replace the builtin type() for the
    # whole app: the readiness check needs it.
    assert_eq(type("a word"), "string")
  end

  test("a save is told to the room with the score as it now stands") do
    user = room_user()
    score = Score.start(user, Score.blank_source("News"))
    news = ScoreRoom.saved_news(score, "editor-1")
    assert_eq(news["revision"], score.revision)
    assert_eq(news["origin"], Crypto.sha256("editor-1"))
    assert_contains(news["source"], "News")
    # Who saved it, by key: the editors name them from the room's presence.
    assert_eq(news["saved_by"], user._key)
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

  test("a comment's news names its thread, or the thread gone, and the editor it came from") do
    news = ScoreRoom.comments_news({
      "id": "t1",
      "messages": []
    }, nil, "editor-2")
    assert_eq(news["event"], "comments")
    assert_eq(news["thread"]["id"], "t1")
    assert_null(news["gone"])
    assert_eq(news["origin"], Crypto.sha256("editor-2"))
    gone = ScoreRoom.comments_news(nil, "t1", "x" * 100)
    assert_eq(gone["gone"], "t1")
    assert_null(gone["thread"])
    assert_eq(gone["origin"], Crypto.sha256("x" * 64), "an origin is kept short")
  end

  # (tell_saved, tell_comments and deliver reach the socket runtime, which
  # only the server has: they run in the controller specs' saves and comments.)
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

# A page's message over the socket, from connection `connection_id`.
def cursor_event(connection_id, said)
  {
    "type": "message",
    "connection_id": connection_id,
    "message": said.to_json
  }
end

describe("ScoreRoom, where each person works") do
  test("a cursor from an admitted connection is relayed to the room, named from its presence") do
    owner = room_user()
    score = Score.start(owner, Score.blank_source("Cursors"))
    entered = ScoreRoom.signed(ScoreRoom.ticket(score, owner, DateTime.utc.to_unix))
    presences = [{"user_id": owner._key, "metas": [{
      "connection_id": "conn-a",
      "name": "Olivia"
    }]}]
    said = {
      "event": "cursor",
      "origin": "editor-1",
      "lane": 1,
      "bars": [3, 5],
      "user_id": "forged",
      "name": "Mallory"
    }
    relayed = ScoreRoom.relay_cursor(cursor_event("conn-a", said), entered, presences)
    assert_eq(relayed["broadcast_channel"]["channel"], "score:#{score._key}")
    news = JSON.parse(relayed["broadcast_channel"]["message"])
    assert_eq(news["event"], "cursor")
    # Who it is comes from the room, never from the page.
    assert_eq(news["user_id"], owner._key)
    assert_eq(news["name"], "Olivia")
    assert_eq(news["connection_id"], "conn-a")
    assert_eq(news["origin"], Crypto.sha256("editor-1"))
    assert_eq(news["lane"], 1)
    assert_eq(news["bars"], [3, 5])
  end

  test("nothing is relayed from a connection the room did not admit, or under someone else's ticket") do
    owner = room_user()
    friend = room_user()
    score = Score.start(owner, Score.blank_source("Strangers"))
    ScoreShare.invite(score, friend.email, "write")
    entered = ScoreRoom.signed(ScoreRoom.ticket(score, owner, DateTime.utc.to_unix))
    said = {
      "event": "cursor",
      "lane": 0,
      "bars": [0, 0]
    }
    presences = [{"user_id": friend._key, "metas": [{"connection_id": "friend-tab"}]}]
    # Not in the room at all.
    assert_eq(ScoreRoom.relay_cursor(cursor_event("unknown-tab", said), entered, presences), {})
    assert_eq(ScoreRoom.relay_cursor(cursor_event("unknown-tab", said), entered, []), {})
    # In the room, but as another person than the ticket's.
    assert_eq(ScoreRoom.relay_cursor(cursor_event("friend-tab", said), entered, presences), {})
  end

  test("nothing is relayed once the person may no longer change the score") do
    owner = room_user()
    friend = room_user()
    score = Score.start(owner, Score.blank_source("Leaving"))
    share = ScoreShare.invite(score, friend.email, "write")
    entered = ScoreRoom.signed(ScoreRoom.ticket(score, friend, DateTime.utc.to_unix))
    presences = [{"user_id": friend._key, "metas": [{"connection_id": "friend-tab"}]}]
    event = cursor_event(
      "friend-tab",
      {
        "event": "cursor",
        "lane": 0,
        "bars": [1, 2]
      }
    )
    assert_not_null(ScoreRoom.relay_cursor(event, entered, presences)["broadcast_channel"])
    share.delete
    assert_eq(ScoreRoom.relay_cursor(event, entered, presences), {})
    owners = ScoreRoom.signed(ScoreRoom.ticket(score, owner, DateTime.utc.to_unix))
    mine = [{"user_id": owner._key, "metas": [{"connection_id": "owner-tab"}]}]
    owner_event = cursor_event(
      "owner-tab",
      {
        "event": "cursor",
        "lane": 0,
        "bars": [1, 2]
      }
    )
    assert_not_null(ScoreRoom.relay_cursor(owner_event, owners, mine)["broadcast_channel"])
    score.move_to_trash
    assert_eq(ScoreRoom.relay_cursor(owner_event, owners, mine), {})
  end

  test("only cursors are relayed: other messages, and text that is not JSON, are dropped") do
    owner = room_user()
    score = Score.start(owner, Score.blank_source("Chatter"))
    entered = ScoreRoom.signed(ScoreRoom.ticket(score, owner, DateTime.utc.to_unix))
    presences = [{"user_id": owner._key, "metas": [{"connection_id": "tab"}]}]
    assert_eq(ScoreRoom.relay_cursor(cursor_event(
      "tab",
      {"event": "saved", "source": "x"}
    ), entered, presences), {})
    assert_eq(ScoreRoom.relay_cursor({
      "type": "message",
      "connection_id": "tab",
      "message": "hello"
    }, entered, presences), {})
    assert_eq(ScoreRoom.relay_cursor(cursor_event("tab", [1, 2]), entered, presences), {})
    # A cursor with no place: relayed as none (the selection let go).
    relayed = ScoreRoom.relay_cursor(cursor_event("tab", {"event": "cursor"}), entered, presences)
    news = JSON.parse(relayed["broadcast_channel"]["message"])
    assert_null(news["lane"])
    assert_null(news["bars"])
    assert_eq(news["name"], owner.email)
  end

  test("a place that does not read as one is no place") do
    assert_eq(
      ScoreRoom.place(2, [4, 7]),
      {"lane": 2, "bars": [4, 7]}
    )
    assert_eq(
      ScoreRoom.place(0, [0, 0]),
      {"lane": 0, "bars": [0, 0]}
    )
    nowhere = {"lane": nil, "bars": nil}
    assert_eq(ScoreRoom.place(nil, nil), nowhere)
    assert_eq(ScoreRoom.place(-1, [0, 1]), nowhere)
    assert_eq(ScoreRoom.place(64, [0, 1]), nowhere)
    assert_eq(ScoreRoom.place("1", [0, 1]), nowhere)
    assert_eq(ScoreRoom.place(1, [5, 4]), nowhere)
    assert_eq(ScoreRoom.place(1, [0]), nowhere)
    assert_eq(ScoreRoom.place(1, [0, 10000]), nowhere)
    assert_eq(ScoreRoom.place(1, ["a", 2]), nowhere)
    assert_eq(ScoreRoom.place(1, "0-2"), nowhere)
  end

  test("a page that goes takes its cursor away from the others") do
    owner = room_user()
    score = Score.start(owner, Score.blank_source("Goodbye"))
    ticket = ScoreRoom.ticket(score, owner, DateTime.utc.to_unix)
    gone = ScoreRoom.on_event(
      {
        "type": "disconnect",
        "connection_id": "conn-z",
        "query": {"ticket": ticket}
      },
      DateTime.utc.to_unix
    )
    assert_eq(gone["broadcast_channel"]["channel"], "score:#{score._key}")
    news = JSON.parse(gone["broadcast_channel"]["message"])
    assert_eq(news["connection_id"], "conn-z")
    assert_eq(news["gone"], true)
    assert_null(news["bars"])
  end

  test("messages under a forged ticket, or none, are dropped; outside the server, nobody is in the room") do
    owner = room_user()
    score = Score.start(owner, Score.blank_source("Forged"))
    now = DateTime.utc.to_unix
    said = {
      "event": "cursor",
      "lane": 0,
      "bars": [0, 1]
    }.to_json
    assert_eq(ScoreRoom.on_event(
      {
        "type": "message",
        "connection_id": "c",
        "message": said,
        "query": {"ticket": "forged"}
      },
      now
    ), {})
    assert_eq(ScoreRoom.on_event(
      {
        "type": "disconnect",
        "connection_id": "c",
        "query": {}
      },
      now
    ), {})
    ticket = ScoreRoom.ticket(score, owner, now)
    # A well-signed ticket: what is not a cursor is dropped before the room is asked.
    assert_eq(ScoreRoom.on_event(
      {
        "type": "message",
        "connection_id": "c",
        "message": "hello",
        "query": {"ticket": ticket}
      },
      now
    ), {})
    assert_eq(ScoreRoom.on_event(
      {"type": "ping", "query": {"ticket": ticket}},
      now
    ), {})
    # Run out, a ticket still names its room once its connection is in.
    assert_eq(ScoreRoom.signed(ticket)["score"], score._key)
    assert_null(ScoreRoom.signed(ticket.replace(score._key, "other")))
  end
end

# A connection's arrival with a ticket for `user` (nil: signed out) as `role`.
def listen_connect(score, user, role)
  now = DateTime.utc.to_unix
  ScoreRoom.on_event(
    {
      "type": "connect",
      "connection_id": "c-#{role}",
      "query": {"ticket": ScoreRoom.ticket(score, user, now, role)}
    },
    now
  )
end

# The lobby's presence of `connection_ids`, each come in as a guest with a
# ticket for `score`'s link as it stands, tracked as on_connect tracks them.
def lobby_listeners(score, connection_ids)
  now = DateTime.utc.to_unix
  ticket = ScoreRoom.ticket(score, nil, now, "listen")
  track = ScoreRoom.on_event(
    {"type": "connect", "query": {"ticket": ticket}},
    now
  )["track"]
  metas = connection_ids.map do |connection_id|
    {
      "connection_id": connection_id,
      "role": track["role"],
      "link": track["link"],
      "name": track["name"]
    }
  end
  [{"user_id": track["user_id"], "metas": metas}]
end

describe("ScoreRoom, listening from the read page (#392)") do
  test("a reader is admitted to listen only: in the room, seen as listening") do
    owner = room_user()
    reader = room_user()
    score = Score.start(owner, Score.blank_source("Listened"))
    ScoreShare.invite(score, reader.email, "read")
    joined = listen_connect(score, reader, "listen")
    assert_eq(joined["join"], "score:#{score._key}")
    assert_eq(joined["track"]["user_id"], reader._key)
    assert_eq(joined["track"]["role"], "listen")
    assert_eq(ScoreRoom.hearing(score, reader, "listen"), "all")
    # As an editor, the same reader is refused: the role is the ticket's, the right the score's.
    assert_contains(listen_connect(score, reader, "edit")["send"], "refused")
  end

  test("a listener relays no cursor, an editor reading from the read page included") do
    owner = room_user()
    score = Score.start(owner, Score.blank_source("Quiet"))
    entered = ScoreRoom.signed(ScoreRoom.ticket(score, owner, DateTime.utc.to_unix, "listen"))
    presences = [{"user_id": owner._key, "metas": [{
      "connection_id": "read-tab",
      "role": "listen"
    }]}]
    said = cursor_event(
      "read-tab",
      {
        "event": "cursor",
        "lane": 0,
        "bars": [0, 1]
      }
    )
    assert_eq(ScoreRoom.relay_cursor(said, entered, presences), {})
    editing = ScoreRoom.signed(ScoreRoom.ticket(score, owner, DateTime.utc.to_unix))
    assert_not_null(
      ScoreRoom.relay_cursor(said, editing, presences)["broadcast_channel"],
      "the same page as an editor's is relayed"
    )
  end

  test("a guest with only the link of a private score is refused; once it is open by link, admitted to the lobby") do
    owner = room_user()
    stranger = room_user()
    score = Score.start(owner, Score.blank_source("Private"))
    assert_contains(listen_connect(score, nil, "listen")["send"], "refused")
    assert_contains(listen_connect(score, stranger, "listen")["send"], "refused")
    assert_contains(listen_connect(score, nil, "edit")["send"], "refused")
    score.make_visible("link")
    guest = listen_connect(score, nil, "listen")
    assert_eq(guest["join"], "score:#{score._key}:lobby")
    assert_eq(guest["track"]["user_id"], "guest")
    assert_eq(guest["track"]["name"], "A reader", "nobody's address")
    signed_in = listen_connect(score, stranger, "listen")
    assert_eq(signed_in["join"], "score:#{score._key}:lobby", "outside the score, signed in or not: the lobby")
    assert_eq(ScoreRoom.hearing(score, nil, "listen", ScoreRoom.link_mark(score.share_token)), "saves")
    # By its link only (#542): without it, nothing.
    assert_null(ScoreRoom.hearing(score, nil, "listen"))
    score.make_visible("public")
    assert_eq(listen_connect(score, nil, "listen")["join"], "score:#{score._key}:lobby")
  end

  test("a ticket for an account that is gone, or with a role made up, lets nobody in") do
    owner = room_user()
    score = Score.start(owner, Score.blank_source("Roles"))
    score.make_visible("link")
    ghost = room_user()
    ticket = ScoreRoom.ticket(score, ghost, DateTime.utc.to_unix, "listen")
    ghost.delete
    assert_contains(ScoreRoom.on_event(
      {"type": "connect", "query": {"ticket": ticket}},
      DateTime.utc.to_unix
    )["send"], "refused")
    assert_null(ScoreRoom.signed(ScoreRoom.ticket(score, owner, DateTime.utc.to_unix, "admin")))
    assert_null(ScoreRoom.hearing(score, owner, "admin"))
    assert_null(ScoreRoom.hearing(nil, owner, "listen"))
  end

  test("a revoked reader is shown out of the room; the editors stay") do
    owner = room_user()
    reader = room_user()
    score = Score.start(owner, Score.blank_source("Revoked"))
    share = ScoreShare.invite(score, reader.email, "read")
    presences = [
      {"user_id": owner._key, "metas": [{
        "connection_id": "owner-tab",
        "role": "edit"
      }]},
      {"user_id": reader._key, "metas": [{
        "connection_id": "reader-tab",
        "role": "listen"
      }]}
    ]
    assert_eq(ScoreRoom.delivery(score, presences)["send"], ["owner-tab", "reader-tab"])
    share.delete
    after = ScoreRoom.delivery(score, presences)
    assert_eq(after["send"], ["owner-tab"])
    assert_eq(after["close"], ["reader-tab"])
    # Open by link, the former reader still may not stay in the room: the lobby is theirs.
    score.make_visible("link")
    assert_eq(ScoreRoom.delivery(score, presences)["close"], ["reader-tab"])
  end

  test("the lobby keeps its listeners while the link opens the score, and shows them out once private or trashed") do
    owner = room_user()
    score = Score.start(owner, Score.blank_source("Lobby"))
    score.make_visible("link")
    # As the lobby tracks them: by the link they came in with (#542).
    listeners = lobby_listeners(score, ["guest-1", "guest-2"])
    assert_eq(ScoreRoom.delivery(score, listeners, true)["send"], ["guest-1", "guest-2"])
    # The room itself is not theirs.
    assert_eq(ScoreRoom.delivery(score, listeners)["close"], ["guest-1", "guest-2"])
    score.make_visible("private")
    assert_eq(ScoreRoom.delivery(score, listeners, true)["close"], ["guest-1", "guest-2"])
    score.make_visible("link")
    score.move_to_trash
    assert_eq(ScoreRoom.delivery(score, listeners, true)["send"], [])
  end

  test("a signed-in outsider in the lobby is a reader like any other: no address, no key (#542)") do
    owner = room_user()
    stranger = room_user()
    score = Score.start(owner, Score.blank_source("Nameless"))
    score.make_visible("link")
    joined = listen_connect(score, stranger, "listen")
    assert_eq(joined["join"], "score:#{score._key}:lobby")
    assert_eq(joined["track"]["user_id"], "guest")
    assert_eq(joined["track"]["name"], "A reader")
    assert_not(joined["track"].to_json.contains("@"), "nobody's address in the lobby's presence")
    assert_not(joined["track"].to_json.contains(stranger._key), "nor their account's key")
    # In the room, among the people of the score, a name stays a name.
    reader = room_user()
    ScoreShare.invite(score, reader.email, "read")
    inside = listen_connect(score, reader, "listen")
    assert_eq(inside["join"], "score:#{score._key}")
    assert_eq(inside["track"]["name"], reader.email)
  end

  test("a new link shows the old one's listeners out, and its tickets open nothing (#542)") do
    owner = room_user()
    reader = room_user()
    score = Score.start(owner, Score.blank_source("Relinked"))
    score.make_visible("link")
    ScoreShare.invite(score, reader.email, "read")
    now = DateTime.utc.to_unix
    old_ticket = ScoreRoom.ticket(score, nil, now, "listen")
    readers_ticket = ScoreRoom.ticket(score, reader, now, "listen")
    old_link = {"type": "connect", "query": {"ticket": old_ticket}}
    assert_eq(ScoreRoom.on_event(old_link, now)["join"], "score:#{score._key}:lobby")
    listeners = lobby_listeners(score, ["old-tab"])
    assert_eq(ScoreRoom.delivery(score, listeners, true)["send"], ["old-tab"])
    score.new_link
    after = ScoreRoom.delivery(score, listeners, true)
    assert_eq(after["send"], [], "no save reaches the old link's listener")
    assert_eq(after["close"], ["old-tab"])
    assert_contains(ScoreRoom.on_event(old_link, now)["send"], "refused")
    assert_null(ScoreRoom.hearing(score, nil, "listen", ScoreRoom.signed(old_ticket)["link"]))
    # The new link's ticket gets in; the people of the score, by their account, still do.
    fresh = {"type": "connect", "query": {"ticket": ScoreRoom.ticket(score, nil, now, "listen")}}
    assert_eq(ScoreRoom.on_event(fresh, now)["join"], "score:#{score._key}:lobby")
    readers = {"type": "connect", "query": {"ticket": readers_ticket}}
    assert_eq(ScoreRoom.on_event(readers, now)["join"], "score:#{score._key}")
    # A ticket with its link changed by hand is no ticket.
    parts = old_ticket.split(".")
    parts[4] = ScoreRoom.link_mark(score.share_token)
    assert_null(ScoreRoom.signed(parts.join(".")))
  end

  # #688: told as it is, an editor's id could be sent back by another editor
  # with a save of their own, which the page it belongs to would then skip.
  test("the room hears an editor's tag, never its id; a tag sent back is not the same tag") do
    tag = ScoreRoom.origin_tag("editor-secret")
    assert_eq(tag, Crypto.sha256("editor-secret"))
    assert_not(tag.contains("editor-secret"))
    assert_ne(ScoreRoom.origin_tag(tag), tag, "a tag sent as an origin names no one")
    assert_eq(ScoreRoom.origin_tag(nil), "")
    assert_eq(ScoreRoom.origin_tag(""), "")
    user = room_user()
    score = Score.start(user, Score.blank_source("Tagged"))
    [
      ScoreRoom.saved_news(score, "editor-secret"),
      ScoreRoom.comments_news(nil, "t1", "editor-secret"),
      ScoreRoom.moved_news([], "editor-secret")
    ].each do |news|
      assert_eq(news["origin"], tag)
      assert_not(news.to_json.contains("editor-secret"))
    end
  end

  test("comment threads moved by a save are news of their own, the editor that saved named") do
    news = ScoreRoom.moved_news([{"id": "t1"}, {"id": "t2"}], "editor-9")
    assert_eq(news["event"], "comments")
    assert_eq(news["threads"].length, 2)
    assert_eq(news["origin"], Crypto.sha256("editor-9"))
  end
end

# One person's presence in the room: `user`, by each of `metas` (a connection
# id and its role).
def room_presence(user, metas)
  {"user_id": user._key, "metas": metas.map do |meta|
    {"connection_id": meta[0], "role": meta[1]}
  end}
end

describe("ScoreRoom, shown out at once (#542)") do
  test("a new link: the old link's listeners go, the new one's and the people of the score stay") do
    owner = room_user()
    reader = room_user()
    score = Score.start(owner, Score.blank_source("Old and new"))
    score.make_visible("link")
    ScoreShare.invite(score, reader.email, "read")
    old_listeners = lobby_listeners(score, ["old-1", "old-2"])
    room = [room_presence(owner, [["owner-tab", "edit"]]), room_presence(reader, [["reader-tab", "listen"]])]
    assert_eq(ScoreRoom.show_out_delivery(score, room, old_listeners), [], "nobody goes while the link stands")
    score.new_link
    new_listeners = lobby_listeners(score, ["new-1"])
    lobby = [old_listeners[0], new_listeners[0]]
    assert_eq(ScoreRoom.show_out_delivery(score, room, lobby), ["old-1", "old-2"])
  end

  test("made private: the link's listeners go, the people it is shared with stay") do
    owner = room_user()
    writer = room_user()
    score = Score.start(owner, Score.blank_source("Closing"))
    score.make_visible("link")
    ScoreShare.invite(score, writer.email, "write")
    lobby = lobby_listeners(score, ["guest-1"])
    room = [
      room_presence(owner, [["owner-tab", "edit"]]),
      room_presence(writer, [["writer-tab", "edit"], ["writer-read", "listen"]])
    ]
    score.make_visible("private")
    assert_eq(ScoreRoom.show_out_delivery(score, room, lobby), ["guest-1"])
  end

  test("an invitation removed, or left: that person goes, in every tab, and nobody else") do
    owner = room_user()
    writer = room_user()
    reader = room_user()
    score = Score.start(owner, Score.blank_source("Fewer"))
    share = ScoreShare.invite(score, writer.email, "write")
    ScoreShare.invite(score, reader.email, "read")
    room = [
      room_presence(owner, [["owner-tab", "edit"]]),
      room_presence(writer, [["writer-tab", "edit"], ["writer-read", "listen"]]),
      room_presence(reader, [["reader-tab", "listen"]])
    ]
    assert_eq(ScoreRoom.show_out_delivery(score, room, []), [])
    share.delete
    assert_eq(ScoreRoom.show_out_delivery(score, room, []), ["writer-tab", "writer-read"])
    assert(ScoreShare.leave(score, reader))
    assert_eq(ScoreRoom.show_out_delivery(score, room, []), [
      "writer-tab",
      "writer-read",
      "reader-tab"
    ])
  end

  test("invited again to read only: their editor goes, their read page stays") do
    owner = room_user()
    writer = room_user()
    score = Score.start(owner, Score.blank_source("Downgraded"))
    ScoreShare.invite(score, writer.email, "write")
    room = [
      room_presence(owner, [["owner-tab", "edit"]]),
      room_presence(writer, [["writer-tab", "edit"], ["writer-read", "listen"]])
    ]
    assert_eq(ScoreRoom.show_out_delivery(score, room, []), [])
    ScoreShare.invite(score, writer.email, "read")
    assert_eq(ScoreRoom.show_out_delivery(score, room, []), ["writer-tab"])
  end

  test("in the trash: everyone goes, its owner and the link's listeners included") do
    owner = room_user()
    reader = room_user()
    score = Score.start(owner, Score.blank_source("Binned"))
    score.make_visible("link")
    ScoreShare.invite(score, reader.email, "read")
    lobby = lobby_listeners(score, ["guest-1"])
    room = [
      room_presence(owner, [["owner-tab", "edit"], ["owner-read", "listen"]]),
      room_presence(reader, [["reader-tab", "listen"]])
    ]
    score.move_to_trash
    assert_eq(ScoreRoom.show_out_delivery(score, room, lobby), [
      "owner-tab",
      "owner-read",
      "reader-tab",
      "guest-1"
    ])
  end

  test("a link mark is not a ticket's signature, and changes with the link") do
    owner = room_user()
    score = Score.start(owner, Score.blank_source("Marked"))
    score.make_visible("link")
    mark = ScoreRoom.link_mark(score.share_token)
    assert_ne(mark, Crypto.hmac(score.share_token, ScoreRoom.secret))
    assert_ne(mark, Crypto.hmac("link:#{score.share_token}", ScoreRoom.secret))
    assert_eq(ScoreRoom.link_mark(""), "")
    score.new_link
    assert_ne(ScoreRoom.link_mark(score.share_token), mark)
    assert_not(ScoreRoom.current_link?(score, mark))
    assert(ScoreRoom.current_link?(score, ScoreRoom.link_mark(score.share_token)))
  end

  test("a ticket is signed with a key drawn from the secret, never the secret itself (#687)") do
    owner = room_user()
    score = Score.start(owner, Score.blank_source("Keyed"))
    ticket = ScoreRoom.ticket(score, owner, DateTime.utc.to_unix)
    parts = ticket.split(".")
    body = parts.slice(0, 5).join(".")
    assert_eq(parts[5], Crypto.hmac(body, ScoreRoom.ticket_key))
    assert_ne(parts[5], Crypto.hmac(body, ScoreRoom.secret), "not the raw secret's")
    assert_ne(ScoreRoom.ticket_key, ScoreRoom.secret)
    assert_ne(ScoreRoom.ticket_key, ScoreRoom.link_key)
    assert_ne(ScoreRoom.ticket_key, User.auth_key("sign-in"))
    # One signed with the raw secret, as before #687, is not taken.
    raw = body + "." + Crypto.hmac(body, ScoreRoom.secret)
    assert_null(ScoreRoom.signed(raw))
    assert_not_null(ScoreRoom.signed(ticket))
  end
end
