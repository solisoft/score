# Two-step sign-in, held where it could be walked around (#538): a password
# reset, wrong codes spread over fresh sign-ins or resets, the locks of the
# password step at the code step, the codes asked on the account page, the
# other browsers when it is turned on, the password to turn it on, and the
# code to delete the account.

const HELD_PASSWORD = "correct horse battery"

# A confirmed account, and with `on` its app set up: [user, secret, backup codes].
def held_account(on)
  user = User.new()
  user.email = "held-#{uuid_v4}@example.com"
  user.set_password(HELD_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  unless on
    return [user, nil, []]
  end

  secret = user.start_two_step
  codes = User.find(user._key).confirm_two_step(held_code(secret, 0))
  [user, secret, codes]
end

# The app's code `steps` time steps from now (one later step is all a test
# can spend: the codes of steps further on are not taken yet).
def held_code(secret, steps)
  Crypto.totp_generate(secret, DateTime.utc.to_unix + 30 * steps, 30)
end

# The password step in a fresh browser, `extra` fields added: the response.
def held_password_step(user, extra = {})
  clear_cookies()
  post("/login", {"email": user.email, "password": HELD_PASSWORD}.merge(extra))
end

# The session cookie a response handed out.
def held_session_of(response)
  parts = str(res_headers(response)).split("session_id=")
  return nil if parts.length < 2

  parts[1].split(";")[0]
end

# Signed in, through both steps when it is on (a backup code): the
# browser's session cookie.
def held_sign_in(account, extra = {})
  response = held_password_step(account[0], extra)
  return held_session_of(response) if account[1].nil?

  held_session_of(post("/login/code", {"code": account[2].pop}))
end

# `count` wrong codes at the code step, three per fresh sign-in: never the
# five that would end one, so only the account can be counting them all.
def held_wrong_codes(user, count)
  (0 .. count).each do |i|
    held_password_step(user) if i % 3 == 0
    post("/login/code", {"code": "000000"})
  end
end

# What the account's second step has seen (TwoStepGuard), or nil.
def held_guard(user)
  TwoStepGuard.find_by("user_id", user._key)
end

def held_wrong_count(user)
  row = held_guard(user)
  row.nil? ? 0 : row.wrong.to_s.to_i
end

def held_signed_in?
  res_status(get("/app/account")) == 200
end

# The AuthMailJob rows queued to tell `user` the code step is paused.
def held_code_lock_mails(user)
  Job.list().filter do |job|
    args = job["args"] ?? {}
    str(job["handler"]).contains("AuthMailJob") && args["email"] == user.email && args["lock"] == "code"
  end
end

def held_stop(password, code)
  post(
    "/app/account/two-step/stop",
    {"password": password, "code": code}
  )
end

describe("Two-step sign-in, held") do
  before_each() do
    as_guest()
    clear_cookies()
  end

  describe("a password reset") do
    test("with it on, sets the password but asks for the code before signing in") do
      account = held_account(true)
      token = account[0].start_password_reset
      response = post(
        "/password/update",
        {
          "token": token,
          "password": "a brand new password",
          "password_confirmation": "a brand new password"
        }
      )
      assert_eq(res_location(response), "/login/code")
      assert_not(str(res_headers(response)).contains("device="), "no browser trusted on the link alone")
      assert_not(held_signed_in?(), "not signed in by the link alone")
      stored = User.find(account[0]._key)
      assert(stored.authenticate("a brand new password"), "the password is changed")
      assert_null(stored.reset_token_digest, "the link is used up")
      assert_contains(res_body(get("/login/code")), "six-digit code")
      assert_eq(res_status(post("/login/code", {"code": "000000"})), 401)
      assert_not(held_signed_in?())
      done = post("/login/code", {"code": held_code(account[1], 1)})
      assert_eq(res_location(done), "/app")
      assert(str(res_headers(done)).contains("device="), "trusted once the code is right")
      assert(held_signed_in?(), "the code completes it")
    end

    test("the French reset goes to the French code page") do
      account = held_account(true)
      token = account[0].start_password_reset
      response = post(
        "/fr/password/update",
        {
          "token": token,
          "password": "a brand new password",
          "password_confirmation": "a brand new password"
        }
      )
      assert_eq(res_location(response), "/fr/login/code")
      assert_not(held_signed_in?())
    end

    test("gives no fresh allowance of codes: the wrong ones before it still count") do
      account = held_account(true)
      user = account[0]
      held_wrong_codes(user, TWO_STEP_MAX_WRONG - 1)
      assert_eq(held_wrong_count(user), TWO_STEP_MAX_WRONG - 1)
      token = User.find(user._key).start_password_reset
      post(
        "/password/update",
        {
          "token": token,
          "password": "a brand new password",
          "password_confirmation": "a brand new password"
        }
      )
      assert_eq(held_wrong_count(user), TWO_STEP_MAX_WRONG - 1, "the reset leaves them")
      # The reset's own code page: one more wrong code pauses the codes.
      paused = post("/login/code", {"code": "000000"})
      assert_eq(res_status(paused), 401)
      assert_contains(res_body(paused), "Too many wrong codes for this account")
      assert(User.find(user._key).codes_locked?)
    end
  end

  describe("wrong codes") do
    test("count against the account across fresh sign-ins, then pause the codes, the right one too") do
      account = held_account(true)
      user = account[0]
      # A sign-in left half-way in another browser, for the right code later.
      waiting = held_session_of(held_password_step(user))
      before = User.find(user._key).totp_last_step
      held_wrong_codes(user, TWO_STEP_MAX_WRONG)
      assert(User.find(user._key).codes_locked?, "paused after #{TWO_STEP_MAX_WRONG} wrong codes")
      assert_eq(held_code_lock_mails(user).length, 1, "the owner is told, once")
      # The waiting sign-in, with the right code: refused, not signed in.
      clear_cookies()
      set_request_cookie("session_id", waiting)
      late = post("/login/code", {"code": held_code(account[1], 1)})
      assert_eq(res_status(late), 401)
      assert_contains(res_body(late), "Too many wrong codes for this account")
      assert_not(held_signed_in?())
      assert_eq(User.find(user._key).totp_last_step, before, "the code was not spent")
      assert_eq(User.find(user._key).backup_codes_left, 10)
      # Counted no further while paused: the pause runs out on schedule.
      held_wrong_codes(user, 3)
      assert_eq(held_wrong_count(user), TWO_STEP_MAX_WRONG)
      assert_eq(held_code_lock_mails(user).length, 1)
    end

    test("pause the code step only: the password step still leads to it, and nothing else is locked") do
      account = held_account(true)
      user = account[0]
      signed_in = held_sign_in(account)
      held_wrong_codes(user, TWO_STEP_MAX_WRONG)
      stored = User.find(user._key)
      assert(stored.codes_locked?)
      assert_not(stored.locked?, "the password step's locks are not set by codes")
      # The password still leads to the code page, not to a wrong password.
      step = held_password_step(user)
      assert_eq(res_location(step), "/login/code")
      assert_not(res_body(step).contains("Invalid email or password"))
      assert_contains(res_body(get("/login/code")), "six-digit code")
      # The owner's browser signed in before stays signed in.
      clear_cookies()
      set_request_cookie("session_id", signed_in)
      assert(held_signed_in?(), "the sessions are left alone")
    end

    test("a right password alone does not wipe them; the right code does") do
      account = held_account(true)
      user = account[0]
      held_password_step(user)
      post("/login/code", {"code": "000000"})
      post("/login/code", {"code": "111111"})
      assert_eq(held_wrong_count(user), 2)
      held_password_step(user)
      assert_eq(held_wrong_count(user), 2, "the password step leaves them")
      assert_eq(res_location(post("/login/code", {"code": held_code(account[1], 1)})), "/app")
      assert_eq(held_wrong_count(user), 0)
      assert_not(User.find(user._key).codes_locked?)
    end

    test("without it on, a right password still clears the network's wrong ones") do
      account = held_account(false)
      post(
        "/login",
        {"email": account[0].email, "password": "not it"}
      )
      assert_eq(User.find(account[0]._key).sign_in_failures.values()[0]["count"], 1)
      held_password_step(account[0])
      assert_eq(User.find(account[0]._key).sign_in_failures.keys().length, 0)
    end

    test("with it on, the network's wrong passwords are cleared by the code, not the password alone") do
      account = held_account(true)
      user = account[0]
      post(
        "/login",
        {"email": user.email, "password": "not it"}
      )
      held_password_step(user)
      assert_eq(User.find(user._key).sign_in_failures.values()[0]["count"], 1, "half-way: kept")
      post("/login/code", {"code": held_code(account[1], 1)})
      assert_eq(User.find(user._key).sign_in_failures.keys().length, 0)
    end
  end

  describe("the code step, after the password") do
    test("holds a lock of this network set meanwhile: the right code is refused, not spent") do
      account = held_account(true)
      user = account[0]
      assert_eq(res_location(held_password_step(user)), "/login/code")
      # Wrong passwords from this network (every spec request is 127.0.0.1's)
      # lock it while the code page is open.
      (0 .. AUTH_MAX_FAILED_ATTEMPTS).each do |_|
        User.find(user._key).register_failed_attempt("127.0.0.1")
      end
      before = User.find(user._key).totp_last_step
      refused = post("/login/code", {"code": held_code(account[1], 1)})
      assert_eq(res_status(refused), 401)
      assert_contains(res_body(refused), "Invalid email or password")
      assert_not(held_signed_in?())
      assert_eq(User.find(user._key).totp_last_step, before, "the code was not spent")
      assert_eq(res_location(get("/login/code")), "/login", "the sign-in is over")
    end

    test("does not hold the lock of another network") do
      account = held_account(true)
      user = account[0]
      held_password_step(user)
      (0 .. AUTH_MAX_FAILED_ATTEMPTS).each do |_|
        User.find(user._key).register_failed_attempt("203.0.113.9")
      end
      assert(User.find(user._key).locked_for?("203.0.113.9"))
      assert_eq(res_location(post("/login/code", {"code": held_code(account[1], 1)})), "/app")
      assert(held_signed_in?())
    end

    test("holds the account-wide lock for a browser the account does not know, not for one it does") do
      account = held_account(true)
      user = account[0]
      # A browser that signed in before: its `device` cookie.
      held_sign_in(account)
      device = User.find(user._key).device_cookie
      # A stranger's sign-in, half-way, then the account-wide lock.
      held_password_step(user)
      User.find(user._key)._patch_stored({"account_locked_at": DateTime.utc.to_unix})
      refused = post("/login/code", {"code": account[2].pop})
      assert_eq(res_status(refused), 401)
      assert_not(held_signed_in?())
      assert_eq(User.find(user._key).backup_codes_left, 9, "the stranger's code was not spent")
      # The owner's browser, through both steps.
      clear_cookies()
      set_request_cookie("device", device)
      assert_eq(res_location(post(
        "/login",
        {"email": user.email, "password": HELD_PASSWORD}
      )), "/login/code")
      assert_eq(res_location(post("/login/code", {"code": account[2].pop})), "/app")
      assert(held_signed_in?())
    end
  end

  describe("the codes asked on the account page") do
    test("turning it off: a wrong code is counted, and the right password starts no new round of tries") do
      account = held_account(true)
      user = account[0]
      held_sign_in(account)
      (0 .. ACCOUNT_PASSWORD_TRIES).each do |_|
        assert_eq(res_status(held_stop(HELD_PASSWORD, "000000")), 422)
      end
      assert_eq(held_wrong_count(user), ACCOUNT_PASSWORD_TRIES)
      # The tries are spent: even the right password and a right code are not checked.
      spent = held_stop(HELD_PASSWORD, account[2].pop)
      assert_eq(res_status(spent), 429)
      assert(User.find(user._key).two_step?, "still on")
      assert_eq(User.find(user._key).backup_codes_left, 9, "the code was not spent")
    end

    test("turning it off: the right password and code turn it off, and start the tries again") do
      account = held_account(true)
      user = account[0]
      held_sign_in(account)
      held_stop(HELD_PASSWORD, "000000")
      held_stop("not it", "000000")
      assert_eq(held_wrong_count(user), 1, "no code looked at after a wrong password")
      response = held_stop(HELD_PASSWORD, account[2].pop)
      assert_eq(res_status(response), 302)
      assert_not(User.find(user._key).two_step?)
      assert_eq(held_wrong_count(user), 0, "a right code clears them")
      assert_not(User.find(user._key).password_tries_spent?)
    end

    test("turning it off: refused while the codes are paused, the right code too") do
      account = held_account(true)
      user = account[0]
      session = held_sign_in(account)
      held_wrong_codes(user, TWO_STEP_MAX_WRONG)
      clear_cookies()
      set_request_cookie("session_id", session)
      assert_eq(res_status(held_stop(HELD_PASSWORD, account[2].pop)), 422)
      assert(User.find(user._key).two_step?)
    end

    test("a new address: a wrong code is counted, and the right password starts no new round of tries") do
      account = held_account(true)
      user = account[0]
      held_sign_in(account)
      (0 .. ACCOUNT_PASSWORD_TRIES).each do |_|
        wrong = post(
          "/app/account/email",
          {
            "email": "moved-#{uuid_v4}@example.com",
            "password": HELD_PASSWORD,
            "code": "000000"
          }
        )
        assert_eq(res_status(wrong), 422)
      end
      assert_eq(held_wrong_count(user), ACCOUNT_PASSWORD_TRIES)
      # The tries are spent (the page's, shared): turning two-step off with
      # the right password and a right code is refused, nothing checked.
      assert_eq(res_status(held_stop(HELD_PASSWORD, account[2].pop)), 429)
      assert(User.find(user._key).two_step?)
      assert_null(User.find(user._key).email_change_to, "no change started")
      assert_eq(User.find(user._key).backup_codes_left, 9, "the code was not spent")
    end

    test("deleting the account: a wrong code is counted, and the right password starts no new round of tries") do
      account = held_account(true)
      user = account[0]
      held_sign_in(account)
      (0 .. ACCOUNT_PASSWORD_TRIES).each do |_|
        wrong = request("DELETE", "/app/account", {
          "password": HELD_PASSWORD,
          "code": "000000"
        }, {})
        assert_eq(res_status(wrong), 422)
      end
      assert_eq(held_wrong_count(user), ACCOUNT_PASSWORD_TRIES)
      spent = request("DELETE", "/app/account", {
        "password": HELD_PASSWORD,
        "code": account[2].pop
      }, {})
      assert_eq(res_status(spent), 429)
      assert_not_null(User.find_by("_key", user._key), "the account is still here")
    end
  end

  describe("turning it on") do
    test("asks for the password: none or a wrong one starts nothing") do
      account = held_account(false)
      held_sign_in(account)
      bare = post("/app/account/two-step", {})
      assert_eq(res_status(bare), 422)
      assert_contains(res_body(bare), "That is not your password: two-step sign-in is still off.")
      assert_null(User.find(account[0]._key).totp_pending)
      wrong = post("/app/account/two-step", {"password": "not it"})
      assert_eq(res_status(wrong), 422)
      assert_null(User.find(account[0]._key).totp_pending)
      assert_contains(res_body(get("/app/account")), "id=\"two_step_password\"")
      right = post("/app/account/two-step", {"password": HELD_PASSWORD})
      assert_eq(res_status(right), 200)
      assert_not_null(User.find(account[0]._key).pending_two_step)
    end

    test("spends the page's password tries: once they are gone, the right one is not checked") do
      account = held_account(false)
      held_sign_in(account)
      (0 .. ACCOUNT_PASSWORD_TRIES).each do |i|
        assert_eq(res_status(post("/app/account/two-step", {"password": "wrong #{i}"})), 422)
      end
      spent = post("/app/account/two-step", {"password": HELD_PASSWORD})
      assert_eq(res_status(spent), 429)
      assert_contains(res_body(spent), "Too many wrong passwords")
      assert_null(User.find(account[0]._key).totp_pending)
    end

    test("signs every other browser out, remembered ones too, and keeps this one, as a known browser") do
      account = held_account(false)
      user = account[0]
      other_browser = held_sign_in(account, {"remember_me": "1"})
      assert_not_null(User.find(user._key).remember_token_digest)
      this_browser = held_sign_in(account)
      post("/app/account/two-step", {"password": HELD_PASSWORD})
      secret = User.find(user._key).pending_two_step
      done = post("/app/account/two-step/confirm", {"code": held_code(secret, 0)})
      assert_contains(res_body(done), "Two-step sign-in is on")
      device = str(res_headers(done)).split("device=")[1].to_s.split(";")[0]
      assert(User.find(user._key).trusts_device?(device), "a device cookie of the new version")
      assert(held_signed_in?(), "this browser")
      stored = User.find(user._key)
      assert_null(stored.remember_token_digest, "no browser is remembered")
      assert_gt(stored.current_session_version, 0)
      clear_cookies()
      set_request_cookie("session_id", other_browser)
      assert_not(held_signed_in?(), "the other browser")
      assert_ne(this_browser, other_browser)
    end
  end

  describe("deleting the account") do
    test("with it on, asks for a code too: without one or with a wrong one, it stays") do
      account = held_account(true)
      user = account[0]
      held_sign_in(account)
      assert_contains(res_body(get("/app/account")), "id=\"delete_code\"")
      bare = request("DELETE", "/app/account", {"password": HELD_PASSWORD}, {})
      assert_eq(res_status(bare), 422)
      assert_contains(res_body(bare), "That code is not right, or it was already used: the account is still here.")
      assert_not_null(User.find_by("_key", user._key))
      wrong = request("DELETE", "/app/account", {
        "password": HELD_PASSWORD,
        "code": "000000"
      }, {})
      assert_eq(res_status(wrong), 422)
      assert_not_null(User.find_by("_key", user._key))
      no_password = request("DELETE", "/app/account", {
        "password": "not it",
        "code": held_code(account[1], 1)
      }, {})
      assert_eq(res_status(no_password), 422)
      assert_not_null(User.find_by("_key", user._key))
      done = request("DELETE", "/app/account", {
        "password": HELD_PASSWORD,
        "code": held_code(account[1], 1)
      }, {})
      assert_eq(res_status(done), 302)
      assert_null(User.find_by("_key", user._key))
      assert_null(held_guard(user), "its second step's record goes with it")
    end

    test("without it, the form asks for no code") do
      account = held_account(false)
      held_sign_in(account)
      assert_not(res_body(get("/app/account")).includes?("id=\"delete_code\""))
    end
  end
end
