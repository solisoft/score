# The room of a score open in the editor: the people in it (presence), and
# each save sent to the others as it happens, so they see it live.
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
const SCORE_ROOM_TICKET_SECONDS = 3600

class ScoreRoom
  static def channel(score_key)
    "score:#{score_key}"
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

  # May `user` be in `score`'s room, and hear its saves? The editor's
  # people: those who may change it, while it is out of the trash.
  static def allowed?(score, user)
    return false if score.nil? || user.nil?
    return false if score.trashed?

    score.writable_by?(user)
  end

  # A ticket for `user` into `score`'s room, good until `now` +
  # SCORE_ROOM_TICKET_SECONDS: "<score>.<user>.<until>.<signature>".
  static def ticket(score, user, now)
    body = "#{score._key}.#{user._key}.#{now + SCORE_ROOM_TICKET_SECONDS}"
    body + "." + Crypto.hmac(body, ScoreRoom.secret)
  end

  # {"score", "user"} the ticket lets in at `now`, or nil.
  static def admit(ticket, now)
    parts = ticket.to_s.split(".")
    return nil unless parts.length == 4

    body = parts[0] + "." + parts[1] + "." + parts[2]
    return nil unless Crypto.secure_compare(Crypto.hmac(body, ScoreRoom.secret), parts[3])
    return nil if parts[2].to_i < now

    {"score": parts[0], "user": parts[1]}
  end

  # The socket's events (app/controllers/score_room_controller.sl): on
  # connect, a valid ticket of someone who still may edit the score joins
  # the room and is seen there; anything else is turned away. Messages from
  # the page are not relayed: saves go through HTTP, which tells the room.
  static def on_event(event, now)
    return {} unless event["type"] == "connect"

    admitted = ScoreRoom.admit((event["query"] ?? {})["ticket"], now)
    return {"send": {"event": "refused"}.to_json} if admitted.nil?

    user = User.find_by("_key", admitted["user"])
    score = Score.find_by("_key", admitted["score"])
    return {"send": {"event": "refused"}.to_json} unless ScoreRoom.allowed?(score, user)

    channel = ScoreRoom.channel(admitted["score"])
    {"join": channel, "track": {
      "channel": channel,
      "user_id": user._key,
      "name": user.email
    }}
  end

  # What the room hears when `score` is saved: its source, its revision,
  # and the editor (`origin`) that saved it.
  static def saved_news(score, origin)
    {
      "event": "saved",
      "revision": score.revision,
      "source": score.source,
      "title": score.title,
      "origin": origin.to_s
    }
  end

  # Who in the room (`presences`, as ws_list_presence answers) still may
  # hear `score`'s saves: {"send": [connection ids], "close": [connection ids]}.
  static def delivery(score, presences)
    send_to = []
    close = []
    presences.each do |presence|
      user = User.find_by("_key", presence["user_id"].to_s)
      ids = (presence["metas"] ?? []).map do |meta|
        meta["connection_id"].to_s
      end
      if ScoreRoom.allowed?(score, user)
        send_to = send_to + ids
      else
        close = close + ids
      end
    end
    {"send": send_to, "close": close}
  end

  # Each save, to the people of the room who still may hear it; the others
  # are shown out.
  static def tell_saved(score, origin)
    presences = ws_list_presence(ScoreRoom.channel(score._key)) rescue []
    ScoreRoom.deliver(ScoreRoom.delivery(score, presences), ScoreRoom.saved_news(score, origin).to_json)
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
