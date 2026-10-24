# The room of a score open in the editor: the people in it (presence), each
# save sent to the others as it happens, so they see it live, and where each
# of them is working (their selection: a staff and its bars).
#
# A page enters with a ticket the editor page hands out: who, which score,
# until when, signed (HMAC) with the server's secret — the socket's upgrade
# request carries no session to check. A save is sent to the room by the
# save itself (AppScoresController#update), with the editor's own id, so the
# editor that saved skips its own news.
#
# A ticket only opens the door: the person's access to the score is checked
# when they come in, and again before each save is sent to them, so someone
# whose invitation is removed, or whose score goes to the trash or is
# deleted, hears nothing more and is shown out. Tickets last an hour; the
# editor asks for a fresh one (AppScoresController#room_ticket) each time it
# (re)connects.
#
# Two roles (#392), named in the ticket: "edit", the editor's, and "listen",
# the read page's (SharedScoresController#room_ticket). A listener relays no
# cursor. Those who may see the score through their account (its owner and
# the people it is shared with) listen in the room itself: the presence, the
# others' cursors, the saves and the comments. Anyone else the score is
# open to — by its link, or in public — listens from its lobby
# (`lobby`): the saves only, with no presence of the room's people (their
# addresses) and no comments, which are for the people of the score.
const SCORE_ROOM_TICKET_SECONDS = 3600
const SCORE_ROOM_ROLES = ["edit", "listen"]

