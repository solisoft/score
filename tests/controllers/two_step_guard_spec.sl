# Two-step sign-in, held where it could be walked around (#538): a password
# reset, wrong codes spread over fresh sign-ins, the other browsers when it is
# turned on, the password to turn it on, and the code to delete the account.

const GUARD_PASSWORD = "correct horse battery"

# A confirmed account, and with `on` its app set up: [user, secret, backup codes].
def guarded_account(on)
  user = User.new()
  user.email = "guard-#{uuid_v4}@example.com"
  user.set_password(GUARD_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  unless on
    return [user, nil, []]
  end

  secret = user.start_two_step
  codes = User.find(user._key).confirm_two_step(guard_code(secret, 0))
  [user, secret, codes]
end

def guard_code(secret, steps)
  Crypto.totp_generate(secret, DateTime.utc.to_unix + 30 * steps, 30)
end

# The password step in a fresh browser, `extra` fields added: the response.
def guard_password_step(user, extra = {})
  clear_cookies()
  post("/login", {"email": user.email, "password": GUARD_PASSWORD}.merge(extra))
end

# The session cookie a response handed out.
def guard_session_of(response)
  headers = res_headers(response)
  cookie = (headers["set-cookie"] ?? headers["Set-Cookie"]).to_s.split(";")[0]
  cookie.split("=")[1]
end

# Signed in, through both steps when it is on: the browser's session cookie.
def guard_sign_in(account, extra = {})
  response = guard_password_step(account[0], extra)
  return guard_session_of(response) if account[1].nil?

  guard_session_of(post("/login/code", {"code": account[2].pop}))
end

# `count` wrong codes, three per fresh sign-in: never the five that would
# end one, so only the account can be counting them all.
def guard_wrong_codes(user, count)
  (0 .. count).each do |i|
    guard_password_step(user) if i % 3 == 0
    post("/login/code", {"code": "000000"})
  end
end

def guard_signed_in?
  res_status(get("/app/account")) == 200
end

describe("Two-step sign-in, held") do
  before_each() do
    as_guest()
    clear_cookies()
  end

  describe("a password reset") do
    test("with it on, sets the password but asks for the code before signing in") do
      account = guarded_account(true)
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
      assert_not(guard_signed_in?(), "not signed in by the link alone")
      stored = User.find(account[0]._key)
      assert(stored.authenticate("a brand new password"), "the password is changed")
      assert_null(stored.reset_token_digest, "the link is used up")
      assert_contains(res_body(get("/login/code")), "six-digit code")
      assert_eq(res_status(post("/login/code", {"code": "000000"})), 401)
      assert_not(guard_signed_in?())
      assert_eq(res_location(post("/login/code", {"code": guard_code(account[1], 1)})), "/app")
      assert(guard_signed_in?(), "the code completes it")
    end

    test("the French reset goes to the French code page") do
      account = guarded_account(true)
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
      assert_not(guard_signed_in?())
    end
  end

  describe("wrong codes") do
    test("count against the account across fresh sign-ins, then lock it, the right code too") do
      account = guarded_account(true)
      user = account[0]
      # A sign-in left half-way in another browser, for the right code later.
      waiting = guard_session_of(guard_password_step(user))
      guard_wrong_codes(user, AUTH_MAX_FAILED_ATTEMPTS)
      stored = User.find(user._key)
      assert(stored.locked?, "locked after #{AUTH_MAX_FAILED_ATTEMPTS} wrong codes")
      # The password step now answers like a wrong password, with no code page.
      refused = guard_password_step(user)
      assert_eq(res_status(refused), 401)
      assert_contains(res_body(refused), "Invalid email or password")
      # The waiting sign-in, with the right code: refused, not signed in.
      clear_cookies()
      set_request_cookie("session_id", waiting)
      late = post("/login/code", {"code": guard_code(account[1], 1)})
      assert_eq(res_status(late), 401)
      assert_contains(res_body(late), "Too many wrong codes for this account")
      assert_not(guard_signed_in?())
      assert_eq(User.find(user._key).totp_last_step, stored.totp_last_step, "the code was not spent")
    end

    test("a right password alone no longer wipes them; the right code does") do
      account = guarded_account(true)
      user = account[0]
      guard_password_step(user)
      post("/login/code", {"code": "000000"})
      post("/login/code", {"code": "111111"})
      assert_eq(User.find(user._key).failed_attempts, 2)
      guard_password_step(user)
      assert_eq(User.find(user._key).failed_attempts, 2, "the password step leaves them")
      assert_eq(res_location(post("/login/code", {"code": guard_code(account[1], 1)})), "/app")
      assert_eq(User.find(user._key).failed_attempts, 0)
    end

    test("without it on, a right password still clears the wrong ones") do
      account = guarded_account(false)
      post(
        "/login",
        {"email": account[0].email, "password": "not it"}
      )
      assert_eq(User.find(account[0]._key).failed_attempts, 1)
      guard_password_step(account[0])
      assert_eq(User.find(account[0]._key).failed_attempts, 0)
    end
  end

  describe("turning it on") do
    test("asks for the password: none or a wrong one starts nothing") do
      account = guarded_account(false)
      guard_sign_in(account)
      bare = post("/app/account/two-step", {})
      assert_eq(res_status(bare), 422)
      assert_contains(res_body(bare), "That is not your password: two-step sign-in is still off.")
      assert_null(User.find(account[0]._key).totp_pending)
      wrong = post("/app/account/two-step", {"password": "not it"})
      assert_eq(res_status(wrong), 422)
      assert_null(User.find(account[0]._key).totp_pending)
      assert_contains(res_body(get("/app/account")), "id=\"two_step_password\"")
      right = post("/app/account/two-step", {"password": GUARD_PASSWORD})
      assert_eq(res_status(right), 200)
      assert_not_null(User.find(account[0]._key).pending_two_step)
    end

    test("signs every other browser out, remembered ones too, and keeps this one") do
      account = guarded_account(false)
      user = account[0]
      other_browser = guard_sign_in(account, {"remember_me": "1"})
      assert_not_null(User.find(user._key).remember_token_digest)
      this_browser = guard_sign_in(account)
      post("/app/account/two-step", {"password": GUARD_PASSWORD})
      secret = User.find(user._key).pending_two_step
      done = post("/app/account/two-step/confirm", {"code": guard_code(secret, 0)})
      assert_contains(res_body(done), "Two-step sign-in is on")
      assert(guard_signed_in?(), "this browser")
      stored = User.find(user._key)
      assert_null(stored.remember_token_digest, "no browser is remembered")
      assert_gt(stored.current_session_version, 0)
      clear_cookies()
      set_request_cookie("session_id", other_browser)
      assert_not(guard_signed_in?(), "the other browser")
      assert_ne(this_browser, other_browser)
    end
  end

  describe("deleting the account") do
    test("with it on, asks for a code too: without one or with a wrong one, it stays") do
      account = guarded_account(true)
      user = account[0]
      guard_sign_in(account)
      assert_contains(res_body(get("/app/account")), "id=\"delete_code\"")
      bare = request("DELETE", "/app/account", {"password": GUARD_PASSWORD}, {})
      assert_eq(res_status(bare), 422)
      assert_contains(res_body(bare), "That code is not right, or it was already used: the account is still here.")
      assert_not_null(User.find_by("_key", user._key))
      wrong = request("DELETE", "/app/account", {
        "password": GUARD_PASSWORD,
        "code": "000000"
      }, {})
      assert_eq(res_status(wrong), 422)
      assert_not_null(User.find_by("_key", user._key))
      no_password = request("DELETE", "/app/account", {
        "password": "not it",
        "code": guard_code(account[1], 1)
      }, {})
      assert_eq(res_status(no_password), 422)
      assert_not_null(User.find_by("_key", user._key))
      done = request("DELETE", "/app/account", {
        "password": GUARD_PASSWORD,
        "code": guard_code(account[1], 1)
      }, {})
      assert_eq(res_status(done), 302)
      assert_null(User.find_by("_key", user._key))
    end

    test("without it, the form asks for no code") do
      account = guarded_account(false)
      guard_sign_in(account)
      assert_not(res_body(get("/app/account")).includes?("id=\"delete_code\""))
    end
  end
end
