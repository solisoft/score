# The account's security after audit #518 (#539): the access tokens go
# when the password or the address changes; the current password is not
# guessed from a signed-in page; the account e-mails a form asks for answer
# in the same time whatever the address; sign-up does not say an address is
# taken; a known address cannot be kept locked by someone else; an old
# reset link dies with the password.

const GUARD_PASSWORD = "correct horse battery"
const GUARD_NEW_PASSWORD = "a brand new password"

def guard_user(confirmed = true)
  user = User.new()
  user.email = "guard-#{uuid_v4}@example.com"
  user.set_password(GUARD_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix if confirmed
  user.save
  user
end

def guard_sign_in(user, password = GUARD_PASSWORD)
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": password}
  )
end

# An MCP ping with `token`: the answer's status.
def guard_mcp_status(token)
  clear_headers()
  set_header("Content-Type", "application/json")
  set_header("Authorization", "Bearer " + token)
  response = post("/mcp", {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "ping"
  }.to_json)
  clear_headers()
  res_status(response)
end

# A personal token and a connection by OAuth of `user`'s: [access token,
# OAuth access token, OAuth refresh token, the client].
def guard_tokens(user)
  client = OauthClient.register("Spec app", ["https://app.example/callback"])
  oauth = AccessToken.issue_oauth(user, client)
  [AccessToken.issue(user, "Laptop")["token"], oauth["token"], oauth["refresh_token"], client]
end

# Every token `made` (guard_tokens) refused, and none of `user`'s left.
def guard_tokens_dead(user, made)
  assert_eq(guard_mcp_status(made[0]), 401, "the personal token")
  assert_eq(guard_mcp_status(made[1]), 401, "the OAuth access token")
  assert_null(AccessToken.refresh_oauth(made[2], made[3].client_id), "the refresh token")
  assert_eq(AccessToken.where({"user_id": user._key}).count, 0)
end

# The AuthMailJob rows queued for `email`. The test server's worker runs
# them meanwhile: a spec preparing one of them (AuthMailJob.prepare) races
# with it, which is harmless — every run of one letter makes the same link
# (guard_letter_digest), whichever comes first.
def guard_mail_jobs(email)
  Job.list().filter do |job|
    str(job["handler"]).contains("AuthMailJob") && str(job).contains(email)
  end
end

# The arguments `job` (a row of Job.list) was queued with.
def guard_job_args(job)
  job["args"]
end

# The digest of the link the letter of `args` carries, made by the spec or
# the server's worker, whichever ran it first (AuthMailJob.link_token).
def guard_letter_digest(args)
  Crypto.sha256(AuthMailJob.letter_token(args["letter"], getenv("SOLI_ENCRYPTION_KEY")))
end

# The page `response` shows, `address` taken out, and the time it was
# rendered at (the form's signed `_soli_ts`, csrf_field): two pages rendered
# a second apart differ there and nowhere else, which is not an answer
# telling one address from another.
def guard_page(response, address)
  Regex.replace_all(
    "name=\"_soli_ts\" value=\"[^\"]*\"",
    res_body(response).replace(address, ""),
    "name=\"_soli_ts\""
  )
end

# The signed render time and proof of work a sign-up page carries.
def guard_signup_fields
  body = res_body(get("/signup"))
  parts = body.split("name=\"_soli_ts\" value=\"")
  fields = {"_soli_ts": parts.length > 1 ? parts[1].split("\"")[0] : ""}
  challenge = body.split("data-soli-pow=\"")
  if challenge.length > 1
    puzzle = challenge[1].split("\"")[0]
    nonce = 0
    while !Crypto.sha256("#{puzzle}:#{nonce}").starts_with?("00")
      nonce += 1
    end
    fields["_soli_pow"] = "#{puzzle}:#{nonce}"
  end
  fields
end

# AUTH_MAX_FAILED_ATTEMPTS wrong sign-ins at `user` from `source`.
def guard_lock(user, source)
  (0 .. AUTH_MAX_FAILED_ATTEMPTS).each do |_|
    User.find(user._key).register_failed_attempt(source)
  end
end

def guard_change_password(current)
  post(
    "/app/account/password",
    {
      "current_password": current,
      "password": GUARD_NEW_PASSWORD,
      "password_confirmation": GUARD_NEW_PASSWORD
    }
  )
end

const GUARD_REDIRECT = "https://app.example/callback"
const GUARD_VERIFIER = "guard-verifier-0123456789-abcdefghijklmnopqrstuvwxyz"

