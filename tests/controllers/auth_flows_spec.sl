# The accounts' second line: a forgotten password, a confirmed address, a
# locked account, a remembered browser, sessions a reset signs out.

const FLOW_PASSWORD = "correct horse battery"

def flow_user(confirmed = true)
  user = User.new()
  user.email = "flow-#{uuid_v4}@example.com"
  user.set_password(FLOW_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix if confirmed
  user.save
  user
end

def flow_sign_in(user, extra = {})
  post("/login", {"email": user.email, "password": FLOW_PASSWORD}.merge(extra))
end

describe("Account flows") do
  before_each() do
    as_guest()
    clear_cookies()
  end

  describe("a forgotten password") do
    test("a reset link opens the form; a wrong or old link does not") do
      user = flow_user()
      token = user.start_password_reset
      assert_contains(res_body(get("/password/edit?token=#{token}")), "Choose a new password")
      assert_contains(res_body(get("/password/edit?token=not-a-token")), "invalid or has expired")
      stale = User.find(user._key)
      stale.reset_sent_at = DateTime.utc.to_unix - AUTH_RESET_TOKEN_TTL - 60
      stale.update
      assert_contains(res_body(get("/password/edit?token=#{token}")), "invalid or has expired")
    end

    test("a reset confirms an address that was not: the link reached its inbox") do
      user = flow_user(false)
      token = user.start_password_reset
      refused = post(
        "/password/update",
        {
          "token": token,
          "password": "short",
          "password_confirmation": "short"
        }
      )
      assert_eq(res_status(refused), 422)
      assert_not(User.find(user._key).confirmed?, "a refused reset confirms nothing")
      done = post(
        "/password/update",
        {
          "token": token,
          "password": "a brand new password",
          "password_confirmation": "a brand new password"
        }
      )
      assert_eq(res_status(done), 302)
      assert(User.find(user._key).confirmed?)
    end

    test("the new password must be long enough and typed twice the same") do
      user = flow_user()
      token = user.start_password_reset
      short = post(
        "/password/update",
        {
          "token": token,
          "password": "short",
          "password_confirmation": "short"
        }
      )
      assert_eq(res_status(short), 422)
      differ = post(
        "/password/update",
        {
          "token": token,
          "password": "a brand new password",
          "password_confirmation": "another"
        }
      )
      assert_eq(res_status(differ), 422)
      assert(User.find(user._key).authenticate(FLOW_PASSWORD))
      unknown = post(
        "/password/update",
        {
          "token": "nope",
          "password": "a brand new password",
          "password_confirmation": "a brand new password"
        }
      )
      assert_contains(res_body(unknown), "invalid or has expired")
    end

    test("a reset changes the password, uses the link up, and signs out the sessions before it") do
      user = flow_user()
      flow_sign_in(user)
      assert_eq(res_status(get("/app/account")), 200)
      token = User.find(user._key).start_password_reset
      User.find(user._key).finish_password_reset("a brand new password")
      assert_eq(res_status(get("/app/account")), 302)
      assert(User.find(user._key).authenticate("a brand new password"))
      reused = post(
        "/password/update",
        {
          "token": token,
          "password": "yet another password",
          "password_confirmation": "yet another password"
        }
      )
      assert_contains(res_body(reused), "invalid or has expired")
    end

    test("through the form, it signs straight in") do
      user = flow_user()
      token = user.start_password_reset
      response = post(
        "/password/update",
        {
          "token": token,
          "password": "a brand new password",
          "password_confirmation": "a brand new password"
        }
      )
      assert_eq(res_location(response), "/app")
      assert_eq(res_status(get("/app/account")), 200)
    end
  end

  describe("a confirmed address") do
    test("the link confirms it once") do
      user = flow_user(false)
      token = user.start_email_confirmation
      assert_contains(res_body(get("/confirm_email?token=#{token}")), "Your email address is confirmed")
      assert(User.find(user._key).confirmed?)
      assert_contains(res_body(get("/confirm_email?token=#{token}")), "invalid or was already used")
    end

    test("an old link no longer confirms") do
      user = flow_user(false)
      token = user.start_email_confirmation
      stale = User.find(user._key)
      stale.confirmation_sent_at = DateTime.utc.to_unix - AUTH_CONFIRMATION_TOKEN_TTL - 60
      stale.update
      assert_contains(res_body(get("/confirm_email?token=#{token}")), "invalid or was already used")
      assert_not(User.find(user._key).confirmed?)
    end

    test("asking for a new link answers the same for any address") do
      assert_eq(res_status(get("/confirmation/resend")), 200)
      user = flow_user(false)
      known = post("/confirmation/resend", {"email": user.email})
      unknown = post("/confirmation/resend", {"email": "nobody-#{uuid_v4}@example.com"})
      assert_contains(res_body(known), "a fresh link is on its way")
      assert_contains(res_body(unknown), "a fresh link is on its way")
    end
  end

  describe("a locked account") do
    test("ten wrong passwords lock it: then even the right one is refused, until the lock runs out") do
      user = flow_user()
      (0 .. AUTH_MAX_FAILED_ATTEMPTS).each do |i|
        post(
          "/login",
          {"email": user.email, "password": "wrong #{i}"}
        )
      end
      assert(User.find(user._key).locked?)
      assert_eq(res_status(flow_sign_in(user)), 401)
      expired = User.find(user._key)
      expired.locked_at = DateTime.utc.to_unix - AUTH_LOCKOUT_SECONDS - 60
      expired.update
      assert_eq(res_status(flow_sign_in(user)), 302)
      assert_eq(User.find(user._key).failed_attempts, 0)
    end
  end

  describe("a remembered browser") do
    test("signs back in from its cookie once the session is gone, and not with a wrong one") do
      user = flow_user()
      response = flow_sign_in(user, {"remember_me": "1"})
      cookie = str(res_headers(response)).split("remember_token=")[1].split(";")[0]
      clear_cookies()
      set_request_cookie("remember_token", cookie)
      assert_eq(res_status(get("/app/account")), 200)
      clear_cookies()
      set_request_cookie("remember_token", "#{user._key}:not-the-token")
      assert_eq(res_status(get("/app/account")), 302)
    end

    test("forgets it on sign-out") do
      user = flow_user()
      flow_sign_in(user, {"remember_me": "1"})
      request("DELETE", "/logout", {}, {})
      assert_null(User.find(user._key).remember_token_digest)
    end
  end
end
