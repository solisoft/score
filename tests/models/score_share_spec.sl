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
end