# An authorization code of `user`'s for `client` (OauthClient), as the consent
# page issues it: [the code, the client's id].
def guard_oauth_code(user, client)
  challenge = Base64.urlsafe_encode(Hex.decode(Crypto.sha256(GUARD_VERIFIER)))
  [OauthCode.issue(client.client_id, user, GUARD_REDIRECT, challenge), client.client_id]
end

# The status of the exchange of `code` (guard_oauth_code) at /oauth/token.
def guard_exchange_status(code)
  clear_headers()
  res_status(post(
    "/oauth/token",
    {
      "grant_type": "authorization_code",
      "code": code[0],
      "client_id": code[1],
      "redirect_uri": GUARD_REDIRECT,
      "code_verifier": GUARD_VERIFIER
    }
  ))
end

# The name the password tries of `user`'s current round are counted under
# (RateCount, as User counts them).
def guard_password_tries(user)
  "password-check:#{user._key}:#{user._password_round}"
end

# A User that, asked to check a password, notes whether its password tries
# were spent already at that moment: whether a try is counted before the
# (slow) check, or after it, which parallel requests slip past.
class GuardCountingUser < User
  def authenticate(plaintext)
    tries = guard_password_tries(this)
    @spent_at_check = RateCount.spent?(tries, ACCOUNT_PASSWORD_TRIES, ACCOUNT_PASSWORD_WINDOW)
    plaintext == GUARD_PASSWORD
  end
end

# A sign-in at `user` in a browser that keeps its cookies, `device` (a
# device cookie) set when given.
def guard_sign_in_with(user, device, password = GUARD_PASSWORD)
  clear_cookies()
  set_request_cookie("device", device) unless device.nil?
  post(
    "/login",
    {"email": user.email, "password": password}
  )
end

# How many resets `address` is still sent before /password/reset answers 429.
def guard_resets_allowed(address)
  sent = 0
  while sent <= AUTH_EMAILS_PER_ADDRESS && res_status(post("/password/reset", {"email": address})) == 200
    sent += 1
  end
  sent
end

# The `device` cookie `response` sets, or nil.
def guard_device_set(response)
  headers = str(res_headers(response))
  parts = headers.split("device=")
  return nil if parts.length < 2

  parts[1].split(";")[0]
end

# AUTH_ACCOUNT_MAX_FAILURES wrong sign-ins at `user`, each from another /64.
def guard_lock_account(user)
  (0 .. AUTH_ACCOUNT_MAX_FAILURES).each do |i|
    User.find(user._key).register_failed_attempt("2001:db8:#{i}::1")
  end
end

