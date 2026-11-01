# Whether THIS session passed a second step (#544): the admin section asks
# for it, not merely for an account with two-step sign-in on. A session
# opened with the password alone, before two-step was turned on (or on a
# remembered browser), stays out of the admin until its owner signs in
# again with a code.
#
# The mark is set where a code was accepted, and nowhere else: the second
# step of a sign-in (TwoStepController#create) and the first code that turns
# two-step on (App::AccountController#confirm_two_step). It names the
# account, so a code one account gave never opens the admin to the next one
# signed in on the same browser.
class SecondStep
  # `user` gave a right code in this session.
  static def mark(user)
    session_set("second_step_user", user._key)
    session_set("second_step_at", DateTime.utc.to_unix)
  end

  # `user` has two-step sign-in on and gave a code in this session.
  static def passed?(user)
    return false if user.nil? || !user.two_step?

    session_get("second_step_user").to_s == user._key && !session_get("second_step_at").nil?
  end
end
