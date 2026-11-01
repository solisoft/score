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

# `times` account emails asked for `email`, a confirmation and a reset in
# turn: the answers' statuses.
def flow_ask_emails(email, times)
  (0 .. times).map do |i|
    path = i % 2 == 0 ? "/confirmation/resend" : "/password/reset"
    res_status(post(path, {"email": email}))
  end
end

# The AuthMailJob rows queued for `email` all run (#539: the test server
# runs the queue), so what they write is written.
def flow_mail_jobs_waiting(email)
  Job.list().filter do |job|
    waiting = ["pending", "running", "scheduled"].includes?(job["state"].to_s)
    waiting && str(job["handler"]).contains("AuthMailJob") && str(job["args"]).contains(email)
  end.length
end

def flow_mail_jobs_settle(email)
  waited = 0
  while waited < 40 && flow_mail_jobs_waiting(email) > 0
    sleep(0.25)
    waited += 1
  end
  true
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

  describe("account emails asked for") do
    test("to one address: an hour's few, then refused the same whether it has an account or not") do
      user = flow_user(false)
      nobody = "nobody-#{uuid_v4}@example.com"
      # Resends and resets share one count per address.
      assert_eq(flow_ask_emails(user.email, AUTH_EMAILS_PER_ADDRESS), (0 .. AUTH_EMAILS_PER_ADDRESS).map(&{ |_|
        200
      }))
      assert_eq(flow_ask_emails(nobody, AUTH_EMAILS_PER_ADDRESS), (0 .. AUTH_EMAILS_PER_ADDRESS).map(&{ |_|
        200
      }))
      flow_mail_jobs_settle(user.email)
      digest = User.find(user._key).confirmation_token_digest
      reset_digest = User.find(user._key).reset_token_digest
      known = post("/confirmation/resend", {"email": " #{user.email.upcase} "})
      unknown = post("/confirmation/resend", {"email": nobody})
      assert_eq(res_status(known), 429)
      assert_eq(res_status(unknown), 429)
      assert_eq(res_body(known).replace(user.email.upcase, ""), res_body(unknown).replace(nobody, ""))
      assert_contains(res_body(known), "Too many emails asked for: try again in an hour.")
      assert_not(res_body(known).contains("on its way"))
      reset = post("/password/reset", {"email": user.email})
      assert_eq(res_status(reset), 429)
      assert_contains(res_body(reset), "Too many emails asked for")
      flow_mail_jobs_settle(user.email)
      assert_eq(User.find(user._key).confirmation_token_digest, digest, "no new link made")
      assert_eq(User.find(user._key).reset_token_digest, reset_digest, "no reset link made")
      # Another address is not held up.
      assert_contains(res_body(post("/confirmation/resend", {"email": "other-#{uuid_v4}@example.com"})), "on its way")
    end

    test("from one source address: so many, whatever the addresses") do
      ip = "203.0.113.#{uuid_v4}"
      (0 .. AUTH_EMAILS_PER_IP).each do |i|
        assert(User.account_email_allowed?("someone-#{i}-#{uuid_v4}@example.com", ip))
      end
      assert_not(User.account_email_allowed?("fresh-#{uuid_v4}@example.com", ip))
      assert(User.account_email_allowed?("fresh-#{uuid_v4}@example.com", "198.51.100.#{uuid_v4}"))
    end

    test("a refusal on one count does not spend the other") do
      address = "spent-#{uuid_v4}@example.com"
      ip = "192.0.2.#{uuid_v4}"
      (0 .. AUTH_EMAILS_PER_ADDRESS).each do |_|
        assert(User.account_email_allowed?(address, ip))
      end
      (0 .. 3).each do |_|
        assert_not(User.account_email_allowed?(address, ip))
      end
      left = RateLimiter("account-email-ip:#{ip}", AUTH_EMAILS_PER_IP, AUTH_EMAILS_WINDOW_SECONDS).status()["remaining"]
      assert_eq(left, AUTH_EMAILS_PER_IP - AUTH_EMAILS_PER_ADDRESS)
    end
  end

  describe("a locked account") do
    test("ten wrong passwords lock it from that address: then even the right one is refused there") do
      user = flow_user()
      (0 .. AUTH_MAX_FAILED_ATTEMPTS).each do |i|
        post(
          "/login",
          {"email": user.email, "password": "wrong #{i}"}
        )
      end
      assert(User.find(user._key).locked?)
      assert_eq(res_status(flow_sign_in(user)), 401)
      # The lock is that address's (#539): the whole account's, from before,
      # is still honoured until it runs out, and then lifted.
      old_lock = flow_user()
      locked = User.find(old_lock._key)
      locked.locked_at = DateTime.utc.to_unix
      locked.failed_attempts = AUTH_MAX_FAILED_ATTEMPTS
      locked.update
      assert_eq(res_status(flow_sign_in(old_lock)), 401)
      expired = User.find(old_lock._key)
      expired.locked_at = DateTime.utc.to_unix - AUTH_LOCKOUT_SECONDS - 60
      expired.update
      assert_eq(res_status(flow_sign_in(old_lock)), 302)
      assert_eq(User.find(old_lock._key).failed_attempts, 0)
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
      signed_in = flow_sign_in(user, {"remember_me": "1"})
      cookie = str(res_headers(signed_in)).split("remember_token=")[1].split(";")[0]
      set_request_cookie("remember_token", cookie)
      response = request("DELETE", "/logout", {}, {})
      assert_null(User.find(user._key).remember_token_digest)
      # The browser's cookie is expired too.
      assert_contains(str(res_headers(response)), "remember_token=; Path=/; Max-Age=0")
    end
  end
end
