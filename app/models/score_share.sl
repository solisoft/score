# A score shared with someone, by email: "read" lets them open it, "write"
# lets them change it too. The address need not have an account yet: the
# share is theirs once they sign up with it.
const SCORE_SHARE_ROLES = ["read", "write"]

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

  # What the owner reads once `share` is made on the score titled `title`:
  # `mailed` says whether the invitation email left. When it did not, the
  # notice says so, so the owner sends the link themselves.
  static def invited_notice(share, title, mailed)
    may = "#{share.email} may now #{share.role == "write" ? "open and change" : "open"} “#{title}”"
    return "#{may}." if mailed

    "#{may}, but the invitation email could not be sent: send them the link yourself."
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

  static def delete_all_for(score)
    ScoreShare.where({"score_id": score._key}).delete_all
  end

  # Everything shared by or with `user`: their account is going.
  static def delete_all_of(user)
    ScoreShare.where({"owner_id": user._key}).delete_all
    ScoreShare.where({"email": user.email}).delete_all
  end
end