describe("Account security (#539)") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  describe("the access tokens") do
    test("work until the password is reset, and not after") do
      user = guard_user()
      made = guard_tokens(user)
      assert_eq(guard_mcp_status(made[0]), 200)
      assert_eq(guard_mcp_status(made[1]), 200)
      token = User.find(user._key).start_password_reset
      assert_contains(res_body(get("/password/edit?token=#{token}")), "disconnects the apps")
      response = post(
        "/password/update",
        {
          "token": token,
          "password": GUARD_NEW_PASSWORD,
          "password_confirmation": GUARD_NEW_PASSWORD
        }
      )
      assert_eq(res_status(response), 302)
      guard_tokens_dead(user, made)
    end

    test("go when the password is changed, and the notice says so") do
      user = guard_user()
      made = guard_tokens(user)
      guard_sign_in(user)
      response = guard_change_password(GUARD_PASSWORD)
      assert_eq(res_status(response), 302)
      guard_tokens_dead(user, made)
      assert_contains(res_body(get("/app/account")), "connect them again")
    end

    test("stay when the password change is refused") do
      user = guard_user()
      made = guard_tokens(user)
      guard_sign_in(user)
      assert_eq(res_status(guard_change_password("not the password")), 422)
      assert_eq(guard_mcp_status(made[0]), 200)
      assert_eq(AccessToken.where({"user_id": user._key}).count, 2)
    end

    test("go when the address changes") do
      user = guard_user()
      made = guard_tokens(user)
      link = User.find(user._key).start_email_change("moved-#{uuid_v4}@example.com")
      assert_contains(res_body(get("/account/email?token=#{link}")), "connect them again")
      assert_eq(res_status(post("/account/email", {"token": link})), 200)
      assert_eq(User.find(user._key).email_change_to, nil, "the change made")
      guard_tokens_dead(user, made)
    end

    test("a new one asks for the password, and a wrong or missing one makes none") do
      user = guard_user()
      guard_sign_in(user)
      missing = post("/app/account/tokens", {"name": "Claude Code"})
      assert_eq(res_status(missing), 422)
      assert_contains(res_body(missing), "your password")
      wrong = post(
        "/app/account/tokens",
        {"name": "Claude Code", "password": "not the password"}
      )
      assert_eq(res_status(wrong), 422)
      assert_not(res_body(wrong).contains("<code>score_"), "no token shown")
      assert_eq(AccessToken.where({"user_id": user._key}).count, 0)
      made = post(
        "/app/account/tokens",
        {"name": "Claude Code", "password": GUARD_PASSWORD}
      )
      assert_eq(res_status(made), 200)
      assert_contains(res_body(made), "<code>score_")
      assert_eq(AccessToken.where({"user_id": user._key}).count, 1)
      assert_contains(res_body(get("/app/account")), "id=\"token_password\" name=\"password\"")
    end
  end

  describe("the current password, from a signed-in page") do
    test("a few wrong ones, then refused even when right, and nothing changes") do
      user = guard_user()
      guard_sign_in(user)
      (0 .. ACCOUNT_PASSWORD_TRIES).each do |i|
        assert_eq(res_status(guard_change_password("wrong #{i}")), 422)
      end
      blocked = guard_change_password(GUARD_PASSWORD)
      assert_eq(res_status(blocked), 429)
      assert_contains(res_body(blocked), "Too many wrong passwords")
      assert(User.find(user._key).authenticate(GUARD_PASSWORD), "the password is unchanged")
      # The same count for deleting the account, turning two-step off and making a token.
      gone = request("DELETE", "/app/account", {"password": GUARD_PASSWORD}, {})
      assert_eq(res_status(gone), 429)
      assert_not_null(User.find_by("_key", user._key), "the account is still here")
      assert_eq(res_status(post(
        "/app/account/two-step/stop",
        {"password": GUARD_PASSWORD, "code": "000000"}
      )), 429)
      token = post(
        "/app/account/tokens",
        {"name": "x", "password": GUARD_PASSWORD}
      )
      assert_eq(res_status(token), 429)
      assert_eq(AccessToken.where({"user_id": user._key}).count, 0)
    end

    test("a wrong one on another page counts too") do
      user = guard_user()
      guard_sign_in(user)
      (0 .. ACCOUNT_PASSWORD_TRIES).each do |i|
        assert_eq(res_status(request("DELETE", "/app/account", {"password": "wrong #{i}"}, {})), 422)
      end
      assert_eq(res_status(guard_change_password(GUARD_PASSWORD)), 429)
      assert(User.find(user._key).authenticate(GUARD_PASSWORD))
    end

    test("a right one is not counted, and one wrong fewer than the limit still lets it through") do
      user = guard_user()
      guard_sign_in(user)
      (0 .. ACCOUNT_PASSWORD_TRIES - 1).each do |i|
        assert_eq(res_status(guard_change_password("wrong #{i}")), 422)
      end
      assert_eq(res_status(guard_change_password(GUARD_PASSWORD)), 302)
      assert(User.find(user._key).authenticate(GUARD_NEW_PASSWORD))
    end

    test("the count is the account's: another account is not held up") do
      user = guard_user()
      other = guard_user()
      guard_sign_in(user)
      (0 .. ACCOUNT_PASSWORD_TRIES).each do |i|
        guard_change_password("wrong #{i}")
      end
      guard_sign_in(other)
      assert_eq(res_status(guard_change_password(GUARD_PASSWORD)), 302)
    end
  end

  describe("the account e-mails a form asks for") do
    test("a reset answers the same for any address, and only queues its mail") do
      user = guard_user()
      nobody = "nobody-#{uuid_v4}@example.com"
      known = post("/password/reset", {"email": user.email})
      unknown = post("/password/reset", {"email": nobody})
      assert_eq(res_status(known), 200)
      assert_eq(res_status(unknown), 200)
      assert_eq(guard_page(known, user.email), guard_page(unknown, nobody))
      # The same work for both: one job each, alike but for the address (the test
      # server runs the queue, so the job may have run already).
      assert_eq(guard_job_args(guard_mail_jobs(user.email)[0]).keys, guard_job_args(guard_mail_jobs(nobody)[0]).keys)
      assert_eq(guard_mail_jobs(user.email).length, 1)
      assert_eq(guard_mail_jobs(nobody).length, 1, "a job for an unknown address too")
      # The job makes the link and its mail (account_mail_spec: the mail as
      # the server's worker sends it); for nobody, nothing. The worker may
      # run it before, after or while the spec prepares it: one link.
      args = guard_job_args(guard_mail_jobs(user.email)[0])
      done = AuthMailJob.prepare(args)
      assert(done["found"])
      assert(done["due"])
      assert_eq(User.find(user._key).reset_token_digest, guard_letter_digest(args))
      assert_eq(Crypto.sha256(done["letter"]["links"]["reset_url"].split("token=")[1]), guard_letter_digest(args))
      none = AuthMailJob.prepare(guard_job_args(guard_mail_jobs(nobody)[0]))
      assert_eq(
        none,
        {"found": false, "due": false}
      )
    end

    test("a confirmation sent again: the same, and none to a confirmed address") do
      user = guard_user(false)
      confirmed = guard_user()
      nobody = "nobody-#{uuid_v4}@example.com"
      known = post("/confirmation/resend", {"email": user.email})
      unknown = post("/confirmation/resend", {"email": nobody})
      assert_eq(guard_page(known, user.email), guard_page(unknown, nobody))
      assert_eq(guard_job_args(guard_mail_jobs(user.email)[0]).keys, guard_job_args(guard_mail_jobs(nobody)[0]).keys)
      assert_eq(guard_mail_jobs(user.email).length, 1)
      assert_eq(guard_mail_jobs(nobody).length, 1)
      args = guard_job_args(guard_mail_jobs(user.email)[0])
      assert(AuthMailJob.prepare(args)["due"])
      assert_eq(User.find(user._key).confirmation_token_digest, guard_letter_digest(args))
      already = AuthMailJob.prepare({
        "kind": "confirm",
        "email": confirmed.email,
        "locale": "en"
      })
      assert_eq(
        already,
        {"found": true, "due": false}
      )
      assert_null(User.find(confirmed._key).confirmation_token_digest, "no link made")
      odd = AuthMailJob.prepare({
        "kind": "unknown",
        "email": user.email,
        "locale": "en"
      })
      assert_not(odd["due"])
    end

    test("the mail is in the language the form was read in") do
      user = guard_user()
      post("/fr/password/reset", {"email": user.email})
      args = guard_job_args(guard_mail_jobs(user.email)[0])
      assert_eq(args["locale"], "fr")
      assert_eq(args["kind"], "reset")
      assert_not(str(args).contains("token"), "the queue holds no link")
    end
  end

  describe("sign-up with an address that has an account") do
    test("answers as a new sign-up does, makes no second account, and tells the owner") do
      owner = guard_user()
      fresh = "fresh-#{uuid_v4}@example.com"
      fields = guard_signup_fields()
      more_fields = guard_signup_fields()
      sleep(2.1)
      made = post("/signup", fields.merge({
        "email": fresh,
        "password": GUARD_PASSWORD
      }))
      taken = post("/signup", more_fields.merge({
        "email": owner.email.upcase,
        "password": "another long password"
      }))
      assert_eq(res_status(made), 200)
      assert_eq(res_status(taken), 200)
      assert_contains(res_body(taken), "Check your inbox")
      assert_eq(guard_page(made, fresh), guard_page(taken, owner.email))
      assert_eq(User.where({"email": owner.email}).count, 1)
      assert(User.find(owner._key).authenticate(GUARD_PASSWORD), "the owner's password is unchanged")
      assert_eq(guard_mail_jobs(fresh).length, 1, "the new account's link, queued")
      assert_eq(guard_mail_jobs(owner.email).length, 1, "the owner's note, queued")
      note = guard_job_args(guard_mail_jobs(owner.email)[0])
      assert_eq(note["kind"], "signup_taken")
      assert(AuthMailJob.prepare(note)["due"])
      gone = AuthMailJob.prepare({
        "kind": "signup_taken",
        "email": fresh + ".none",
        "locale": "en"
      })
      assert_not(gone["found"])
    end
  end

  describe("the lock after wrong passwords") do
    test("locks the address that guessed, not the owner's") do
      user = guard_user()
      attacker = "203.0.113.#{uuid_v4}"
      guard_lock(user, attacker)
      stored = User.find(user._key)
      assert(stored.locked_for?(attacker))
      assert_not(stored.locked_for?("198.51.100.7"), "another address still signs in")
      assert(stored.locked?, "the admin pages see a lock")
      # The spec's own address signs in, the right password.
      assert_eq(res_status(guard_sign_in(user)), 302)
      assert(User.find(user._key).locked_for?(attacker), "a sign-in elsewhere does not lift it")
    end

    test("from this address: the right password refused once it is locked, until the lock runs out") do
      user = guard_user()
      (0 .. AUTH_MAX_FAILED_ATTEMPTS).each do |i|
        guard_sign_in(user, "wrong #{i}")
      end
      assert_eq(res_status(guard_sign_in(user)), 401)
      assert(User.find(user._key).locked?)
      expired = User.find(user._key)
      failures = expired.sign_in_failures
      failures.keys.each do |source|
        failures[source] = {
          "count": AUTH_MAX_FAILED_ATTEMPTS,
          "at": DateTime.utc.to_unix - AUTH_LOCKOUT_SECONDS - 60,
          "locked_at": DateTime.utc.to_unix - AUTH_LOCKOUT_SECONDS - 60
        }
      end
      expired.sign_in_failures = failures
      expired.update
      assert_eq(res_status(guard_sign_in(user)), 302)
      assert_not(User.find(user._key).locked?)
    end

    test("tells the owner once a window, however many addresses lock") do
      user = guard_user()
      ["192.0.2.1", "192.0.2.2"].each do |source|
        guard_lock(user, source)
      end
      assert(User.find(user._key).locked_for?("192.0.2.2"))
      told = User.find(user._key).lock_told_at
      assert_not_null(told, "told when the first lock tripped")
      # Told earlier in the window: the second address's lock is not told.
      earlier = User.find(user._key)
      earlier.lock_told_at = told - 100
      earlier.update
      guard_lock(user, "192.0.2.3")
      assert_eq(User.find(user._key).lock_told_at, told - 100, "not told twice in a window")
      # A window later, a new lock is told again.
      later = User.find(user._key)
      later.lock_told_at = DateTime.utc.to_unix - AUTH_LOCKOUT_SECONDS - 60
      later.update
      guard_lock(user, "192.0.2.4")
      assert_gt(User.find(user._key).lock_told_at, DateTime.utc.to_unix - 60)
    end

    test("an admin's unlock lifts every address's lock") do
      user = guard_user()
      guard_lock(user, "192.0.2.9")
      User.find(user._key).unlock
      assert_not(User.find(user._key).locked_for?("192.0.2.9"))
      assert_not(User.find(user._key).locked?)
    end
  end

  describe("the lock, counted per network") do
    test("IPv6 addresses of one /64 count as one source, and lock it whole") do
      user = guard_user()
      (0 .. 101).each do |i|
        User.find(user._key).register_failed_attempt("2001:db8:1:2::#{i}")
      end
      stored = User.find(user._key)
      assert(stored.locked_for?("2001:db8:1:2:abcd::ffff"), "an address never used, in the /64")
      assert(stored.locked_for?("2001:0db8:0001:0002:0000:0000:0000:0001"), "written in full")
      assert_not(stored.locked_for?("2001:db8:1:3::1"), "the next /64 signs in")
      assert_eq(stored.sign_in_failures.keys.length, 1, "one source, not 101")
      assert_not(stored.account_locked?, "ten counted, not an account-wide lock")
    end

    test("an IPv4 address is its own source, and a mapped one is the same") do
      assert_eq(User.failure_network("192.0.2.7"), "192.0.2.7")
      assert_eq(User.failure_network("::ffff:192.0.2.7"), "192.0.2.7")
      assert_ne(User.failure_network("192.0.2.7"), User.failure_network("192.0.2.8"))
      assert_eq(User.failure_network("2001:db8::1"), User.failure_network("2001:db8:0:0:ffff::2"))
      assert_eq(User.failure_network("[2001:DB8::1%en0]"), "2001:db8:0:0::/64")
    end

    test("the source is a keyed digest, not one anybody can recompute") do
      source = User.failure_source("192.0.2.7")
      assert_eq(source.length, 24)
      assert_ne(source, Crypto.sha256("sign-in:192.0.2.7").substring(0, 24))
      assert_eq(source, Crypto.hmac("sign-in:192.0.2.7", User.auth_key("sign-in")).substring(0, 24))
      # One key per purpose, none of them the server's secret.
      assert_ne(User.auth_key("sign-in"), User.auth_key("device"))
      assert_ne(User.auth_key("sign-in"), User.auth_secret)
      assert_ne(Crypto.hmac("sign-in:192.0.2.7", User.auth_secret).substring(0, 24), source)
    end

    test("a locked source is never forgotten to make room for others") do
      user = guard_user()
      guard_lock(user, "198.51.100.1")
      # Locked a minute ago: the oldest entry, which room was made by dropping.
      aged = User.find(user._key)
      failures = aged.sign_in_failures
      failures.keys.each do |source|
        failures[source] = {
          "count": AUTH_MAX_FAILED_ATTEMPTS,
          "at": DateTime.utc.to_unix - 60,
          "locked_at": DateTime.utc.to_unix - 60
        }
      end
      aged.sign_in_failures = failures
      aged.update
      (0 .. AUTH_LOCK_SOURCES + 10).each do |i|
        User.find(user._key).register_failed_attempt("203.0.113.#{i}")
      end
      stored = User.find(user._key)
      assert(stored.locked_for?("198.51.100.1"), "still locked")
      assert_eq(
        stored.sign_in_failures.keys.length,
        AUTH_LOCK_SOURCES + 1,
        "the open ones capped, the locked one kept"
      )
    end
  end

  describe("the account-wide lock") do
    test("one failure short of it, the account signs in from anywhere") do
      user = guard_user()
      (0 .. AUTH_ACCOUNT_MAX_FAILURES - 1).each do |i|
        User.find(user._key).register_failed_attempt("2001:db8:#{i}::1")
      end
      assert_not(User.find(user._key).account_locked?)
      assert_eq(res_status(guard_sign_in_with(user, nil)), 302)
    end

    test("refuses a browser new to the account, the right password as a wrong one, and tells the owner") do
      user = guard_user()
      guard_lock_account(user)
      stored = User.find(user._key)
      assert(stored.account_locked?)
      assert(stored.locked_for?("198.51.100.200"), "a network that never guessed")
      assert_not(stored.locked_for?("198.51.100.200", true), "a browser the account trusts")
      right = guard_sign_in_with(user, nil)
      wrong = guard_sign_in_with(user, nil, "not the password")
      assert_eq(res_status(right), 401)
      assert_eq(res_status(wrong), 401)
      assert_contains(res_body(right), "Invalid email or password")
      assert_eq(res_status(get("/app/account")), 302, "not signed in")
      told = guard_mail_jobs(user.email).filter do |job|
        guard_job_args(job)["kind"] == "account_locked"
      end
      assert_eq(told.length, 1, "told once, by a queued mail")
      assert_eq(guard_job_args(told[0])["lock"], "account")
    end

    test("lets in a browser that signed in to the account before") do
      user = guard_user()
      signed = guard_sign_in_with(user, nil)
      assert_eq(res_status(signed), 302)
      set_cookie_header = str(res_headers(signed))
      assert_contains(set_cookie_header, "device=")
      assert_contains(set_cookie_header, "HttpOnly")
      guard_lock_account(user)
      device = User.find(user._key).device_cookie
      assert_eq(res_status(guard_sign_in_with(user, device)), 302)
      assert_eq(res_status(get("/app/account")), 200)
      # Another account's device cookie, or a forged one, is a new browser.
      other = guard_user()
      assert_eq(res_status(guard_sign_in_with(user, User.find(other._key).device_cookie)), 401)
      assert_eq(res_status(guard_sign_in_with(user, device + "x")), 401)
      assert_eq(res_status(guard_sign_in_with(user, "garbage")), 401)
      # Still, the trusted browser's wrong password counts, and a wrong one is refused.
      assert_eq(res_status(guard_sign_in_with(user, device, "not the password")), 401)
    end

    test("runs out, and an admin's unlock or a new password lifts it") do
      user = guard_user()
      guard_lock_account(user)
      over = User.find(user._key)
      over.account_locked_at = DateTime.utc.to_unix - AUTH_ACCOUNT_WINDOW - 60
      over.update
      assert_not(User.find(user._key).account_locked?)
      assert_eq(res_status(guard_sign_in_with(user, nil)), 302)
      guard_lock_account(user)
      User.find(user._key).unlock
      assert_not(User.find(user._key).locked?)
      guard_lock_account(user)
      User.find(user._key).finish_password_reset(GUARD_NEW_PASSWORD)
      assert_not(User.find(user._key).account_locked?)
    end
  end

  describe("the devices an account knows") do
    test("a device given before a reset no longer gets past the lock after it") do
      user = guard_user()
      before = User.find(user._key).device_cookie
      token = User.find(user._key).start_password_reset
      reset = post(
        "/password/update",
        {
          "token": token,
          "password": GUARD_NEW_PASSWORD,
          "password_confirmation": GUARD_NEW_PASSWORD
        }
      )
      assert_eq(res_status(reset), 302)
      assert_not(User.find(user._key).trusts_device?(before), "voided by the reset")
      guard_lock_account(user)
      assert_eq(res_status(guard_sign_in_with(user, before, GUARD_NEW_PASSWORD)), 401)
      # The browser that followed the reset link is one the account knows.
      given = guard_device_set(reset)
      assert_not_null(given, "the reset gives a device cookie")
      assert(User.find(user._key).trusts_device?(given))
      assert_eq(res_status(guard_sign_in_with(user, given, GUARD_NEW_PASSWORD)), 302)
    end

    test("a new password or a new address voids the devices given before") do
      user = guard_user()
      before = User.find(user._key).device_cookie
      assert(User.find(user._key).trusts_device?(before))
      User.find(user._key).change_password(GUARD_NEW_PASSWORD)
      assert_not(User.find(user._key).trusts_device?(before), "a new password")
      again = User.find(user._key).device_cookie
      moved = User.find(user._key)
      moved.start_email_change("moved-#{uuid_v4}@example.com")
      User.find(user._key).finish_email_change
      assert_not(User.find(user._key).trusts_device?(again), "a new address")
    end

    test("the password changed on the account page keeps this browser one the account knows") do
      user = guard_user()
      guard_sign_in(user)
      changed = guard_change_password(GUARD_PASSWORD)
      assert_eq(res_status(changed), 302)
      assert(User.find(user._key).trusts_device?(guard_device_set(changed)))
    end

    test("a remember-me cookie that signs a browser in makes it one the account knows") do
      user = guard_user()
      token = User.find(user._key).start_remember_me
      clear_cookies()
      set_request_cookie("remember_token", "#{user._key}:#{token}")
      promoted = get("/app/account")
      assert_eq(res_status(promoted), 200)
      given = guard_device_set(promoted)
      assert_not_null(given, "a device cookie")
      assert(User.find(user._key).trusts_device?(given))
      # A wrong remember-me cookie gives none.
      clear_cookies()
      set_request_cookie("remember_token", "#{user._key}:not-the-token")
      assert_null(guard_device_set(get("/app/account")))
    end
  end

  describe("the failures, counted by the database") do
    test("each failure adds to the stored count, whatever copy the request read") do
      user = guard_user()
      first = User.find(user._key)
      second = User.find(user._key)
      first.register_failed_attempt("192.0.2.77")
      second.register_failed_attempt("192.0.2.77")
      entry = User.find(user._key).sign_in_failures[User.failure_source("192.0.2.77")]
      assert_eq(entry["count"], 2)
      assert_eq(User.find(user._key).account_failures["count"], 2)
    end

    test("the lock trips, and is told, from the stored values") do
      user = guard_user()
      source = User.failure_source("192.0.2.78")
      now = DateTime.utc.to_unix
      stored = User.find(user._key)
      failures = {}
      failures[source] = {
        "count": AUTH_MAX_FAILED_ATTEMPTS - 1,
        "at": now,
        "locked_at": nil
      }
      stored.sign_in_failures = failures
      stored.account_failures = {
        "count": AUTH_ACCOUNT_MAX_FAILURES - 2,
        "since": now
      }
      stored.update
      network = User.count_failure(user._key, source, now)
      assert(network["source_locked"])
      assert_not(network["account_locked"])
      assert(network["told"])
      after = User.find(user._key)
      assert_eq(after.sign_in_failures[source]["locked_at"], now)
      assert_eq(after.lock_told_at, now)
      assert_eq(after.account_failures["count"], AUTH_ACCOUNT_MAX_FAILURES - 1)
      account = User.count_failure(user._key, User.failure_source("192.0.2.79"), now)
      assert(account["account_locked"])
      assert(account["told"], "the account's lock is told within the window too")
      assert_eq(User.find(user._key).account_locked_at, now)
      assert_null(User.find(user._key).account_failures)
      assert_null(User.count_failure("no-such-key", source, now))
    end
  end

  describe("the password asked by a signed-in page") do
    test("counts a try before the password is checked, and a right one starts the count again") do
      probe = GuardCountingUser.new()
      tries = guard_password_tries(probe)
      (0 .. ACCOUNT_PASSWORD_TRIES - 1).each do |_|
        RateCount.take(tries, ACCOUNT_PASSWORD_TRIES, ACCOUNT_PASSWORD_WINDOW)
      end
      assert(probe.confirms_password?(GUARD_PASSWORD), "the last try left")
      assert(probe.spent_at_check, "the try was counted before the check")
      assert_not(probe.password_tries_spent?, "the right one started the count again")
      # A wrong one spends one, and once they are spent even the right one is
      # refused without being checked.
      (0 .. ACCOUNT_PASSWORD_TRIES).each do |_|
        assert_not(probe.confirms_password?("wrong"))
      end
      probe.spent_at_check = nil
      assert_not(probe.confirms_password?(GUARD_PASSWORD))
      assert_null(probe.spent_at_check, "not checked at all")
    end

    test("an e-mail change spends the same tries") do
      user = guard_user()
      guard_sign_in(user)
      (0 .. ACCOUNT_PASSWORD_TRIES).each do |i|
        wrong = post(
          "/app/account/email",
          {"email": "moved-#{uuid_v4}@example.com", "password": "wrong #{i}"}
        )
        assert_eq(res_status(wrong), 422)
      end
      assert_null(User.find(user._key).email_change_to, "no change started")
      assert_eq(res_status(guard_change_password(GUARD_PASSWORD)), 429)
      assert(User.find(user._key).authenticate(GUARD_PASSWORD), "the password is unchanged")
    end
  end

  describe("an account not confirmed yet, at sign-in") do
    test("answers the right password as a wrong one, and sends the link again") do
      user = guard_user(false)
      right = guard_sign_in(user)
      wrong = guard_sign_in(user, "not the password")
      nobody = post(
        "/login",
        {"email": "nobody-#{uuid_v4}@example.com", "password": GUARD_PASSWORD}
      )
      assert_eq(res_status(right), 401)
      assert_eq(res_status(wrong), 401)
      assert_eq(res_status(nobody), 401)
      assert_contains(res_body(right), "Invalid email or password")
      assert_contains(res_body(right), "Confirm your address first")
      assert_contains(res_body(nobody), "Confirm your address first")
      assert_not(res_body(right).contains("Please confirm your email address first"))
      assert_eq(res_status(get("/app/account")), 302)
      sent = guard_mail_jobs(user.email).filter do |job|
        guard_job_args(job)["kind"] == "confirm"
      end
      assert_eq(sent.length, 1, "the link again, for the right password only")
      # The right password counted for the network as the wrong one did.
      entry = User.find(user._key).sign_in_failures.values()[0]
      assert_eq(entry["count"], 2)
    end
  end

  describe("sign-up and the per-address mail budget") do
    test("a new address spends it as a taken one does") do
      fresh = "budget-#{uuid_v4}@example.com"
      owner = guard_user()
      [fresh, owner.email].each do |address|
        fields = guard_signup_fields()
        sleep(2.1)
        post("/signup", fields.merge({
          "email": address,
          "password": GUARD_PASSWORD
        }))
        # The sign-up spent one: the resets asked next run out one sooner.
        assert_eq(guard_resets_allowed(address), AUTH_EMAILS_PER_ADDRESS - 1, address)
      end
    end

    test("an address with an unconfirmed account gets its link again, not the note") do
      owner = guard_user(false)
      fields = guard_signup_fields()
      sleep(2.1)
      post("/signup", fields.merge({
        "email": owner.email,
        "password": "another long password"
      }))
      job = guard_mail_jobs(owner.email)[0]
      done = AuthMailJob.prepare(guard_job_args(job))
      assert(done["due"])
      assert_eq(
        User.find(owner._key).confirmation_token_digest,
        guard_letter_digest(guard_job_args(job)),
        "a link made"
      )
    end
  end

  describe("the authorization codes not yet exchanged") do
    test("work, until the password is reset") do
      user = guard_user()
      client = OauthClient.register("Spec app", [GUARD_REDIRECT])
      assert_eq(guard_exchange_status(guard_oauth_code(user, client)), 200)
      pending = guard_oauth_code(user, client)
      token = User.find(user._key).start_password_reset
      post(
        "/password/update",
        {
          "token": token,
          "password": GUARD_NEW_PASSWORD,
          "password_confirmation": GUARD_NEW_PASSWORD
        }
      )
      assert_eq(OauthCode.where({"user_id": user._key}).count, 0)
      assert_eq(guard_exchange_status(pending), 400)
      assert_eq(AccessToken.where({"user_id": user._key}).count, 0)
    end

    test("die when the password is changed, or the address") do
      user = guard_user()
      client = OauthClient.register("Spec app", [GUARD_REDIRECT])
      changed = guard_oauth_code(user, client)
      guard_sign_in(user)
      assert_eq(res_status(guard_change_password(GUARD_PASSWORD)), 302)
      assert_eq(guard_exchange_status(changed), 400)
      moved = guard_oauth_code(user, client)
      link = User.find(user._key).start_email_change("moved-#{uuid_v4}@example.com")
      post("/account/email", {"token": link})
      assert_eq(guard_exchange_status(moved), 400)
      assert_eq(OauthCode.where({"user_id": user._key}).count, 0)
    end
  end

  describe("a reset link already sent") do
    test("dies when the password is changed on the account page") do
      user = guard_user()
      link = User.find(user._key).start_password_reset
      guard_sign_in(user)
      assert_eq(res_status(guard_change_password(GUARD_PASSWORD)), 302)
      assert_null(User.find(user._key).reset_token_digest)
      assert_contains(res_body(get("/password/edit?token=#{link}")), "invalid or has expired")
    end

    test("dies when the address changes") do
      user = guard_user()
      link = User.find(user._key).start_password_reset
      change = User.find(user._key).start_email_change("moved-#{uuid_v4}@example.com")
      assert_eq(res_status(post("/account/email", {"token": change})), 200)
      assert_null(User.find(user._key).reset_token_digest)
      assert_contains(res_body(get("/password/edit?token=#{link}")), "invalid or has expired")
    end
  end
end
