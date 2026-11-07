# A score shared with someone, by email: "read" lets them open it, "write"
# lets them change it too. The address need not have an account yet: the
# share is theirs once they sign up with it.
const SCORE_SHARE_ROLES = ["read", "write"]
# A person may send SCORE_INVITATIONS_PER_DAY invitations in any 24 hours;
# an account confirmed less than SCORE_NEW_ACCOUNT_DAYS ago,
# SCORE_INVITATIONS_NEW_ACCOUNT_PER_DAY (#687): an invitation mails a
# stranger words its sender chose (the score's title), and an account made
# for that should not send many.
const SCORE_INVITATIONS_PER_DAY = 50
const SCORE_INVITATIONS_NEW_ACCOUNT_PER_DAY = 10
const SCORE_NEW_ACCOUNT_DAYS = 7

class ScoreShare < Model
  validates("score_id", {"presence": true})
  validates(
    "email",
    {"presence": true, "format": "email"}
  )
  validates("role", {"inclusion": SCORE_SHARE_ROLES})

  # Share `score` with `email` as `role`; sharing again changes the role.
  # Answers the share, or a hash with "error" when it cannot be.
  static def invite(score, email, role)
    address = email.to_s.trim.downcase
    owner = User.find_by("_key", score.user_id)
    return {"error": SiteText.t("app.scores.invite.own_address")} if !owner.nil? && owner.email == address
    return {"error": SiteText.t("app.scores.invite.choose_role")} unless SCORE_SHARE_ROLES.includes?(role)

    share = ScoreShare.where({"score_id": score._key, "email": address}).first
    share = ScoreShare.new() if share.nil?
    share.score_id = score._key
    share.owner_id = score.user_id
    share.email = address
    share.role = role
    share.created_at ||= DateTime.utc.to_unix
    return {"error": SiteText.t("app.scores.invite.not_an_email")} unless share.save

    share
  end

  # Share `score` as `invite` does, on `user`'s say: refused, with nothing
  # written or mailed, once they have sent the day's invitations. Each
  # invitation sent (a new share, or a role changed, which mails again)
  # counts for 24 hours, even once the share is gone. `open`: whether
  # payments are open (Plan.limits); nil asks Stripe's settings.
  #
  # The invitation's place in the day is taken in the account as it is
  # stored (`take_invitation`, #685), and given back when the invitation is
  # refused: counted from the copy each request had read, invitations sent
  # together all passed the count, and each wrote its list over the others'.
  static def invite_by(user, score, email, role, open = nil)
    return ScoreShare.used_up(user) if ScoreShare.invitations_left(user) <= 0

    full = ScoreShare.plan_refusal(score, email, open)
    return full unless full.nil?

    now = DateTime.utc.to_unix
    return ScoreShare.used_up(user) unless ScoreShare.take_invitation(user, now)

    share = ScoreShare.invite(score, email, role)
    ScoreShare.give_back_invitation(user, now) if type(share) == "hash"
    share
  end

  # The refusal once `user` has sent the day's invitations.
  static def used_up(user)
    {"error": SiteText.t("app.scores.invite.used_up", {"n": ScoreShare.invitations_per_day(user)}), "limit": true}
  end

  # One more invitation by `user` at `now`, written into the stored account
  # in one statement that keeps the last 24 hours' and adds this one: false,
  # and nothing written, once the day's are all sent. Nothing else of the
  # account is written.
  static def take_invitation(user, now)
    key = user._key
    since = now - 86400
    most = ScoreShare.invitations_per_day(user)
    taken = @sdbql{
      FOR u IN users
      FILTER u._key == #{key}
      LET kept = (FOR sent IN (u.invitations_sent == null ? [] : u.invitations_sent) FILTER sent > #{since} RETURN sent)
      FILTER LENGTH(kept) < #{most}
      UPDATE u WITH {invitations_sent: APPEND(kept, [#{now}])} IN users
      RETURN NEW.invitations_sent
    }
    throw "ScoreShare.take_invitation: #{taken}" if type(taken) == "string"
    return false if taken.length == 0

    user.invitations_sent = taken[0]
    true
  end

  # The invitation `take_invitation` counted at `now` given back: it was
  # refused, and nothing was sent.
  static def give_back_invitation(user, now)
    key = user._key
    kept = @sdbql{
      FOR u IN users
      FILTER u._key == #{key}
      LET others = (
        FOR sent IN (u.invitations_sent == null ? [] : u.invitations_sent) FILTER sent != #{now} RETURN sent
      )
      UPDATE u WITH {invitations_sent: others} IN users
      RETURN NEW.invitations_sent
    }
    throw "ScoreShare.give_back_invitation: #{kept}" if type(kept) == "string"
    user.invitations_sent = kept[0] if kept.length > 0
    true
  end

  # Why `email` may not be one more person `score` is shared with, under its
  # owner's plan (#393, Plan: three people on Free), or nil. Only a new
  # person counts: a role changed is not refused, and the shares made
  # before a limit applied keep working.
  static def plan_refusal(score, email, open = nil)
    owner = User.find_by("_key", score.user_id)
    most = Plan.limits(owner, open)["people_per_score"]
    return nil if most.nil?

    address = email.to_s.trim.downcase
    if ScoreShare.where({"score_id": score._key, "email": address}).count > 0
      return nil
    end

    return nil if ScoreShare.where({"score_id": score._key}).count < most

    full = SiteText.t("app.scores.invite.plan_full", {"n": most})
    {"error": full, "upgrade": true}
  end

  # How many more invitations `user` may send now.
  static def invitations_left(user)
    [ScoreShare.invitations_per_day(user) - ScoreShare.sent_today(user).length, 0].max()
  end

  # How many invitations `user` may send in 24 hours: fewer while the
  # account is new — its address confirmed less than SCORE_NEW_ACCOUNT_DAYS
  # ago, or not at all.
  static def invitations_per_day(user)
    confirmed = user.confirmed_at.to_s.to_i
    settled = confirmed > 0 && DateTime.utc.to_unix - confirmed >= SCORE_NEW_ACCOUNT_DAYS * 86400
    settled ? SCORE_INVITATIONS_PER_DAY : SCORE_INVITATIONS_NEW_ACCOUNT_PER_DAY
  end

  # When `user` sent the invitations of the last 24 hours (unix seconds).
  static def sent_today(user)
    since = DateTime.utc.to_unix - 86400
    (user.invitations_sent ?? []).filter do |sent|
      sent > since
    end
  end

  # What the owner reads once `share` is made on the score titled `title`:
  # `mailed` says whether the invitation email left. When it did not, the
  # notice says so, so the owner sends the link themselves.
  static def invited_notice(share, title, mailed)
    words = {"email": share.email, "title": title}
    kind = share.role == "write" ? "write" : "read"
    return SiteText.t("app.scores.invite.done_#{kind}", words) if mailed

    SiteText.t("app.scores.invite.unmailed_#{kind}", words)
  end

  # Whether the invitation is e-mailed: always to an address without an
  # account; to an account, unless its person turned share e-mails off (#385).
  def mail_wanted?
    user = User.find_by("email", @email)
    user.nil? || user.mails?("shared")
  end

  # What `user` may do with `score` through a share: "read", "write" or nil.
  static def role_for(score, user)
    return nil if user.nil?

    share = ScoreShare.where({"score_id": score._key, "email": user.email}).first
    share&.role
  end

  static def of(score)
    ScoreShare.where({"score_id": score._key}).order("email", "asc").all
  end

  # The people who may see `score` through their account (#385): its owner,
  # and those it is shared with who have one, as users, each once.
  static def people_of(score)
    emails = ScoreShare.where({"score_id": score._key}).limit(500).all.map(&:email)
    User.where(
      "doc._key == @owner OR doc.email IN @emails",
      {"owner": score.user_id, "emails": emails}
    ).limit(501).all
  end

  # The people of `score` an @ may name in a comment (#392), as the comment
  # boxes list them: [{"key", "name", "email"}], by name. Only the score's
  # (`people_of`): its owner and those it is shared with who have an account.
  static def mentionable(score)
    people = ScoreShare.people_of(score).map do |person|
      {
        "key": person._key,
        "name": person.name.to_s.trim,
        "email": person.email
      }
    end
    people.sort_by(fn(person) { (person["name"].blank? ? person["email"] : person["name"]).downcase })
  end

  # The scores shared with `user`, out of the trash, each with the role, the
  # share (to leave it) and who shared it (their owner's name, or "" when
  # their account is gone): [{"score", "role", "share", "owner"}]. The
  # shares, then their scores (as a list shows them, Score.listed) and
  # their owners together: two round-trips however many there are.
  static def shared_with(user)
    shares = ScoreShare.where({"email": user.email}).limit(500).all
    return [] if shares.length == 0

    keys = shares.map(&:score_id)
    live = Score.where("doc._key IN @keys AND doc.trashed_at == null", {"keys": keys})
    scores = []
    owner_rows = []
    grouped(fn() {
      scores = Score.listed(live).limit(500).all
      owner_rows = User.named(shares.map(&:owner_id)).all
    })
    owners = User.names_in(owner_rows)
    by_key = {}
    scores.each do |score|
      by_key[score._key] = score
    end
    shares.filter do |share|
      by_key.has_key(share.score_id)
    end.map do |share|
      score = by_key[share.score_id]
      {
        "score": score,
        "role": share.role,
        "share": share._key,
        "owner": owners[score.user_id].to_s
      }
    end
  end

  # `user` no longer has `score` shared with them: their share goes, and
  # the score is left as it is, its owner's. False when it was not shared
  # with them (their own score among them).
  static def leave(score, user)
    share = ScoreShare.where({"score_id": score._key, "email": user.email}).first
    return false if share.nil?

    share.delete
    true
  end

  # `user` now reads at `new_email` what was shared with them at
  # `old_email`. Where a score was already shared with the new address too,
  # one share stays, with the stronger role ("write" over "read"); a share
  # of their own score made to the new address goes, since they own it.
  # Answers how many shares moved or merged.
  static def move_address(old_email, new_email, user)
    moving = []
    waiting = []
    grouped(fn() {
      moving = ScoreShare.where({"email": old_email}).all
      waiting = ScoreShare.where({"email": new_email}).all
    })
    waiting.filter do |share|
      share.owner_id == user._key
    end.each do |share|
      share.delete
    end
    by_score = {}
    waiting.each do |share|
      by_score[share.score_id] = share
    end
    moving.each do |share|
      already = by_score[share.score_id]
      if already.nil? || already.owner_id == user._key
        share.email = new_email
        share.update()
      else
        if share.role == "write" && already.role != "write"
          already.role = "write"
          already.update()
        end
        share.delete
      end
    end
    moving.length
  end

  static def delete_all_for(score)
    ScoreShare.where({"score_id": score._key}).delete_all
  end

  # Everything shared by or with `user`: their account is going.
  static def delete_all_of(user)
    ScoreShare.where({"owner_id": user._key}).delete_all
    ScoreShare.where({"email": user.email}).delete_all
  end
end
