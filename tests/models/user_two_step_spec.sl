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

describe("User two-step sign-in") do
  test("a secret is kept aside, encrypted, until a code of it turns it on") do
    user = two_step_user()
    secret = user.start_two_step
    assert_match(secret, "^[A-Z2-7]{32}$")
    stored = User.find(user._key)
    assert_not(stored.two_step?)
    assert_ne(stored.totp_pending, secret, "encrypted, not kept as typed")
    assert_eq(stored.pending_two_step, secret)
    assert_contains(stored.two_step_uri(secret), "otpauth://totp/EUI%20Score:")
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

  test("the server offers it only with a key to encrypt the secrets") do
    assert(User.two_step_available?())
    assert(two_step_user().can_use_two_step?)
  end
end
