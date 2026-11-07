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
#
# The lobby is the link's (#542): a listener's ticket names the link it was
# given by (a mark of the score's share token, `link_mark`), and the lobby
# keeps them only while that link still opens the score. A new link ("the
# old one stops working"), the score made private or trashed, or an
# invitation removed shows out at once those who no longer hear
# (`show_out`). In the lobby everyone is "A reader": no address, no key.
const SCORE_ROOM_TICKET_SECONDS = 3600
const SCORE_ROOM_ROLES = ["edit", "listen"]
# How long a person found allowed to work in a room is trusted with their
# cursors before their access is read again (#689): a cursor comes four
# times a second, and losing access shows them out at once (`show_out`) or
# at the next save (`tell_saved`) anyway.
const SCORE_ROOM_RECHECK_SECONDS = 30
const SCORE_ROOM_CLEARED_MOST = 10000

class ScoreRoom
  # "<score>:<user>" to until when (unix seconds) they were found allowed to
  # work in the score's room: this process's, forgotten when the score's
  # shares or trash change here (`forget`).
  static cleared: Hash = {}

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
  static def allowed?(score, user, roles = nil)
    return false if score.nil? || user.nil?
    return false if score.trashed?

    score.writable_by?(user, roles)
  end

  # What `user` (nil for someone signed out), in as `role`, may still hear
  # of `score`: "all" (the room: presence, cursors, saves, comments),
  # "saves" (the lobby), or nil: shown out. An editor hears all while they
  # may change it; a listener while they may see it through their account,
  # the saves only while it is open to them by its link or in public — by
  # the link they came in with (`link`, its `link_mark`), still its own.
  # (`current_mark`: the mark of the score's link, when the caller has it;
  # `roles`: the score's shares, address to role, when it has read them.)
  static def hearing(score, user, role, link = nil, current_mark = nil, roles = nil)
    return nil if score.nil? || score.trashed?
    return (ScoreRoom.allowed?(score, user, roles) ? "all" : nil) if role == "edit"
    return nil unless role == "listen"
    return "all" unless score.access_of(user, roles).nil?
    return "saves" if score.readable_by?(user, roles) && ScoreRoom.current_link?(score, link, current_mark)

    nil
  end

  # The mark of a read-page link (a share token) that a listener's ticket
  # and the lobby's presence carry: the link's own, not the link itself.
  # Signed with a key of its own, drawn from the secret (`link_key`), so a
  # mark is never a ticket's signature.
  static def link_mark(token)
    return "" if token.to_s.blank?

    Crypto.hmac(token.to_s, ScoreRoom.link_key)
  end

  static def link_key
    Crypto.hmac("score room link marks", ScoreRoom.secret)
  end

  # The key tickets are signed with (#687): drawn from the secret, as the
  # link marks' and the sign-in's (User.auth_key) are — never the secret
  # itself: a ticket is the secret's HMAC over text the asker partly
  # chooses, and an HMAC of the secret is exactly what those other keys are.
  static def ticket_key
    Crypto.hmac("score room tickets", ScoreRoom.secret)
  end

  # Is `link` (a `link_mark`) the mark of `score`'s link as it now stands
  # (`current_mark`, worked out here when not given)?
  static def current_link?(score, link, current_mark = nil)
    return false if link.to_s.blank? || score.share_token.to_s.blank?

    Crypto.secure_compare(link.to_s, current_mark ?? ScoreRoom.link_mark(score.share_token))
  end

  # A ticket for `user` (nil: someone signed out, on a read page) into
  # `score`'s room as `role`, good until `now` + SCORE_ROOM_TICKET_SECONDS,
  # a listener's by the score's link as it stands (its `link_mark`):
  # "<score>.<user>.<until>.<role>.<link>.<signature>".
  static def ticket(score, user, now, role = "edit")
    link = role == "listen" ? ScoreRoom.link_mark(score.share_token) : ""
    body = "#{score._key}.#{user&._key.to_s}.#{now + SCORE_ROOM_TICKET_SECONDS}.#{role}.#{link}"
    body + "." + Crypto.hmac(body, ScoreRoom.ticket_key)
  end

  # {"score", "user" ("" for someone signed out), "until", "role", "link"}
  # of a ticket signed here, run out or not; nil for one changed by hand or
  # made up.
  static def signed(ticket)
    parts = ticket.to_s.split(".")
    return nil unless parts.length == 6

    body = parts.slice(0, 5).join(".")
    return nil unless Crypto.secure_compare(Crypto.hmac(body, ScoreRoom.ticket_key), parts[5])
    return nil unless SCORE_ROOM_ROLES.includes?(parts[3])

    {
      "score": parts[0],
      "user": parts[1],
      "until": parts[2].to_i,
      "role": parts[3],
      "link": parts[4]
    }
  end

  # {"score", "user", "role", "link"} the ticket lets in at `now`, or nil.
  static def admit(ticket, now)
    parts = ScoreRoom.signed(ticket)
    return nil if parts.nil? || parts["until"] < now

    {
      "score": parts["score"],
      "user": parts["user"],
      "role": parts["role"],
      "link": parts["link"]
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
    hearing = ScoreRoom.hearing(score, user, admitted["role"], admitted["link"])
    return refused if hearing.nil?

    if hearing == "all"
      channel = ScoreRoom.channel(admitted["score"])
      return {"join": channel, "track": {
        "channel": channel,
        "user_id": user._key,
        "name": user.email,
        "role": admitted["role"]
      }}
    end

    # The lobby: everyone a reader, signed in or not, kept by their link.
    channel = ScoreRoom.lobby(admitted["score"])
    {"join": channel, "track": {
      "channel": channel,
      "user_id": "guest",
      "name": "A reader",
      "role": admitted["role"],
      "link": admitted["link"]
    }}
  end

  # Where the page's person works, sent to the others in the room:
  # {"event": "cursor", "lane", "bars": [first, last] (or nil for none),
  # "origin": the editor's id, told as its `origin_tag`}. Relayed only from a connection the room
  # admitted (in `presences`, the room's when not given, under the ticket's
  # person), whose person still may change the score; who it is comes from
  # that presence, never from the message. Anything else is dropped: {}.
  # Their access is read again every SCORE_ROOM_RECHECK_SECONDS (`now`, unix
  # seconds), not for each cursor (`still_allowed?`, #689).
  static def relay_cursor(event, entered, presences = nil, now = nil)
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
    return {} unless ScoreRoom.still_allowed?(entered["score"], entered["user"], now ?? DateTime.utc.to_unix)

    meta = present["metas"].find do |one|
      one["connection_id"].to_s == connection_id
    end
    place = ScoreRoom.place(said["lane"], said["bars"])
    # Named as the room was told when they came in (their presence).
    name = meta["name"] ?? User.find_by("_key", entered["user"])&.email
    news = {
      "event": "cursor",
      "user_id": entered["user"],
      "name": name,
      "connection_id": connection_id,
      "origin": ScoreRoom.origin_tag(said["origin"]),
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

  # May the person whose key is `user_key` still work in the room of the
  # score whose key is `score_key`, at `now`? Read from the database when
  # last found more than SCORE_ROOM_RECHECK_SECONDS ago (or never); trusted
  # until then (#689).
  static def still_allowed?(score_key, user_key, now)
    key = "#{score_key}:#{user_key}"
    return true if (ScoreRoom.cleared[key] ?? 0) > now

    user = nil
    score = nil
    grouped(fn() {
      user = User.find_by("_key", user_key)
      score = Score.find_by("_key", score_key)
    })
    unless ScoreRoom.allowed?(score, user)
      ScoreRoom.cleared.delete(key)
      return false
    end

    # Kept small: past so many people, everyone is read again.
    ScoreRoom.cleared = {} if ScoreRoom.cleared.length >= SCORE_ROOM_CLEARED_MOST
    ScoreRoom.cleared[key] = now + SCORE_ROOM_RECHECK_SECONDS
    true
  end

  # Who may work in the room of the score whose key is `score_key` is read
  # again at their next cursor: its shares or its trash changed (ScoreShare,
  # Score).
  static def forget(score_key)
    prefix = "#{score_key}:"
    ScoreRoom.cleared.keys().each do |key|
      ScoreRoom.cleared.delete(key) if key.starts_with?(prefix)
    end
    true
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

  # The editor (`origin`: the page's own id, sent with its saves, comments
  # and place) behind a news, as the room is told it (#688): its SHA-256,
  # which the page that chose the id recognises and no one can turn back
  # into it. Told as it is, another editor in the room could send it with a
  # save of their own, and the page it belongs to would skip that save as
  # its own. "" for none.
  static def origin_tag(origin)
    text = origin.to_s.substring(0, 64)
    text.blank? ? "" : Crypto.sha256(text)
  end

  # What the room hears when `score` is saved: its source, its revision,
  # the editor (`origin`, as `origin_tag`) that saved it and who saved it
  # (`saved_by`, their key: the room names them, as its presence does).
  static def saved_news(score, origin)
    {
      "event": "saved",
      "revision": score.revision,
      "source": score.source,
      "title": score.title,
      "origin": ScoreRoom.origin_tag(origin),
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
    current_mark = lobby && presences.length > 0 ? ScoreRoom.link_mark(score&.share_token) : nil
    people = ScoreRoom.people_in(score, presences)
    presences.each do |presence|
      user = people["users"][presence["user_id"].to_s]
      (presence["metas"] ?? []).each do |meta|
        hearing = ScoreRoom.hearing(score, user, meta["role"] ?? "edit", meta["link"], current_mark, people["roles"])
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

  # The people of `presences`, and what `score` is shared with them as, read
  # for the whole room in two reads (#689) — not each person, then their share,
  # one after the other: {"users": key to user, "roles": address to role}.
  # The lobby's readers ("guest") are nobody to read.
  static def people_in(score, presences)
    keys = presences.map do |presence|
      presence["user_id"].to_s
    end.filter do |key|
      key.present? && key != "guest"
    end.uniq
    found = {"users": {}, "roles": {}}
    return found if keys.length == 0

    users = User.where("doc._key IN @keys", {"keys": keys}).all
    shares = []
    unless score.nil?
      emails = users.map(&:email)
      shares = ScoreShare.where(
        "doc.score_id == @score AND doc.email IN @emails",
        {"score": score._key, "emails": emails}
      ).all
    end
    users.each do |user|
      found["users"][user._key] = user
    end
    shares.each do |share|
      found["roles"][share.email] = share.role
    end
    found
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

  # Those of the room and of its lobby who no longer may hear `score`,
  # shown out now rather than at its next save: after a new link, the score
  # made private or trashed, an invitation removed, left or lowered to
  # read only (AppScoresController). (Who goes is `show_out_delivery`'s to say.)
  static def show_out(score)
    close = ScoreRoom.show_out_delivery(
      score,
      ScoreRoom.presences(ScoreRoom.channel(score._key)),
      ScoreRoom.presences(ScoreRoom.lobby(score._key))
    )
    ScoreRoom.deliver(
      {"send": [], "close": close},
      ""
    )
  end

  # The connections of the room (`room_presences`) and of its lobby
  # (`lobby_presences`), as ws_list_presence answers, that no longer may
  # hear `score` (`hearing`): those `show_out` closes. Nobody is sent
  # anything.
  static def show_out_delivery(score, room_presences, lobby_presences)
    room = ScoreRoom.delivery(score, room_presences)
    lobby = ScoreRoom.delivery(score, lobby_presences, true)
    room["close"] + lobby["close"]
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
      "origin": ScoreRoom.origin_tag(origin)
    }
  end

  # Comment threads moved by a save (#392): their bars, or their staff,
  # went elsewhere (ScoreThread.follow), each as the editor shows it.
  static def moved_news(thread_views, origin)
    {
      "event": "comments",
      "threads": thread_views,
      "origin": ScoreRoom.origin_tag(origin)
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
