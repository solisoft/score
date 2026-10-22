# Accounts: sign up, sign in, the account page, a forgotten password.

const SPEC_PASSWORD = "correct horse battery"

# The signed render time a form page carries, which spam_check reads. (Its
# CSRF token is bound to that page's session, which the spec client does not
# keep: a post without one passes the origin check, as tokens are only
# required where SOLI_CSRF_TOKENS says so.)
def form_fields(path)
  parts = res_body(get(path)).split("name=\"_soli_ts\" value=\"")
  {"_soli_ts": parts.length > 1 ? parts[1].split("\"")[0] : ""}
end

def fresh_email
  "spec-#{uuid_v4}@example.com"
end

def make_user(email)
  user = User.new()
  user.email = email
  user.set_password(SPEC_PASSWORD)
  user.save()
  user
end

def sign_in_as(email)
  post("/login", form_fields("/login").merge({
    "email": email,
    "password": SPEC_PASSWORD
  }))
end

describe("Accounts") do
  before_each() do
    as_guest()
    clear_cookies()
  end

  describe("POST /signup") do
    test("creates the account and signs it in, once the form has been on screen a moment") do
      email = fresh_email()
      fields = form_fields("/signup")
      sleep(2.1)
      response = post("/signup", fields.merge({
        "email": email,
        "password": SPEC_PASSWORD
      }))
      assert_eq(res_status(response), 302)
      assert_eq(res_location(response), "/app")
      assert_not_null(User.find_by("email", email))
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

    test("refuses an email that already has an account") do
      email = fresh_email()
      make_user(email)
      fields = form_fields("/signup")
      sleep(2.1)
      response = post("/signup", fields.merge({
        "email": email.upcase,
        "password": SPEC_PASSWORD
      }))
      assert_eq(res_status(response), 422)
      assert_eq(User.where({"email": email}).count, 1)
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
      assert_eq(res_status(filled), 422)
      unloaded = post(
        "/signup",
        {"email": email, "password": SPEC_PASSWORD}
      )
      assert_ne(res_status(unloaded), 302)
      assert_null(User.find_by("email", email))
    end

    test("refuses a form sent back straight away") do
      email = fresh_email()
      response = post("/signup", form_fields("/signup").merge({
        "email": email,
        "password": SPEC_PASSWORD
      }))
      assert_eq(res_status(response), 422)
      assert_null(User.find_by("email", email))
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
end
