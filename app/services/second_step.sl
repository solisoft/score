# Whether THIS session passed a second step (#544): the admin section asks
# for it, not merely for an account with two-step sign-in on. A session
# opened with the password alone, before two-step was turned on (or on a
# remembered browser), stays out of the admin until its owner signs in
# again with a code.
#
# The mark is set where a code was accepted, and nowhere else: the second
# step of a sign-in (TwoStepController#create), the first code that turns
# two-step on (App::AccountController#confirm_two_step), and the code asked
# again by the admin's own page (Admin::TwoStepController#create). It names
# the account, so a code one account gave never opens the admin to the next
# one signed in on the same browser.
#
# It lasts SECOND_STEP_SECONDS (#687): a session left open for days does
# not keep the admin open with a code typed once; the code is asked again.
#
# What an admin may do outside the admin section — take away anyone's
# section or comment, read a hidden section (#444) — asks the same of the
# session (`admin?`, #687): an admin's password alone does not do it.
const SECOND_STEP_SECONDS = 12 * 3600

class SecondStep
  # `user` gave a right code in this session.
  static def mark(user)
    session_set("second_step_user", user._key)
    session_set("second_step_at", DateTime.utc.to_unix)
  end

  # `user` has two-step sign-in on and gave a code in this session, less
  # than SECOND_STEP_SECONDS ago.
  static def passed?(user)
    return false if user.nil? || !user.two_step?

    SecondStep.fresh?(session_get("second_step_user"), session_get("second_step_at"), user, DateTime.utc.to_unix)
  end

  # The mark (`marked_user`, `marked_at`) is `user`'s and still good at `now`.
  static def fresh?(marked_user, marked_at, user, now)
    return false if marked_at.nil? || marked_user.to_s != user._key

    now - marked_at.to_s.to_i <= SECOND_STEP_SECONDS
  end

  # `user` is an admin acting as one: an admin whose session passed the
  # second step. False for a guest (nil).
  static def admin?(user)
    !user.nil? && user.admin? && SecondStep.passed?(user)
  end
end
