# What the app tells someone (#385), in its list (the bell) and by e-mail:
# a score shared with them ("shared"), a reply in a thread they wrote in
# ("reply"), their name after an @ in a comment ("mention"), and a score
# they may see changed by someone else ("changed": one per score per person
# per NOTIFICATION_CHANGED_SECONDS, which gathers who changed it). Nobody is
# told of what they did themselves.
#
# Every notification is listed in the app, and sent to the person's devices
# when they turned push notifications on (WebPush, #400). The e-mails leave from
# NotificationMailJob (`mail_due`), each as its person's settings allow
# (User#mails?): "mail" is "pending" until then, "sending" while a run of
# the job has claimed it (`mail_due`), "sent", "off" (not wanted),
# "failed" (NOTIFICATION_MAIL_TRIES tries), or "none" for a share, whose
# invitation e-mail (AppScoresController#invite) tells of it already. The
# changes are mailed together, in one digest a person, once their hour is over.
const NOTIFICATION_KINDS = [
  "shared",
  "reply",
  "mention",
  "changed"
]
const NOTIFICATION_CHANGED_SECONDS = 3600
const NOTIFICATIONS_LISTED = 100
const NOTIFICATION_MAIL_TRIES = 3
# How long a run of the mails keeps the notifications it claimed (#685)
# before another may take them: past it, the run that claimed them stopped.
const NOTIFICATION_CLAIM_SECONDS = 3600
const NOTIFICATION_EXCERPT_LENGTH = 140

