# Two-step sign-in on the account: setting an authenticator app up, a code
# good once, backup codes good once, turning it off.

const TWO_STEP_PASSWORD = "correct horse battery"

def two_step_user
  user = User.new()
  user.email = "two-step-#{uuid_v4}@example.com"
  user.set_password(TWO_STEP_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

# The code of `secret` `steps` time steps from now.
def app_code(secret, steps)
  Crypto.totp_generate(secret, DateTime.utc.to_unix + 30 * steps, 30)
end

# An account that notes what its second step had counted when a code was
# checked: the code "right" is right, any other wrong.
class TwoStepProbe < User
  # The account it stands for (its class reads no collection of its own).
  def _key
    @probe_key
  end

  def second_step?(code)
    row = TwoStepGuard.find_by("user_id", this._key)
    @wrong_at_check = row.nil? ? 0 : row.wrong
    code == "right"
  end
end

describe("User two-step sign-in") do
  test("a secret is kept aside, encrypted, until a code of it turns it on") do
    user = two_step_user()
    secret = user.start_two_step
    assert_match(secret, "^[A-Z2-7]{32}$")
    stored = User.find(user._key)
    assert_not(stored.two_step?)
    assert_ne(stored.totp_pending, secret, "encrypted, not kept as typed")
    assert_eq(stored.pending_two_step, secret)
    assert_contains(stored.two_step_uri(secret), "otpauth://totp/Score:")
    # A wrong code turns nothing on.
    assert_null(stored.confirm_two_step("000000"))
    assert_null(stored.confirm_two_step("not a code"))
    assert_not(User.find(user._key).two_step?)
    codes = User.find(user._key).confirm_two_step(app_code(secret, 0))
    assert_eq(codes.length, 10)
    assert(codes.all?(&{ |c|
      Regex.matches("^[a-z2-9]{5}-[a-z2-9]{5}$", c)
    }))
    on = User.find(user._key)
    assert(on.two_step?)
    assert_null(on.totp_pending)
    assert_eq(on.backup_codes_left, 10)
    assert_not(on.totp_backup.includes?(codes[0]), "the codes are kept as digests")
  end

  test("an app's code passes once, and an old or far one never") do
    user = two_step_user()
    secret = user.start_two_step
    User.find(user._key).confirm_two_step(app_code(secret, 0))
    on = User.find(user._key)
    assert_not(on.second_step?(app_code(secret, 0)), "the code that turned it on is spent")
    assert(on.second_step?(app_code(secret, 1)), "the next step's, within the drift")
    assert_not(User.find(user._key).second_step?(app_code(secret, 1)), "the same code again")
    assert_not(User.find(user._key).second_step?(app_code(secret, 4)), "too far ahead")
    assert_not(User.find(user._key).second_step?("12345"))
  end

  test("a backup code passes once, written any way, and the others stay") do
    user = two_step_user()
    secret = user.start_two_step
    codes = User.find(user._key).confirm_two_step(app_code(secret, 0))
    typed = codes[2].upcase.replace("-", " ")
    assert(User.find(user._key).second_step?(typed))
    assert_not(User.find(user._key).second_step?(codes[2]))
    assert_eq(User.find(user._key).backup_codes_left, 9)
    assert_not(User.find(user._key).second_step?("aaaaa-aaaaa"))
  end

  test("turned off, it asks for nothing and keeps nothing") do
    user = two_step_user()
    secret = user.start_two_step
    User.find(user._key).confirm_two_step(app_code(secret, 0))
    User.find(user._key).stop_two_step
    off = User.find(user._key)
    assert_not(off.two_step?)
    assert_null(off.totp_secret)
    assert_eq(off.backup_codes_left, 0)
    assert_not(off.second_step?(app_code(secret, 1)))
  end

  test("an app's code passes once, even to two copies read before either used it") do
    user = two_step_user()
    secret = user.start_two_step
    User.find(user._key).confirm_two_step(app_code(secret, 0))
    # Two requests at once: each has read the account before the other wrote.
    first = User.find(user._key)
    second = User.find(user._key)
    code = app_code(secret, 1)
    assert(first.second_step?(code))
    assert_not(second.second_step?(code), "the same code, from the copy read before")
    assert_not(User.find(user._key).second_step?(code))
  end

  test("a backup code passes once, even to two copies read before either used it") do
    user = two_step_user()
    secret = user.start_two_step
    codes = User.find(user._key).confirm_two_step(app_code(secret, 0))
    first = User.find(user._key)
    second = User.find(user._key)
    assert(first.second_step?(codes[4]))
    assert_not(second.second_step?(codes[4]), "the same code, from the copy read before")
    assert_eq(User.find(user._key).backup_codes_left, 9)
    # The other codes stay good, from a stale copy too.
    assert(second.second_step?(codes[5]))
    assert_eq(User.find(user._key).backup_codes_left, 8)
  end

  test("a code of a secret turned off passes no more, from a copy read before") do
    user = two_step_user()
    secret = user.start_two_step
    User.find(user._key).confirm_two_step(app_code(secret, 0))
    stale = User.find(user._key)
    User.find(user._key).stop_two_step
    assert_not(stale.second_step?(app_code(secret, 1)))
  end

  test("turning it on signs out every session and remembered browser opened before") do
    user = two_step_user()
    user.start_remember_me
    before = User.find(user._key).current_session_version
    secret = User.find(user._key).start_two_step
    User.find(user._key).confirm_two_step(app_code(secret, 0))
    on = User.find(user._key)
    assert_eq(on.current_session_version, before + 1)
    assert_null(on.remember_token_digest)
  end

  test("two requests with one code of the app: the one whose write comes second passes nothing") do
    user = two_step_user()
    secret = user.start_two_step
    User.find(user._key).confirm_two_step(app_code(secret, 0))
    code = app_code(secret, 1)
    step = User.totp_step(secret, code, DateTime.utc.to_unix)
    # Both read the guard row before either wrote it; the first spends the code.
    seen = TwoStepGuard.of(user)
    assert(User.find(user._key).second_step?(code))
    # The second, from its stale read: the compare-and-set refuses its write,
    # and the row read again has the step spent.
    assert_not(TwoStepGuard.spend_step(seen, step, nil), "the same step from a stale read")
    assert_eq(TwoStepGuard.of(user).last_step, step)
  end

  test("two requests with one backup code: the one whose write comes second passes nothing") do
    user = two_step_user()
    secret = user.start_two_step
    codes = User.find(user._key).confirm_two_step(app_code(secret, 0))
    valid = User.find(user._key).totp_backup
    digest = Crypto.sha256(User.backup_digest_text(codes[2]))
    seen = TwoStepGuard.of(user)
    assert(User.find(user._key).second_step?(codes[2]))
    assert_not(TwoStepGuard.spend_backup(seen, digest, valid), "the same code from a stale read")
    assert_eq(TwoStepGuard.of(user).spent, [digest])
    # Another code from the same stale read: written, once read again.
    other = Crypto.sha256(User.backup_digest_text(codes[3]))
    assert(TwoStepGuard.spend_backup(seen, other, valid))
    assert_eq(TwoStepGuard.of(user).spent.length, 2)
    assert_not(User.find(user._key).second_step?(codes[3]))
  end

  test("a backup code spent, then another: the first, from an older list of the account, is refused") do
    user = two_step_user()
    secret = user.start_two_step
    codes = User.find(user._key).confirm_two_step(app_code(secret, 0))
    stale_list = User.find(user._key).totp_backup
    first = Crypto.sha256(User.backup_digest_text(codes[1]))
    second = Crypto.sha256(User.backup_digest_text(codes[2]))
    assert(TwoStepGuard.spend_backup(TwoStepGuard.of(user), first, stale_list))
    # The next one checked against a list that no longer has the first.
    fresh_list = stale_list.filter do |d|
      d != first
    end
    assert(TwoStepGuard.spend_backup(TwoStepGuard.of(user), second, fresh_list))
    assert_not(TwoStepGuard.spend_backup(TwoStepGuard.of(user), first, stale_list), "the first, again")
    assert_not(User.find(user._key).second_step?(codes[1]))
    assert_eq(User.find(user._key).backup_codes_left, 8)
  end

  test("a whole-record save from a copy read before a code was spent does not make it good again") do
    user = two_step_user()
    secret = user.start_two_step
    codes = User.find(user._key).confirm_two_step(app_code(secret, 0))
    stale = User.find(user._key)
    assert(User.find(user._key).second_step?(codes[4]))
    stale.name = "Saved from an older copy"
    stale.update()
    assert_eq(User.find(user._key).name, "Saved from an older copy")
    assert_not(User.find(user._key).second_step?(codes[4]), "spent stays spent")
    assert_eq(User.find(user._key).backup_codes_left, 9)
  end

  test("an account with two-step on from before #538, without a guard row: a used step refused, a backup code once") do
    user = two_step_user()
    secret = user.start_two_step
    codes = User.find(user._key).confirm_two_step(app_code(secret, 0))
    assert_null(TwoStepGuard.find_by("user_id", user._key), "no row yet")
    # The step its enrolment used, kept on the account only.
    assert_not(User.find(user._key).second_step?(app_code(secret, 0)), "the step used before")
    assert(User.find(user._key).second_step?(codes[7]))
    assert_not(User.find(user._key).second_step?(codes[7]), "once")
    assert_eq(User.find(user._key).backup_codes_left, 9)
    assert(User.find(user._key).second_step?(app_code(secret, 1)))
  end

  test("a code typed is counted before it is checked; a right one gives the count back") do
    user = two_step_user()
    probe = TwoStepProbe.new()
    probe.probe_key = user._key
    probe.email = user.email
    assert_not(probe.second_step_counted?("wrong"))
    assert_eq(probe.wrong_at_check, 1, "counted before the check")
    assert(probe.second_step_counted?("right"))
    assert_eq(probe.wrong_at_check, 2, "the right one too, before its check")
    assert_eq(TwoStepGuard.of(user).wrong, 0, "given back")
    # The last try of the window: counted, and the pause already on when
    # it is checked; the next is not checked at all.
    (0 .. TWO_STEP_MAX_WRONG).each do |_|
      probe.second_step_counted?("wrong")
    end
    assert_eq(probe.wrong_at_check, TWO_STEP_MAX_WRONG)
    assert(TwoStepGuard.locked?(user))
    probe.wrong_at_check = nil
    assert_not(probe.second_step_counted?("right"))
    assert_null(probe.wrong_at_check, "not checked at all")
  end

  test("wrong codes pause the code step, apart from the password's lock, and a reset keeps them") do
    user = two_step_user()
    secret = user.start_two_step
    codes = User.find(user._key).confirm_two_step(app_code(secret, 0))
    (1 .. TWO_STEP_MAX_WRONG).each do |_|
      assert_not(User.find(user._key).second_step_counted?("000000"))
    end
    assert_not(User.find(user._key).codes_locked?, "one short of the limit")
    # A reset does not give them back.
    User.find(user._key).finish_password_reset("a brand new password")
    assert_eq(TwoStepGuard.of(user).wrong, TWO_STEP_MAX_WRONG - 1)
    assert_not(User.find(user._key).second_step_counted?("000000"))
    stored = User.find(user._key)
    assert(stored.codes_locked?)
    assert_not(stored.locked?, "the password step's locks are not touched")
    assert_not(stored.locked_for?("127.0.0.1"))
    # Paused: the right code is not even looked at.
    assert_not(stored.second_step_counted?(codes[0]))
    assert_eq(User.find(user._key).backup_codes_left, 10, "not spent")
  end

  test("the pause runs out on schedule, and the count starts again; a right code clears it") do
    user = two_step_user()
    secret = user.start_two_step
    codes = User.find(user._key).confirm_two_step(app_code(secret, 0))
    (0 .. TWO_STEP_MAX_WRONG).each do |_|
      User.find(user._key).count_wrong_code
    end
    assert(User.find(user._key).codes_locked?)
    row = TwoStepGuard.of(user)
    long_ago = DateTime.utc.to_unix - TWO_STEP_LOCK_SECONDS - 1
    row.locked_at = long_ago
    row.wrong_at = long_ago
    row.save
    assert_not(User.find(user._key).codes_locked?, "run out")
    assert_not(User.find(user._key).count_wrong_code, "one wrong code does not pause it again")
    assert_eq(TwoStepGuard.of(user).wrong, 1, "the count started again")
    assert(User.find(user._key).second_step_counted?(codes[0]))
    assert_eq(TwoStepGuard.of(user).wrong, 0)
  end

  test("an admin's unlock lifts the code step's pause too") do
    user = two_step_user()
    (0 .. TWO_STEP_MAX_WRONG).each do |_|
      User.find(user._key).count_wrong_code
    end
    assert(User.find(user._key).codes_locked?)
    User.find(user._key).unlock
    assert_not(User.find(user._key).codes_locked?)
  end

  test("a mail sent from a copy read before a failed sign-in does not put the count back") do
    user = two_step_user()
    # The mail job read the account first…
    stale = User.find(user._key)
    # …then a wrong password was counted…
    User.find(user._key).register_failed_attempt("198.51.100.4")
    User.find(user._key).register_failed_attempt("198.51.100.4")
    # …and the job makes its link from its copy.
    stale.start_email_confirmation
    stale.start_password_reset
    stored = User.find(user._key)
    assert_eq(stored.sign_in_failures.values()[0]["count"], 2)
    assert_not_null(stored.confirmation_token_digest)
    assert_not_null(stored.reset_token_digest)
  end

  test("the server offers it only with a key to encrypt the secrets") do
    assert(User.two_step_available?())
    assert(two_step_user().can_use_two_step?)
  end
end
