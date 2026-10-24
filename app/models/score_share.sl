# A score shared with someone, by email: "read" lets them open it, "write"
# lets them change it too. The address need not have an account yet: the
# share is theirs once they sign up with it.
const SCORE_SHARE_ROLES = ["read", "write"]
# A person may send SCORE_INVITATIONS_PER_DAY invitations in any 24 hours.
const SCORE_INVITATIONS_PER_DAY = 50

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
    return {"error": "That is your own address."} if !owner.nil? && owner.email == address
    return {"error": "Choose read or write."} unless SCORE_SHARE_ROLES.includes?(role)

    share = ScoreShare.where({"score_id": score._key, "email": address}).first
    share = ScoreShare.new() if share.nil?
    share.score_id = score._key
    share.owner_id = score.user_id
    share.email = address
    share.role = role
    share.created_at ||= DateTime.utc.to_unix
    return {"error": "That is not an email address."} unless share.save

    share
  end

  # Share `score` as `invite` does, on `user`'s say: refused, with nothing
  # written or mailed, once they have sent the day's invitations. Each
  # invitation sent (a new share, or a role changed, which mails again)
  # counts for 24 hours, even once the share is gone. `open`: whether
  # payments are open (Plan.limits); nil asks Stripe's settings.
  static def invite_by(user, score, email, role, open = nil)
    if ScoreShare.invitations_left(user) <= 0
      used_up = "You have sent the #{SCORE_INVITATIONS_PER_DAY} invitations a day allows: try again tomorrow."
      return {"error": used_up, "limit": true}
    end

    full = ScoreShare.plan_refusal(score, email, open)
    return full unless full.nil?

    share = ScoreShare.invite(score, email, role)
    return share if type(share) == "hash"

    user.invitations_sent = ScoreShare.sent_today(user) + [DateTime.utc.to_unix]
    user.update()
    share
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

    full = "On the Free plan a score is shared with #{most} people at most: Pro shares it with as many as you like."
    {"error": full, "upgrade": true}
  end

  # How many more invitations `user` may send now.
  static def invitations_left(user)
    [SCORE_INVITATIONS_PER_DAY - ScoreShare.sent_today(user).length, 0].max()
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
    may = "#{share.email} may now #{share.role == "write" ? "open and change" : "open"} “#{title}”"
    return "#{may}." if mailed

    "#{may}, but the invitation email could not be sent: send them the link yourself."
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
