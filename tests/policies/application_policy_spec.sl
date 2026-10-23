describe("a refusal from a policy") do
  test("says, in plain words, what may not be done to what") do
    score = Score.new()
    assert_eq(policy_refusal_words("show", score), "You may not open this score.")
    assert_eq(policy_refusal_words("update", score), "You may not change this score.")
    assert_eq(policy_refusal_words("destroy", score), "You may not delete this score.")
    assert_eq(policy_refusal_words("share", score), "You may not share this score.")
    assert_eq(policy_refusal_words("publish", score), "You may not do that to this score.")
  end

  test("refuses a record with no policy without naming a class, and logs the class") do
    Logger.set_capture(true)
    message = assert_raises("You may not do that.") do
      policy_for(User.new())
    end
    logged = Logger.entries().join("\n")
    Logger.set_capture(false)
    assert_not(message.contains("Policy"), "no class named to the person")
    assert_contains(logged, "No policy class UserPolicy")
  end
end