class UserNotification < Model
  validates("user_id", {"presence": true})
  validates("kind", {"inclusion": NOTIFICATION_KINDS})

  # The user whose key is `user_key` told of `kind` on `score`, done by
  # `actor`; `extra` may hold the thread ("thread_id"), its place ("label")
  # and the start of the comment ("excerpt"). Answers the notification, or
  # nil for the actor themself.
  static def tell(user_key, kind, score, actor, extra = {})
    return nil if user_key.blank? || user_key == actor._key

    notification = UserNotification.create({
      "user_id": user_key,
      "kind": kind,
      "score_id": score._key,
      "score_title": score.title,
      "actor_ids": [actor._key],
      "actor_names": [actor.display_name],
      "thread_id": extra["thread_id"],
      "label": extra["label"],
      "excerpt": extra["excerpt"],
      "created_at": DateTime.utc.to_unix,
      "read_at": nil,
      "mail": kind == "shared" ? "none" : "pending",
      "mail_tries": 0
    })
    # To their devices too, when they turned push on (#400).
    WebPush.queue(notification)
    notification
  end

  # `share` made by `actor`: its person told in the app, if they have an
  # account (the invitation e-mail is theirs either way).
  static def shared(share, score, actor)
    user = User.find_by("email", share.email)
    return nil if user.nil?

    UserNotification.tell(user._key, "shared", score, actor)
  end

  # `comment` written in `thread` of `score` by `actor`: the people of the
  # score it names with an @ are told so; the others who wrote in the thread
  # before, of a reply (once each, a mention first). Answers how many were told.
  static def commented(thread, comment, score, actor)
    people = ScoreShare.people_of(score)
    keys = people.map(&:_key)
    mentioned = ScoreComment.mentioned(comment.body, people).map(&:_key)
    earlier = thread.writers.filter do |key|
      keys.includes?(key) && !mentioned.includes?(key)
    end
    extra = {
      "thread_id": thread._key,
      "label": thread.label,
      "excerpt": UserNotification.excerpt(comment.body)
    }
    told = mentioned.map do |key|
      UserNotification.tell(key, "mention", score, actor, extra)
    end
    + earlier.map do |key|
      UserNotification.tell(key, "reply", score, actor, extra)
    end
    told.filter do |notification|
      !notification.nil?
    end.length
  end

  # `score` saved by `actor`: everyone else who may see it is told, once an
  # hour a score: within the hour, `actor` joins the names of the
  # notification already made. Answers how many new ones were made.
  #
  # Every save asks (AppScoresController#update): who may see the score (as
  # ScoreShare.people_of: its owner, and those it is shared with who have an
  # account) and this hour's notifications are read in one query (#689),
  # and a notification read again only to add `actor` to it.
  static def changed(score, actor)
    since = DateTime.utc.to_unix - NOTIFICATION_CHANGED_SECONDS
    score_key = score._key
    owner = score.user_id
    found = @sdbql{
      LET emails = (FOR s IN score_shares FILTER s.score_id == #{score_key} LIMIT 500 RETURN s.email)
      LET people = (FOR u IN users FILTER u._key == #{owner} OR u.email IN emails LIMIT 501 RETURN u._key)
      LET hour = (
        FOR n IN user_notifications
        FILTER n.score_id == #{score_key} AND n.kind == "changed" AND n.created_at >= #{since}
        LIMIT 1000
        RETURN {"key": n._key, "user_id": n.user_id, "actor_ids": n.actor_ids}
      )
      RETURN {"people": people, "hour": hour}
    }
    raise("The change could not be told: #{found}") if found.is_a?("string")

    by_user = {}
    found[0]["hour"].each do |notification|
      by_user[notification["user_id"]] = notification
    end
    made = 0
    for person_key in found[0]["people"]
      next if person_key == actor._key

      group = by_user[person_key]
      if group.nil?
        UserNotification.tell(person_key, "changed", score, actor)
        made = made + 1
      elsif !(group["actor_ids"] ?? []).includes?(actor._key)
        UserNotification.find_by("_key", group["key"])&.joined_by(actor)
      end
    end
    made
  end

  # `actor` among those who changed the score, in this hour's notification.
  def joined_by(actor)
    return false if (@actor_ids ?? []).includes?(actor._key)

    @actor_ids = (@actor_ids ?? []) + [actor._key]
    @actor_names = (@actor_names ?? []) + [actor.display_name]
    # The names alone (#685): saved whole, this copy put back the read mark
    # and the mail's state as it had read them — a mail sent since went
    # "pending" again, and was sent twice.
    UserNotification.where({"_key": @_key}).update_all({
      "actor_ids": @actor_ids,
      "actor_names": @actor_names
    })
    true
  end

  static def excerpt(body)
    text = Regex.replace_all("\\s+", body.to_s.trim, " ")
    return text if text.chars().length <= NOTIFICATION_EXCERPT_LENGTH

    text.substring(0, NOTIFICATION_EXCERPT_LENGTH - 1) + "…"
  end

  # `user`'s latest NOTIFICATIONS_LISTED, the latest first.
  static def recent(user)
    UserNotification.where({"user_id": user._key}).order("created_at", "desc").limit(NOTIFICATIONS_LISTED).all
  end

  static def unread_of(user)
    UserNotification.where("doc.user_id == @user AND doc.read_at == null", {"user": user._key})
  end

  static def unread_count(user)
    UserNotification.unread_of(user).count
  end

  # `user`'s notification whose key is `key`, or nil: nobody else's.
  static def of(user, key)
    notification = UserNotification.find_by("_key", key.to_s)
    return nil if notification.nil? || notification.user_id != user._key

    notification
  end

  def read!
    return true unless @read_at.nil?

    @read_at = DateTime.utc.to_unix
    # The mark alone (#685), as `joined_by` writes its names.
    UserNotification.where({"_key": @_key}).update_all({"read_at": @read_at})
    true
  end

  def read?
    !@read_at.nil?
  end

  # Every unread notification of `user`'s read now. Answers how many.
  static def read_all(user)
    unread = UserNotification.unread_of(user)
    count = unread.count
    unread.update_all({"read_at": DateTime.utc.to_unix})
    count
  end

  # The people who did it, said: "Ana", "Ana and Ben", "Ana, Ben and Chloé"
  # (in `locale`, #505: "Ana et Ben").
  def actors_said(locale = "en")
    names = (@actor_names ?? []).map do |name|
      name.to_s
    end
    return SiteText.t("app.notifications.someone", {}, locale) if names.length == 0
    return names[0] if names.length == 1

    SiteText.t("app.notifications.and", {
      "first": names.slice(0, names.length - 1).join(", "),
      "last": names[names.length - 1]
    }, locale)
  end

  # The notification, in a sentence: in English unless `locale` says
  # otherwise (#505) — the app's list asks in its own language; the e-mails
  # and pushes stay in English.
  def sentence(locale = "en")
    key = @kind == "changed" ? "changed_#{(this.actor_names ?? []).length > 1 ? "other" : "one"}" : @kind
    place = @label.blank? ? "" : ", #{this.label}"
    words = {
      "actors": @actors_said(locale),
      "place": place,
      "title": this.score_title.to_s
    }
    SiteText.t("app.notifications.#{key}", words, locale)
  end

  # The e-mails due at `now` sent (NotificationMailJob): a reply or a mention
  # each its own, the changes whose hour is over in one digest a person.
  # Those the person turned off, or whose person is gone, are not sent.
  # Answers {"sent", "off", "failed", "waiting"}: messages, and
  # notifications not sent or waiting for their hour.
  #
  # Each mail's notifications are claimed before it is sent (`claimed`,
  # #685): "pending" becomes "sending" in the stored rows, and only the
  # rows this run turned so are mailed. Two runs at once — one slow to send,
  # the next one due — read the same rows "pending"; without the claim
  # both sent them. Rows a run claimed and never marked (it stopped) go back
  # to "pending" after NOTIFICATION_CLAIM_SECONDS.
  static def mail_due(now)
    done = {
      "sent": 0,
      "off": 0,
      "failed": 0,
      "waiting": 0
    }
    UserNotification.where(
      "doc.mail == 'sending' AND doc.claimed_at < @since",
      {"since": now - NOTIFICATION_CLAIM_SECONDS}
    ).update_all({"mail": "pending"})
    rows = UserNotification.where({"mail": "pending"}).order("created_at", "asc").limit(1000).all
    return done if rows.length == 0

    users = User.where("doc._key IN @keys", {"keys": rows.map(&:user_id).uniq}).all
    by_key = {}
    users.each do |user|
      by_key[user._key] = user
    end
    closes = now - NOTIFICATION_CHANGED_SECONDS
    digests = {}
    for row in rows
      user = by_key[row.user_id]
      if user.nil? || !user.mails?(row.kind)
        UserNotification.where({
          "_key": row._key,
          "mail": "pending"
        }).update_all({"mail": "off"})
        done["off"] = done["off"] + 1
        next
      end
      if row.kind != "changed"
        UserNotification.send_claimed([row], user, now, done)
        next
      end
      if row.created_at > closes
        done["waiting"] = done["waiting"] + 1
        next
      end

      digests[user._key] = (digests[user._key] ?? []) + [row]
    end
    for key in digests.keys()
      UserNotification.send_claimed(digests[key], by_key[key], now, done)
    end
    done
  end

  # `rows`, `user`'s, claimed, and the one mail they make sent of those
  # this run claimed — a reply or a mention its own, changes a digest — then
  # marked (`mailed`). Nothing is sent when another run claimed them all.
  static def send_claimed(rows, user, now, done)
    claimed = UserNotification.claimed(rows, now)
    return false if claimed.length == 0

    sent = false
    if claimed[0].kind == "changed"
      sent = MailDelivery.attempt_mail("changes digest", NotificationMail.digest(claimed, user))
    else
      sent = MailDelivery.attempt_mail("#{claimed[0].kind} notification", NotificationMail.single(claimed[0], user))
    end
    UserNotification.mailed(claimed, sent, now, done)
    true
  end

  # Those of `rows` still "pending" in the database, turned "sending" at
  # `now` in one statement: the ones this run may mail.
  static def claimed(rows, now)
    keys = rows.map(&:_key)
    taken = @sdbql{
      FOR n IN user_notifications
      FILTER n._key IN #{keys} AND n.mail == "pending"
      UPDATE n WITH {mail: "sending", claimed_at: #{now}} IN user_notifications
      RETURN NEW._key
    }
    throw "UserNotification.claimed: #{taken}" if type(taken) == "string"
    rows.filter do |row|
      taken.includes?(row._key)
    end
  end

  # `rows`, mailed together: "sent", or tried once more ("failed" after
  # NOTIFICATION_MAIL_TRIES), counted in `done`.
  static def mailed(rows, sent, now, done)
    for row in rows
      row.mail_tries = (row.mail_tries ?? 0) + 1
      row.mail = sent ? "sent" : (row.mail_tries >= NOTIFICATION_MAIL_TRIES ? "failed" : "pending")
      fields = {"mail_tries": row.mail_tries, "mail": row.mail}
      if sent
        row.mailed_at = now
        fields["mailed_at"] = now
      end
      # Its mail's fields alone (#685): not the read mark.
      UserNotification.where({"_key": row._key}).update_all(fields)
    end
    outcome = sent ? "sent" : "failed"
    done[outcome] = done[outcome] + 1
  end

  # Gone with their person (User#erase_account).
  static def delete_all_of(user)
    UserNotification.where({"user_id": user._key}).delete_all
  end
end
