# Accounts: sign up, sign in, the account page, a forgotten password.

const SPEC_PASSWORD = "correct horse battery"

# The signed render time a form page carries, which spam_check reads. (Its
# CSRF token is bound to that page's session, which the spec client does not
# keep: a post without one passes the origin check, as tokens are only
# required where SOLI_CSRF_TOKENS says so.)
def form_fields(path)
  body = res_body(get(path))
  parts = body.split("name=\"_soli_ts\" value=\"")
  fields = {"_soli_ts": parts.length > 1 ? parts[1].split("\"")[0] : ""}
  challenge = body.split("data-soli-pow=\"")
  fields["_soli_pow"] = solve_pow(challenge[1].split("\"")[0]) if challenge.length > 1
  fields
end

# The proof of work a sign-up page asks for, solved as /__soli/pow.js does:
# `<challenge>:<nonce>` whose SHA-256 starts with the bits it names — eight
# under .env.test (SIGNUP_POW_BITS), two zero hex digits.
def solve_pow(challenge)
  nonce = 0
  while !Crypto.sha256("#{challenge}:#{nonce}").starts_with?("00")
    nonce += 1
  end
  "#{challenge}:#{nonce}"
end

def fresh_email
  "spec-#{uuid_v4}@example.com"
end

# An account whose address is confirmed, unless `confirmed` says otherwise.
def make_user(email, confirmed = true)
  user = User.new()
  user.email = email
  user.set_password(SPEC_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix if confirmed
  user.save()
  user
end

def sign_in_as(email)
  post("/login", form_fields("/login").merge({
    "email": email,
    "password": SPEC_PASSWORD
  }))
end

# Whether an AuthMailJob row queued for `email` has still to run.
def accounts_mail_job_pending(email)
  pending = Job.list().filter do |job|
    str(job["handler"]).contains("AuthMailJob") && str(job).contains(email) &&
        ["pending", "scheduled", "running"].includes?(job["state"])
  end
  pending.length > 0
end

# Waits (up to 10 s) until the AuthMailJob rows queued for `email` have run.
def accounts_mail_jobs_done(email)
  waited = 0
  while waited < 40 && accounts_mail_job_pending(email)
    sleep(0.25)
    waited += 1
  end
  true
end
describe("Accounts") do
  before_each() do
    as_guest()
    clear_cookies()
  end

  describe("POST /signup") do
    test("creates the account, asks to confirm the address, and signs in once it is") do
      email = fresh_email()
      fields = form_fields("/signup")
      sleep(2.1)
      response = post("/signup", fields.merge({
        "email": email,
        "password": SPEC_PASSWORD
      }))
      assert_eq(res_status(response), 200)
      assert_contains(res_body(response), "Check your inbox")
      assert_contains(res_body(response), "We sent a link to #{email}")
      user = User.find_by("email", email)
      assert_not(user.confirmed?)
      assert_eq(res_status(get("/app/account")), 302, "not signed in yet")
      # Refused until the address is confirmed, as a wrong password is (#539:
      # a sign-in must not say the account exists), with the way to get a
      # new link that every refused sign-in shows.
      refused = sign_in_as(email)
      assert_eq(res_status(refused), 401)
      assert_contains(res_body(refused), "Invalid email or password")
      assert_contains(res_body(refused), "Confirm your address first")
      assert_contains(res_body(refused), "Send the link again")
      assert_eq(res_status(get("/app/account")), 302)
      # The right password queued the link again (AuthMailJob, which the test
      # server runs): once it has, the link made here is the last one.
      accounts_mail_jobs_done(email)
      token = User.find(user._key).start_email_confirmation
      assert_contains(res_body(get("/confirm_email?token=#{token}")), "Your email address is confirmed")
      assert_eq(res_status(sign_in_as(email)), 302)
      assert_eq(res_status(get("/app/account")), 200)
    end

    test("refuses a password under 12 characters, and creates nothing") do
      email = fresh_email()
      fields = form_fields("/signup")
      sleep(2.1)
      response = post("/signup", fields.merge({
        "email": email,
        "password": "short"
      }))
      assert_eq(res_status(response), 422)
      assert_contains(res_body(response), "at least 12 characters")
      assert_null(User.find_by("email", email))
    end

    test("makes no second account for an email that has one, and says no more than for a new one (#539)") do
      email = fresh_email()
      make_user(email)
      fields = form_fields("/signup")
      sleep(2.1)
      response = post("/signup", fields.merge({
        "email": email.upcase,
        "password": "another long password"
      }))
      assert_eq(res_status(response), 200)
      assert_contains(res_body(response), "We sent a link to #{email}")
      assert_eq(User.where({"email": email}).count, 1)
      assert(User.find_by("email", email).authenticate(SPEC_PASSWORD), "its password unchanged")
    end

    test("refuses a bot: the hidden field filled, or the form never loaded") do
      email = fresh_email()
      fields = form_fields("/signup")
      sleep(2.1)
      filled = post("/signup", fields.merge({
        "email": email,
        "password": SPEC_PASSWORD,
        "_soli_url": "http://spam.example"
      }))
      assert_eq(res_status(filled), 200, "answered as a sign-up")
      unloaded = post(
        "/signup",
        {"email": email, "password": SPEC_PASSWORD}
      )
      assert_ne(res_status(unloaded), 302)
      assert_null(User.find_by("email", email))
    end

    test("refuses a form without its proof of work, and says JavaScript is needed") do
      email = fresh_email()
      fields = form_fields("/signup")
      sleep(2.1)
      response = post("/signup", fields.merge({
        "email": email,
        "password": SPEC_PASSWORD,
        "_soli_pow": "#{fields["_soli_pow"].split(":")[0]}:0x"
      }))
      assert_eq(res_status(response), 422)
      assert_contains(res_body(response), "needs JavaScript")
      # Left out altogether, as a bot that never runs the page's script does.
      fields.delete("_soli_pow")
      missing = post("/signup", fields.merge({
        "email": email,
        "password": SPEC_PASSWORD
      }))
      assert_eq(res_status(missing), 422)
      assert_contains(res_body(missing), "needs JavaScript")
      assert_null(User.find_by("email", email))
    end

    test("asks the browser for a proof of work, and says so without JavaScript") do
      body = res_body(get("/signup"))
      assert_contains(body, "data-soli-pow=\"")
      assert_contains(body, "<noscript>")
    end

    test("refuses a throwaway address, its subdomains too, and creates nothing") do
      ["someone-#{uuid_v4}@mailinator.com", "someone-#{uuid_v4}@inbox.yopmail.com"].each do |email|
        fields = form_fields("/signup")
        sleep(2.1)
        response = post("/signup", fields.merge({
          "email": email,
          "password": SPEC_PASSWORD
        }))
        assert_eq(res_status(response), 422, email)
        assert_contains(res_body(response), "an address you keep")
        assert_null(User.find_by("email", email))
      end
    end

    test("answers a bot as a sign-up, with no account and no mail") do
      email = fresh_email()
      fields = form_fields("/signup")
      sleep(2.1)
      response = post("/signup", fields.merge({
        "email": email,
        "password": SPEC_PASSWORD,
        "_soli_url": "http://spam.example"
      }))
      assert_eq(res_status(response), 200)
      assert_contains(res_body(response), "Check your inbox")
      assert_null(User.find_by("email", email))
    end

    test("refuses a form sent back straight away") do
      email = fresh_email()
      response = post("/signup", form_fields("/signup").merge({
        "email": email,
        "password": SPEC_PASSWORD
      }))
      assert_eq(res_status(response), 422)
      assert_contains(res_body(response), "That was quick")
      assert_null(User.find_by("email", email))
    end
  end

  describe("User.throwaway_email?") do
    test("knows the throwaway domains and their subdomains, not a lasting address") do
      assert(User.throwaway_email?("A@Mailinator.com "))
      assert(User.throwaway_email?("a@x.guerrillamail.com"))
      assert_not(User.throwaway_email?("a@gmail.com"))
      assert_not(User.throwaway_email?("a@notmailinator.com"))
      assert_not(User.throwaway_email?(""))
      assert_not(User.throwaway_email?(nil))
    end
  end

  describe("POST /login") do
    test("signs in, and goes back to the app page that asked for it") do
      email = fresh_email()
      make_user(email)
      fields = form_fields("/login?return_to=/app/account")
      response = post("/login", fields.merge({
        "email": email,
        "password": SPEC_PASSWORD,
        "return_to": "/app/account"
      }))
      assert_eq(res_status(response), 302)
      assert_eq(res_location(response), "/app/account")
    end

    test("never goes back to another site") do
      email = fresh_email()
      make_user(email)
      ["//evil.example/app", "https://evil.example", "/app//evil.example", "/elsewhere"].each do |target|
        clear_cookies()
        fields = form_fields("/login")
        response = post("/login", fields.merge({
          "email": email,
          "password": SPEC_PASSWORD,
          "return_to": target
        }))
        assert_eq(res_location(response), "/app", target)
      end
    end

    test("answers a wrong password and an unknown address the same way") do
      email = fresh_email()
      make_user(email)
      wrong = post("/login", form_fields("/login").merge({
        "email": email,
        "password": "not the password"
      }))
      unknown = post("/login", form_fields("/login").merge({
        "email": fresh_email(),
        "password": SPEC_PASSWORD
      }))
      assert_eq(res_status(wrong), 401)
      assert_eq(res_status(unknown), 401)
      assert_contains(res_body(wrong), "Invalid email or password")
      assert_contains(res_body(unknown), "Invalid email or password")
      assert_eq(res_status(get("/app/account")), 302)
    end
  end

  describe("GET /app/account") do
    test("sends a guest to sign in, to come back here") do
      response = get("/app/account")
      assert_eq(res_status(response), 302)
      assert_eq(res_location(response), "/login?return_to=%2Fapp%2Faccount")
    end

    test("shows who is signed in, with a way out") do
      email = fresh_email()
      make_user(email)
      sign_in_as(email)
      body = res_body(get("/app/account"))
      assert_contains(body, email)
      assert_contains(body, "Sign out")
    end
  end

  describe("POST /app/account/password") do
    test("refuses without the current password, which still works after") do
      email = fresh_email()
      user = make_user(email)
      sign_in_as(email)
      response = post("/app/account/password", form_fields("/app/account").merge({
        "current_password": "a wrong one entirely",
        "password": "a brand new password",
        "password_confirmation": "a brand new password"
      }))
      assert_eq(res_status(response), 422)
      assert_contains(res_body(response), "not your current password")
      assert(User.find(user._key).authenticate(SPEC_PASSWORD))
    end

    test("refuses two new passwords that differ") do
      email = fresh_email()
      user = make_user(email)
      sign_in_as(email)
      response = post("/app/account/password", form_fields("/app/account").merge({
        "current_password": SPEC_PASSWORD,
        "password": "a brand new password",
        "password_confirmation": "another new password"
      }))
      assert_eq(res_status(response), 422)
      assert(User.find(user._key).authenticate(SPEC_PASSWORD))
    end

    test("changes it, and this browser stays signed in") do
      email = fresh_email()
      user = make_user(email)
      sign_in_as(email)
      response = post("/app/account/password", form_fields("/app/account").merge({
        "current_password": SPEC_PASSWORD,
        "password": "a brand new password",
        "password_confirmation": "a brand new password"
      }))
      assert_eq(res_status(response), 302)
      stored = User.find(user._key)
      assert(stored.authenticate("a brand new password"))
      assert_not(stored.authenticate(SPEC_PASSWORD))
      assert_contains(res_body(get("/app/account")), "Password changed")
    end
  end

  describe("DELETE /app/account") do
    test("keeps the account when the password is wrong") do
      email = fresh_email()
      make_user(email)
      sign_in_as(email)
      response = request("DELETE", "/app/account", {"password": "wrong"}, {})
      assert_eq(res_status(response), 422)
      assert_not_null(User.find_by("email", email))
    end

    test("deletes it with the password, and signs out") do
      email = fresh_email()
      make_user(email)
      sign_in_as(email)
      response = request("DELETE", "/app/account", {"password": SPEC_PASSWORD}, {})
      assert_eq(res_status(response), 302)
      assert_null(User.find_by("email", email))
      assert_eq(res_status(get("/app/account")), 302)
    end

    test("takes the photo readings and the AI requests with it, sources and prompts included") do
      user = make_user(fresh_email())
      other = make_user(fresh_email())
      score = Score.start(user, Score.blank_source("Asked"))
      [user, other].each do |owner|
        ScoreReading.create({
          "user_id": owner._key,
          "state": "done",
          "source": "{ c'1 }",
          "created_at": DateTime.utc.to_unix
        })
        ScoreSuggestion.create({
          "user_id": owner._key,
          "score_id": score._key,
          "action": "ask",
          "request": "A private prompt",
          "original": score.source,
          "state": "done",
          "created_at": DateTime.utc.to_unix
        })
      end
      sign_in_as(user.email)
      response = request("DELETE", "/app/account", {"password": SPEC_PASSWORD}, {})
      assert_eq(res_status(response), 302)
      assert_eq(ScoreReading.where({"user_id": user._key}).count, 0)
      assert_eq(ScoreSuggestion.where({"user_id": user._key}).count, 0)
      assert_eq(ScoreSuggestion.where({"score_id": score._key}).count, 0, "asked of the deleted score")
      assert_eq(ScoreReading.where({"user_id": other._key}).count, 1, "someone else's reading stays")
      # The page after clears what the browser kept of the app.
      assert_contains(res_body(get(res_location(response))), "data-signed-out")
    end

    test("a wrong password leaves the readings and requests where they were") do
      user = make_user(fresh_email())
      ScoreReading.create({
        "user_id": user._key,
        "state": "done",
        "source": "{ c'1 }",
        "created_at": DateTime.utc.to_unix
      })
      sign_in_as(user.email)
      request("DELETE", "/app/account", {"password": "wrong"}, {})
      assert_eq(ScoreReading.where({"user_id": user._key}).count, 1)
    end
  end

  describe("DELETE /logout") do
    test("signs out") do
      email = fresh_email()
      make_user(email)
      sign_in_as(email)
      response = request("DELETE", "/logout", {}, {})
      assert_eq(res_status(response), 302)
      assert_eq(res_status(get("/app/account")), 302)
    end

    test("the page after clears the app's pages kept offline and the editor's unsent text, once") do
      email = fresh_email()
      make_user(email)
      sign_in_as(email)
      assert_not(res_body(get("/login")).includes?("data-signed-out"), "not before signing out")
      response = request("DELETE", "/logout", {}, {})
      # The spec client drops every cookie on a /logout path; a browser keeps
      # the new session's, which carries the flash.
      headers = res_headers(response)
      session_cookie = (headers["set-cookie"] ?? headers["Set-Cookie"]).to_s.split(";")[0]
      assert_contains(session_cookie, "session_id=")
      set_request_cookie("session_id", session_cookie.split("=")[1])
      page = res_body(get(res_location(response)))
      assert_contains(page, "You are signed out.")
      assert_contains(page, "data-signed-out")
      assert_contains(page, "\"eui-score-pending:\"")
      assert_contains(page, "\"eui-score-pages\"")
      assert_contains(page, "type: \"signed-out\"")
      assert_not(res_body(get("/login")).includes?("data-signed-out"), "only on the page right after")
    end
  end

  describe("POST /password/reset") do
    test("says the same whether the address has an account or not") do
      email = fresh_email()
      make_user(email)
      known = post("/password/reset", form_fields("/password/reset").merge({"email": email}))
      unknown = post("/password/reset", form_fields("/password/reset").merge({"email": fresh_email()}))
      assert_eq(res_status(known), res_status(unknown))
      assert_contains(res_body(known), "If that email exists")
      assert_contains(res_body(unknown), "If that email exists")
    end
  end

  describe("the app's header") do
    test("offers to sign in to a guest, and the account once signed in") do
      guest_page = res_body(get("/app"))
      assert_contains(guest_page, "href=\"/login\"")
      assert_contains(guest_page, "Create account")
      email = fresh_email()
      make_user(email)
      sign_in_as(email)
      member_page = res_body(get("/app/account"))
      assert_contains(member_page, "href=\"/app/account\"")
      assert_not(member_page.contains("Create account"))
    end
  end

  describe("the address on the account page") do
    test("says it is confirmed, or offers to send the link again") do
      confirmed = make_user(fresh_email())
      sign_in_as(confirmed.email)
      page = res_body(get("/app/account"))
      assert_contains(page, "Confirmed")
      assert_not(page.includes?("Send the link again"))
      clear_cookies()
      # An account from before addresses were confirmed, still signed in.
      unconfirmed = make_user(fresh_email())
      sign_in_as(unconfirmed.email)
      stale = User.find(unconfirmed._key)
      stale.confirmed_at = nil
      stale.save
      page = res_body(get("/app/account"))
      assert_contains(page, "Not confirmed yet")
      assert_contains(page, "Send the link again")
      # The button sends a fresh link: a new token replaces the old one.
      # The link is made by the queued AuthMailJob (#539), which the test
      # server runs: wait for it.
      before = User.find(unconfirmed._key).confirmation_token_digest
      post("/confirmation/resend", {"email": unconfirmed.email})
      waited = 0
      while User.find(unconfirmed._key).confirmation_token_digest == before && waited < 40
        sleep(0.25)
        waited += 1
      end
      assert_ne(User.find(unconfirmed._key).confirmation_token_digest, before)
    end
  end
end