class ScoreRoom
  static def channel(score_key)
    "score:#{score_key}"
  end

  # Where those the score is open to by its link listen: saves only.
  static def lobby(score_key)
    "score:#{score_key}:lobby"
  end

  # The secret tickets are signed with: the server's own, never a value
  # written here. Without one, no ticket is made or taken.
  static def secret
    ScoreRoom.secret_from(getenv("SOLI_SESSION_SECRET"), getenv("APP_SECRET"))
  end

  static def secret_from(session_secret, app_secret)
    return session_secret.to_s if session_secret.present?
    return app_secret.to_s if app_secret.present?

    throw "ScoreRoom: set SOLI_SESSION_SECRET (or APP_SECRET) to sign the room's tickets"
  end

  # May `user` be in `score`'s room as an editor, relay where they work and
  # hear its saves? Those who may change it, while it is out of the trash.
  static def allowed?(score, user)
    return false if score.nil? || user.nil?
    return false if score.trashed?

    score.writable_by?(user)
  end

  # What `user` (nil for someone signed out), in as `role`, may still hear
  # of `score`: "all" (the room: presence, cursors, saves, comments),
  # "saves" (the lobby), or nil: shown out. An editor hears all while they
  # may change it; a listener while they may see it through their account,
  # the saves only while it is open to them by its link or in public.
  static def hearing(score, user, role)
    return nil if score.nil? || score.trashed?
    return (ScoreRoom.allowed?(score, user) ? "all" : nil) if role == "edit"
    return nil unless role == "listen"
    return "all" unless score.access_of(user).nil?
    return "saves" if score.readable_by?(user)

    nil
  end

  # A ticket for `user` (nil: someone signed out, on a read page) into
  # `score`'s room as `role`, good until `now` + SCORE_ROOM_TICKET_SECONDS:
  # "<score>.<user>.<until>.<role>.<signature>".
  static def ticket(score, user, now, role = "edit")
    body = "#{score._key}.#{user&._key.to_s}.#{now + SCORE_ROOM_TICKET_SECONDS}.#{role}"
    body + "." + Crypto.hmac(body, ScoreRoom.secret)
  end

  # {"score", "user" ("" for someone signed out), "until", "role"} of a
  # ticket signed here, run out or not; nil for one changed by hand or made up.
  static def signed(ticket)
    parts = ticket.to_s.split(".")
    return nil unless parts.length == 5

    body = parts.slice(0, 4).join(".")
    return nil unless Crypto.secure_compare(Crypto.hmac(body, ScoreRoom.secret), parts[4])
    return nil unless SCORE_ROOM_ROLES.includes?(parts[3])

    {
      "score": parts[0],
      "user": parts[1],
      "until": parts[2].to_i,
      "role": parts[3]
    }
  end

  # {"score", "user", "role"} the ticket lets in at `now`, or nil.
  static def admit(ticket, now)
    parts = ScoreRoom.signed(ticket)
    return nil if parts.nil? || parts["until"] < now

    {
      "score": parts["score"],
      "user": parts["user"],
      "role": parts["role"]
    }
  end

  # The socket's events (app/controllers/score_room_controller.sl): on
  # connect, a valid ticket of someone who still may edit the score joins
  # the room and is seen there; anything else is turned away. From the page,
  # only where its person is working (a "cursor") is relayed to the room
  # (`relay_cursor`); saves go through HTTP, which tells the room. When a
  # page goes, its cursor goes with it.
  static def on_event(event, now)

    # Not `type`: a bare assignment to that name replaces the builtin type()
    # for the whole app (the readiness check stopped reading the job queue).
    event_type = event["type"]
    return ScoreRoom.on_connect(event, now) if event_type == "connect"

    # The room a message or a leaving page is of: its ticket's, which was
    # checked at the door (a connection refused there is in no presence).
    entered = ScoreRoom.signed((event["query"] ?? {})["ticket"])
    return {} if entered.nil?

    channel = ScoreRoom.channel(entered["score"])
    return ScoreRoom.relay_cursor(event, entered) if event_type == "message"
    return ScoreRoom.cursor_gone(event, channel) if event_type == "disconnect"

    {}
  end

  # Who is in `channel`, as ws_list_presence answers (the socket runtime's:
  # only the server has it).
  static def presences(channel)
    ws_list_presence(channel) rescue []
  end

  static def on_connect(event, now)
    refused = {"send": {"event": "refused"}.to_json}
    admitted = ScoreRoom.admit((event["query"] ?? {})["ticket"], now)
    return refused if admitted.nil?

    user = admitted["user"].blank? ? nil : User.find_by("_key", admitted["user"])
    return refused if user.nil? && !admitted["user"].blank?

    score = Score.find_by("_key", admitted["score"])
    hearing = ScoreRoom.hearing(score, user, admitted["role"])
    return refused if hearing.nil?

    channel = hearing == "all" ? ScoreRoom.channel(admitted["score"]) : ScoreRoom.lobby(admitted["score"])
    {"join": channel, "track": {
      "channel": channel,
      "user_id": user&._key ?? "guest",
      "name": user.nil? ? "A reader" : user.email,
      "role": admitted["role"]
    }}
  end

  # Where the page's person works, sent to the others in the room:
  # {"event": "cursor", "lane", "bars": [first, last] (or nil for none),
  # "origin": the editor's id}. Relayed only from a connection the room
  # admitted (in `presences`, the room's when not given, under the ticket's
  # person), whose person still may change the score; who it is comes from
  # that presence, never from the message. Anything else is dropped: {}.
  static def relay_cursor(event, entered, presences = nil)
    said = JSON.parse(event["message"].to_s) rescue nil
    return {} unless said.is_a?("hash") && said["event"] == "cursor"

    presences ??= ScoreRoom.presences(ScoreRoom.channel(entered["score"]))
    connection_id = event["connection_id"].to_s
    present = presences.find do |presence|
      (presence["metas"] ?? []).any? do |meta|
        meta["connection_id"].to_s == connection_id
      end
    end
    return {} if present.nil? || present["user_id"].to_s != entered["user"]
    # A listener (the read page) is in the room to hear, not to be seen working.
    return {} unless entered["role"] == "edit"

    user = User.find_by("_key", entered["user"])
    return {} unless ScoreRoom.allowed?(Score.find_by("_key", entered["score"]), user)

    meta = present["metas"].find do |one|
      one["connection_id"].to_s == connection_id
    end
    place = ScoreRoom.place(said["lane"], said["bars"])
    news = {
      "event": "cursor",
      "user_id": user._key,
      "name": meta["name"] ?? user.email,
      "connection_id": connection_id,
      "origin": said["origin"].to_s.substring(0, 64),
      "lane": place["lane"],
      "bars": place["bars"]
    }
    {"broadcast_channel": {"channel": ScoreRoom.channel(entered["score"]), "message": news.to_json}}
  end

  # A lane (0 to 63) and its bars [first, last] (0 to 9999, in order) as the
  # page sent them, or both nil: what does not read as one is no place.
  static def place(lane, bars)
    nowhere = {"lane": nil, "bars": nil}
    return nowhere unless lane.is_a?("int") && lane >= 0 && lane < 64
    return nowhere unless bars.is_a?("array") && bars.length == 2
    unless bars.all?(&{ |bar|
      bar.is_a?("int") && bar >= 0 && bar < 10000
    })
      return nowhere
    end

    return nowhere if bars[0] > bars[1]

    {"lane": lane, "bars": [bars[0], bars[1]]}
  end

  # A page gone: its cursor is taken away from the others' scores.
  static def cursor_gone(event, channel)
    gone = {
      "event": "cursor",
      "connection_id": event["connection_id"].to_s,
      "lane": nil,
      "bars": nil,
      "gone": true
    }
    {"broadcast_channel": {"channel": channel, "message": gone.to_json}}
  end

  # What the room hears when `score` is saved: its source, its revision,
  # the editor (`origin`) that saved it and who saved it (`saved_by`, their
  # key: the room names them, as its presence does).
  static def saved_news(score, origin)
    {
      "event": "saved",
      "revision": score.revision,
      "source": score.source,
      "title": score.title,
      "origin": origin.to_s,
      "saved_by": score.saved_by.to_s
    }
  end

  # Who in the room (`presences`, as ws_list_presence answers; the lobby's
  # when `lobby`) still may be there: {"send": [connection ids], "close":
  # [connection ids]}. Each connection by its role (an editor's when its
  # presence names none): in the room, those who still hear all
  # (`hearing`); in the lobby, those who still may read the score.
  static def delivery(score, presences, lobby = false)
    send_to = []
    close = []
    presences.each do |presence|
      user = User.find_by("_key", presence["user_id"].to_s)
      (presence["metas"] ?? []).each do |meta|
        hearing = ScoreRoom.hearing(score, user, meta["role"] ?? "edit")
        stays = lobby ? !hearing.nil? : hearing == "all"
        if stays
          send_to = send_to + [meta["connection_id"].to_s]
        else
          close = close + [meta["connection_id"].to_s]
        end
      end
    end
    {"send": send_to, "close": close}
  end

  # Each save, to the people of the room and of its lobby who still may hear
  # it; the others are shown out.
  static def tell_saved(score, origin)
    news = ScoreRoom.saved_news(score, origin).to_json
    presences = ws_list_presence(ScoreRoom.channel(score._key)) rescue []
    ScoreRoom.deliver(ScoreRoom.delivery(score, presences), news)
    listeners = ws_list_presence(ScoreRoom.lobby(score._key)) rescue []
    ScoreRoom.deliver(ScoreRoom.delivery(score, listeners, true), news)
  end

  # What the room hears when a comment thread of the score changes (#385):
  # the thread as the editor shows it (ScoreThread#view), or the key of one
  # gone ("gone"), with the editor (`origin`) that changed it, which skips
  # its own news.
  static def comments_news(thread_view, gone, origin)
    {
      "event": "comments",
      "thread": thread_view,
      "gone": gone,
      "origin": origin.to_s.substring(0, 64)
    }
  end

  # Comment threads moved by a save (#392): their bars, or their staff,
  # went elsewhere (ScoreThread.follow), each as the editor shows it.
  static def moved_news(thread_views, origin)
    {
      "event": "comments",
      "threads": thread_views,
      "origin": origin.to_s.substring(0, 64)
    }
  end

  # Each change to the comments, sent from the HTTP endpoint that made it
  # (AppCommentsController) to the people of the room who still may be in
  # it, as `tell_saved` sends a save; the others are shown out.
  static def tell_comments(score, news)
    presences = ws_list_presence(ScoreRoom.channel(score._key)) rescue []
    ScoreRoom.deliver(ScoreRoom.delivery(score, presences), news.to_json)
  end

  static def deliver(delivery, message)
    delivery["close"].each do |connection_id|
      ws_close(connection_id, "no longer shared") rescue nil
    end
    delivery["send"].each do |connection_id|
      ws_send(connection_id, message) rescue nil
    end
  end
end
