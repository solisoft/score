# A sign-in half-way, for an account with two-step sign-in on: the password
# (or a password reset) is done, the code is still to come. The session says
# who, since when, how many wrong codes, whether to remember the browser and
# where they were going; it does not sign them in (TwoStepController does,
# on the code).
#
# One place for the keys, because two steps lead here: the password at
# sign-in, and a new password from a reset link (#538), which used to sign
# straight in without the code.

const TWO_STEP_PENDING_KEYS = [
  "two_step_user",
  "two_step_since",
  "two_step_tries",
  "two_step_remember",
  "two_step_return"
]

class TwoStepPending
  # A new session, `user` half-way in, going to `back` (a path of the app,
  # or "") and, with `remember`, to be remembered.
  static def start(user, remember, back)
    session_regenerate()
    session_set("two_step_user", user["_key"])
    session_set("two_step_since", DateTime.utc().to_unix())
    session_set("two_step_tries", 0)
    session_set("two_step_remember", remember)
    session_set("two_step_return", back)
    true
  end

  static def forget
    TWO_STEP_PENDING_KEYS.each do |name|
      session_delete(name)
    end
    true
  end
end
