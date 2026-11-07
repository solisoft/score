# ScoreShare: what the owner reads once someone is invited.

describe("ScoreShare.invited_notice") do
  test("the invitation left: who may now open, or open and change, the score") do
    reader = ScoreShare.new({"email": "reader@example.com", "role": "read"})
    writer = ScoreShare.new({"email": "writer@example.com", "role": "write"})
    assert_eq(ScoreShare.invited_notice(reader, "Chorale", true), "reader@example.com may now open “Chorale”.")
    assert_eq(
      ScoreShare.invited_notice(writer, "Duet", true),
      "writer@example.com may now open and change “Duet”."
    )
  end

  test("the invitation email failed: the notice says so, and to send the link by hand") do
    reader = ScoreShare.new({"email": "reader@example.com", "role": "read"})
    notice = ScoreShare.invited_notice(reader, "Chorale", false)
    assert_eq(
      notice,
      "reader@example.com may now open “Chorale”, but the invitation email could not be sent: "
      + "send them the link yourself."
    )
  end

  test("in French, for the app in French (#505)") do
    writer = ScoreShare.new({"email": "writer@example.com", "role": "write"})
    I18n.set_locale("fr")
    done = ScoreShare.invited_notice(writer, "Duo", true)
    unmailed = ScoreShare.invited_notice(writer, "Duo", false)
    I18n.set_locale("en")
    assert_eq(done, "writer@example.com peut maintenant ouvrir et modifier « Duo ».")
    assert_contains(unmailed, "mais l'invitation n'a pas pu être envoyée")
  end
end

def share_owner
  user = User.new()
  user.email = "share-#{uuid_v4}@example.com"
  user.set_password("correct horse battery")
  user.save
  user
end

describe("ScoreShare, once a score and an address (#689)") do
  test("a second share of one score with one address is refused by the database, the first left as it was") do
    owner = share_owner()
    score = Score.start(owner, Score.blank_source("Once"))
    address = "once-#{uuid_v4}@example.com"
    first = ScoreShare.invite(score, address, "read")
    assert_not_null(first._key)
    # A share made beside it, as a second invitation at the same moment would.
    assert_null(ScoreShare.written(score, address, "write", nil))
    twin = ScoreShare.create({
      "score_id": score._key,
      "owner_id": owner._key,
      "email": address,
      "role": "write",
      "created_at": DateTime.utc.to_unix
    })
    assert(twin._errors.length > 0, "the unique index refuses it")
    stored = ScoreShare.where({"score_id": score._key, "email": address}).all
    assert_eq(stored.length, 1)
    assert_eq(stored[0]._key, first._key)
    assert_eq(stored[0].role, "read")
    # The same address on another score is another share.
    other = Score.start(owner, Score.blank_source("Twice"))
    assert_not_null(ScoreShare.written(other, address, "write", nil))
  end

  test("inviting again changes the one share's role, and a refused share keeps the readable message") do
    owner = share_owner()
    score = Score.start(owner, Score.blank_source("Again"))
    address = "again-#{uuid_v4}@example.com"
    ScoreShare.invite(score, address, "read")
    ScoreShare.invite(score, " #{address.upcase} ", "write")
    stored = ScoreShare.where({"score_id": score._key, "email": address}).all
    assert_eq(stored.map(&:role), ["write"])
    assert_eq(ScoreShare.invite(score, "not an address", "read")["error"], "That is not an email address.")
    assert_eq(ScoreShare.where({"score_id": score._key}).count, 1)
  end

  test("the shares made twice before are merged: the oldest kept, with the stronger role") do
    rows = [
      {"key": "a1", "score_id": "s1", "email": "x@example.com", "role": "read"},
      {"key": "a2", "score_id": "s1", "email": "x@example.com", "role": "write"},
      {"key": "a3", "score_id": "s1", "email": "x@example.com", "role": "read"},
      {"key": "b1", "score_id": "s1", "email": "y@example.com", "role": "read"},
      {"key": "c1", "score_id": "s2", "email": "x@example.com", "role": "write"},
      {"key": "c2", "score_id": "s2", "email": "x@example.com", "role": "read"},
      {"key": "d1", "score_id": "s3", "email": "z@example.com", "role": "read"},
      {"key": "d2", "score_id": "s3", "email": "z@example.com", "role": "read"}
    ]
    assert_eq(ScoreShare.duplicates_in(rows), {"to_write": ["a1"], "gone": ["a2", "a3", "c2", "d2"]})
    assert_eq(ScoreShare.duplicates_in([]), {"to_write": [], "gone": []})
    assert_eq(ScoreShare.duplicates_in(rows.slice(3, 5)), {"to_write": [], "gone": []})
  end
end
