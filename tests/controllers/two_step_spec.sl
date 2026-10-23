# Two-step sign-in through the site: the code after the password, its limits,
# and turning it on and off from the account page.

const STEP_PASSWORD = "correct horse battery"

# A confirmed account, and with `on` its app set up: [user, secret, backup codes].
def step_account(on)
  user = User.new()
  user.email = "step-#{uuid_v4}@example.com"
  user.set_password(STEP_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  unless on
    return [user, nil, []]
  end

  secret = user.start_two_step
  codes = User.find(user._key).confirm_two_step(step_code(secret, 0))
  [user, secret, codes]
end

def step_code(secret, steps)
  Crypto.totp_generate(secret, DateTime.utc.to_unix + 30 * steps, 30)
end

def password_step(user)
  post(
    "/login",
    {"email": user.email, "password": STEP_PASSWORD}
  )
end

def signed_in?
  res_status(get("/app/account")) == 200
end

describe("Two-step sign-in") do
  before_each() do
    as_guest()
    clear_cookies()
  end

  describe("signing in") do
    test("the password alone signs in an account without it") do
      account = step_account(false)
      assert_eq(res_location(password_step(account[0])), "/app")
      assert(signed_in?())
    end

    test("with it on, the password leads to the code, and only the code signs in") do
      account = step_account(true)
      response = password_step(account[0])
      assert_eq(res_location(response), "/login/code")
      assert_not(signed_in?(), "not signed in by the password")
      assert_contains(res_body(get("/login/code")), "six-digit code")
      wrong = post("/login/code", {"code": "000000"})
      assert_eq(res_status(wrong), 401)
      assert_contains(res_body(wrong), "not right, or it was already used")
      assert_not(signed_in?())
      code = step_code(account[1], 1)
      assert_eq(res_location(post("/login/code", {"code": code})), "/app")
      assert(signed_in?())
      # The same code, on the next sign-in: spent.
      clear_cookies()
      password_step(account[0])
      assert_eq(res_status(post("/login/code", {"code": code})), 401)
    end

    test("goes back to the page that asked, after the code") do
      account = step_account(true)
      post(
        "/login",
        {
          "email": account[0].email,
          "password": STEP_PASSWORD,
          "return_to": "/app/scores"
        }
      )
      assert_eq(res_location(post("/login/code", {"code": step_code(account[1], 1)})), "/app/scores")
    end

    test("a backup code signs in once") do
      account = step_account(true)
      password_step(account[0])
      assert_eq(res_status(post("/login/code", {"code": account[2][0]})), 302)
      assert(signed_in?())
      clear_cookies()
      password_step(account[0])
      assert_eq(res_status(post("/login/code", {"code": account[2][0]})), 401)
    end

    test("five wrong codes and the sign-in starts again") do
      account = step_account(true)
      password_step(account[0])
      last = nil
      (1 .. 6).each do |_|
        last = post("/login/code", {"code": "000000"})
      end
      assert_contains(res_body(last), "Too many wrong codes: sign in again")
      # Even the right code now: back to the password.
      assert_eq(res_location(post("/login/code", {"code": step_code(account[1], 1)})), "/login")
      assert_not(signed_in?())
    end

    test("the code page without a password first sends to sign in") do
      assert_eq(res_location(get("/login/code")), "/login")
      assert_eq(res_location(post("/login/code", {"code": "123456"})), "/login")
    end
  end

  describe("the account page") do
    test("turns it on: a QR code and a key, a first code, then the backup codes") do
      account = step_account(false)
      password_step(account[0])
      assert_contains(res_body(get("/app/account")), "Turn two-step sign-in on")
      page = res_body(post("/app/account/two-step", {}))
      assert_contains(page, "data-qr=\"otpauth://totp/EUI%20Score:")
      secret = User.find(account[0]._key).pending_two_step
      assert_contains(page, secret)
      wrong = post("/app/account/two-step/confirm", {"code": "000000"})
      assert_eq(res_status(wrong), 422)
      assert_not(User.find(account[0]._key).two_step?)
      done = res_body(post("/app/account/two-step/confirm", {"code": step_code(secret, 0)}))
      assert_contains(done, "Two-step sign-in is on")
      assert_eq(done.split("<li><code>").length - 1, 10)
      assert(User.find(account[0]._key).two_step?)
      assert_contains(res_body(get("/app/account")), "10 backup codes left")
    end

    test("turns it off with the password and a code, and not without both") do
      account = step_account(true)
      password_step(account[0])
      post("/login/code", {"code": step_code(account[1], 1)})
      refused = post(
        "/app/account/two-step/stop",
        {"password": "not it", "code": step_code(account[1], 2)}
      )
      assert_eq(res_status(refused), 422)
      assert(User.find(account[0]._key).two_step?)
      refused = post(
        "/app/account/two-step/stop",
        {"password": STEP_PASSWORD, "code": "000000"}
      )
      assert_eq(res_status(refused), 422)
      assert(User.find(account[0]._key).two_step?)
      assert_eq(res_status(post(
        "/app/account/two-step/stop",
        {"password": STEP_PASSWORD, "code": account[2][1]}
      )), 302)
      assert_not(User.find(account[0]._key).two_step?)
    end

    test("a guest cannot reach any of it") do
      assert_eq(res_status(post("/app/account/two-step", {})), 302)
      assert_eq(res_status(post("/app/account/two-step/confirm", {"code": "123456"})), 302)
    end
  end
end
