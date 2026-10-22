# The room of a score open in the editor: the people in it (presence), and
# each save sent to the others as it happens, so they see it live.
#
# A page enters with a ticket the editor page hands out: who, which score,
# until when, signed (HMAC) with the server's secret — the socket's upgrade
# request carries no session to check. A save is sent to the room by the
# save itself (AppScoresController#update), with the editor's own id, so the
# editor that saved skips its own news.
const SCORE_ROOM_TICKET_SECONDS = 43200

class ScoreRoom
  static def channel(score_key)
    "score:#{score_key}"
  end

  static def secret
    getenv("SOLI_SESSION_SECRET") ?? getenv("APP_SECRET") ?? "eui-score-development-room-secret"
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
  # connect, a valid ticket joins the room and is seen there; anything else
  # is turned away. Messages from the page are not relayed: saves go through
  # HTTP, which tells the room.
  static def on_event(event, now)
    return {} unless event["type"] == "connect"

    admitted = ScoreRoom.admit((event["query"] ?? {})["ticket"], now)
    return {"send": {"event": "refused"}.to_json} if admitted.nil?

    user = User.find_by("_key", admitted["user"])
    return {"send": {"event": "refused"}.to_json} if user.nil?

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

  static def tell_saved(score, origin)
    ws_broadcast_room(ScoreRoom.channel(score._key), ScoreRoom.saved_news(score, origin).to_json) rescue nil
  end
end
