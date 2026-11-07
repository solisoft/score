# The account page's "Export all my data" and "Change your email address",
# end to end: what each refuses, to whom, and what is stored (or not) after.

const DATA_PASSWORD = "correct horse battery"

def data_user(label = "data")
  user = User.new()
  user.email = "#{label}-#{uuid_v4}@example.com"
  user.set_password(DATA_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

# Signs `user` in, and answers this browser's session cookie's value.
def data_sign_in(user)
  clear_cookies()
  response = post(
    "/login",
    {"email": user.email, "password": DATA_PASSWORD}
  )
  # `set-cookie` is an Array, one line per cookie (Soli 2.30.2, #659).
  cookie = res_header(response, "set-cookie").find do |line|
    line.starts_with?("session_id=")
  end
  cookie.split(";")[0].split("=")[1]
end

def data_signed_in?
  res_status(get("/app/account")) == 200
end

def ask_change(email, password = DATA_PASSWORD, code = "")
  post(
    "/app/account/email",
    {
      "email": email,
      "password": password,
      "code": code
    }
  )
end

describe("Account data") do
  before_each() do
    as_guest()
    clear_cookies()
  end

  describe("the account page") do
    test("offers the export and the change of address") do
      data_sign_in(data_user())
      page = res_body(get("/app/account"))
      assert_contains(page, "Export all your data")
      assert_contains(page, "action=\"/app/account/export\"")
      assert_contains(page, "Download my data (.zip)")
      assert_contains(page, "Change your email address")
      assert_contains(page, "action=\"/app/account/email\"")
    end
  end

  describe("the account page of someone with scores and versions") do
    test("offers their data in one zip") do
      owner = data_user("busy")
      score = Score.start(owner, Score.blank_source("Busy"))
      ScoreVersion.keep(score, score.source, "manual", owner._key)
      data_sign_in(owner)
      post("/app/scores", {"title": "From the app"})
      response = get("/app/account")
      assert_eq(res_status(response), 200)
      assert_contains(res_body(response), "Download my data (.zip)")
    end

    test("does not size the export on every visit: a big one is listed in parts when it is asked for (#689)") do
      owner = data_user("big")
      score = Score.start(owner, Score.blank_source("Big"))
      # A take bigger than a part: the export comes in two.
      take = ScoreTake.create({
        "score_id": score._key,
        "user_id": owner._key,
        "track": 1,
        "name": "Long",
        "size": EXPORT_PART_CHARACTERS + 1,
        "created_at": 1792700000
      })
      assert_eq(AccountExport.parts(owner), [[score._key], ["take:#{take._key}"]])
      data_sign_in(owner)
      page = res_body(get("/app/account"))
      # The page as for everyone: one button, the parts not read.
      assert_contains(page, "Download my data (.zip)")
      assert_not(page.contains("Download part 1 of 2"), "no parts on the page as it opens")
      assert_not(page.contains("name=\"part\""))
      # Asked for: the two parts, each its own download, and no zip yet.
      listed = post("/app/account/export", {})
      assert_eq(res_status(listed), 200)
      assert_not(res_body(listed).starts_with?("PK"), "not a zip")
      assert_contains(res_body(listed), "Your scores are many: they come in 2 zips")
      assert_contains(res_body(listed), "Download part 1 of 2")
      assert_contains(res_body(listed), "Download part 2 of 2")
      assert_contains(res_body(listed), "name=\"part\" value=\"2\"")
      # A part asked for by its number comes as a zip.
      first = post("/app/account/export", {"part": "1"})
      assert_eq(res_header(first, "Content-Type"), "application/zip")
      assert_contains(res_header(first, "Content-Disposition"), "-part-1-of-2.zip")
      assert_contains(res_body(first), "big.ly")
    end
  end

  describe("POST /app/account/export") do
    test("downloads a zip of the person's own scores, with their versions and the trash") do
      owner = data_user("owner")
      score = Score.start(owner, Score.blank_source("Export étude"))
      ScoreVersion.keep(score, "\\header { title = \"Export étude\" }\n{ e'1 }", "manual", owner._key)
      binned = Score.start(owner, Score.blank_source("Binned"))
      binned.move_to_trash
      data_sign_in(owner)
      response = post("/app/account/export", {})
      assert_eq(res_status(response), 200)
      assert_eq(res_header(response, "Content-Type"), "application/zip")
      assert_match(
        res_header(response, "Content-Disposition"),
        "^attachment; filename=\"eui-score-\\d{4}-\\d\\d-\\d\\d\\.zip\"$"
      )
      assert_eq(res_header(response, "Cache-Control"), "no-store")
      body = res_body(response)
      assert(body.starts_with?("PK"), "a zip")
      # Stored, not compressed: the files' text is in the body as it is.
      assert_contains(body, "{ e'1 }")
      assert_contains(body, "trash/binned-#{binned._key}/binned.ly")
      assert_contains(body, "account.json")
      assert_contains(body, owner.email)
      assert_not(body.contains(User.find(owner._key).password_digest), "no password digest")
    end

    test("a stranger downloads their own data, and nothing of anyone else's") do
      owner = data_user("owner")
      Score.start(owner, Score.blank_source("Not for strangers"))
      stranger = data_user("stranger")
      data_sign_in(stranger)
      body = res_body(post(
        "/app/account/export",
        {"user_id": owner._key, "part": "1"}
      ))
      assert_not(body.contains("Not for strangers"))
      assert_not(body.contains(owner.email))
      assert_contains(body, stranger.email)
    end

    test("refuses a guest, with no zip (the spec client posts JSON: 401, not the sign-in page)") do
      response = post("/app/account/export", {})
      assert_eq(res_status(response), 401)
      assert_not(res_body(response).starts_with?("PK"))
    end

    test("answers 404 for a part that does not exist") do
      data_sign_in(data_user())
      assert_eq(res_status(post("/app/account/export", {"part": "2"})), 404)
      assert_eq(res_status(post("/app/account/export", {"part": "0"})), 404)
      assert_eq(res_status(post("/app/account/export", {"part": "x"})), 404)
      assert_eq(res_status(post("/app/account/export", {"part": "1"})), 200)
    end

    test("so many downloads an hour, then refused with the page saying why") do
      user = data_user()
      data_sign_in(user)
      statuses = (0 .. EXPORTS_PER_WINDOW).map do |_|
        res_status(post("/app/account/export", {}))
      end
      assert_eq(statuses, (0 .. EXPORTS_PER_WINDOW).map(&{ |_|
        200
      }))
      refused = post("/app/account/export", {})
      assert_eq(res_status(refused), 429)
      assert_contains(res_body(refused), "You have downloaded your data #{EXPORTS_PER_WINDOW} times this hour")
      # Another account is not held up.
      data_sign_in(data_user())
      assert_eq(res_status(post("/app/account/export", {})), 200)
    end
  end

  describe("POST /app/account/email") do
    test("keeps the new address aside and changes nothing until its link is followed") do
      user = data_user()
      data_sign_in(user)
      new_email = "New-#{uuid_v4}@Example.com"
      response = ask_change(" #{new_email} ")
      assert_eq(res_status(response), 302)
      assert_eq(res_location(response), "/app/account")
      stored = User.find(user._key)
      assert_eq(stored.email, user.email, "unchanged")
      assert_eq(stored.email_change_to, new_email.downcase)
      assert_not_null(stored.email_change_digest)
      page = res_body(get("/app/account"))
      assert_contains(page, "A link is on its way to #{new_email.downcase}")
      assert_contains(page, "Waiting for <strong>#{new_email.downcase}</strong>")
    end

    test("refuses a wrong password, a bad address, its own, and another account's: nothing kept") do
      user = data_user()
      other = data_user("other")
      data_sign_in(user)
      wrong = ask_change("fresh-#{uuid_v4}@example.com", "not my password")
      assert_eq(res_status(wrong), 422)
      assert_contains(res_body(wrong), "That is not your password")
      assert_eq(res_status(ask_change("not-an-address")), 422)
      assert_contains(res_body(ask_change(user.email.upcase)), "That is already your address.")
      taken = ask_change(other.email)
      assert_eq(res_status(taken), 422)
      assert_contains(res_body(taken), "That address belongs to another account.")
      assert_null(User.find(user._key).email_change_to)
    end

    test("with two-step sign-in on, a code is asked for too") do
      user = data_user()
      secret = User.find(user._key).start_two_step
      codes = User.find(user._key).confirm_two_step(Crypto.totp_generate(secret, DateTime.utc.to_unix, 30))
      # Turning it on signs out the sessions opened before (#538): sign in
      # after, both steps.
      data_sign_in(user)
      post("/login/code", {"code": codes[9]})
      assert_contains(res_body(get("/app/account")), "id=\"email_code\"")
      new_email = "coded-#{uuid_v4}@example.com"
      refused = ask_change(new_email, DATA_PASSWORD, "000000")
      assert_eq(res_status(refused), 422)
      assert_contains(res_body(refused), "That code is not right")
      assert_null(User.find(user._key).email_change_to)
      assert_eq(res_status(ask_change(new_email, DATA_PASSWORD, codes[0])), 302)
      assert_eq(User.find(user._key).email_change_to, new_email)
    end

    test("so many asked an hour, right or wrong, then refused") do
      user = data_user()
      data_sign_in(user)
      (0 .. EMAIL_CHANGES_PER_HOUR).each do |_|
        ask_change("x@example.com", "wrong password")
      end
      refused = ask_change("late-#{uuid_v4}@example.com")
      assert_eq(res_status(refused), 429)
      assert_contains(res_body(refused), "#{EMAIL_CHANGES_PER_HOUR} times this hour")
      assert_null(User.find(user._key).email_change_to)
    end

    test("an address sent its hour's account emails already gets no more, and nothing is kept") do
      user = data_user()
      flooded = "flooded-#{uuid_v4}@example.com"
      (0 .. AUTH_EMAILS_PER_ADDRESS).each do |_|
        post("/confirmation/resend", {"email": flooded})
      end
      data_sign_in(user)
      refused = ask_change(flooded)
      assert_eq(res_status(refused), 429)
      assert_contains(res_body(refused), AUTH_EMAILS_REFUSED)
      assert_null(User.find(user._key).email_change_to)
    end

    test("refuses a guest") do
      response = ask_change("guest@example.com")
      assert_eq(res_status(response), 401)
      assert_eq(User.where({"email_change_to": "guest@example.com"}).count, 0)
    end

    test("cancelled: the link stops working") do
      user = data_user()
      data_sign_in(user)
      token = User.find(user._key).start_email_change("cancel-#{uuid_v4}@example.com")
      assert_eq(res_status(post("/app/account/email/cancel", {})), 302)
      assert_null(User.find(user._key).email_change_to)
      assert_eq(res_status(get("/account/email?token=#{token}")), 404)
    end
  end

  describe("the link to the new address") do
    test("opens a page that changes nothing; its button makes the change, signed out") do
      user = data_user()
      new_email = "moved-#{uuid_v4}@example.com"
      token = User.find(user._key).start_email_change(new_email)
      page = get("/account/email?token=#{token}")
      assert_eq(res_status(page), 200)
      assert_contains(res_body(page), "Use #{new_email}")
      assert_eq(User.find(user._key).email, user.email, "a GET changes nothing")
      done = post("/account/email", {"token": token})
      assert_eq(res_status(done), 200)
      assert_contains(res_body(done), "Your account now uses <strong>#{new_email}</strong>")
      assert_contains(res_body(done), "sign in with your new address")
      stored = User.find(user._key)
      assert_eq(stored.email, new_email)
      assert_null(stored.email_change_to)
      assert_null(stored.email_change_digest)
      # The new address signs in; the old one no longer does.
      clear_cookies()
      assert_eq(res_status(post(
        "/login",
        {"email": user.email, "password": DATA_PASSWORD}
      )), 401)
      assert_eq(res_status(post(
        "/login",
        {"email": new_email, "password": DATA_PASSWORD}
      )), 302)
    end

    test("signs every other browser out, and keeps the one that followed it") do
      user = data_user()
      other_browser = data_sign_in(user)
      this_browser = data_sign_in(user)
      token = User.find(user._key).start_email_change("both-#{uuid_v4}@example.com")
      done = post("/account/email", {"token": token})
      assert_contains(res_body(done), "You are still signed in here")
      assert(data_signed_in?(), "this browser")
      clear_cookies()
      set_request_cookie("session_id", other_browser)
      assert_not(data_signed_in?(), "the other browser")
      assert_ne(this_browser, other_browser)
    end

    test("the shares made to the old address follow it, merging with one already there") do
      user = data_user("sharee")
      lender = data_user("lender")
      kept = Score.start(lender, Score.blank_source("Kept"))
      both = Score.start(lender, Score.blank_source("Both"))
      own = Score.start(user, Score.blank_source("Own"))
      new_email = "merged-#{uuid_v4}@example.com"
      ScoreShare.invite(kept, user.email, "read")
      ScoreShare.invite(both, user.email, "write")
      ScoreShare.invite(both, new_email, "read")
      ScoreShare.invite(own, new_email, "read")
      token = User.find(user._key).start_email_change(new_email)
      post("/account/email", {"token": token})
      assert_eq(ScoreShare.where({"email": user.email}).count, 0, "none left on the old address")
      assert_eq(ScoreShare.where({
        "score_id": kept._key,
        "email": new_email
      }).first.role, "read")
      on_both = ScoreShare.where({"score_id": both._key}).all
      assert_eq(on_both.length, 1, "one share on a score shared with both addresses")
      assert_eq(on_both[0].email, new_email)
      assert_eq(on_both[0].role, "write", "the stronger role")
      assert_eq(ScoreShare.where({"score_id": own._key}).count, 0, "no share of one's own score")
      data_sign_in(User.find(user._key))
      assert_eq(res_status(get("/app/scores/#{both._key}")), 200)
    end

    test("used twice: the second time says it was, and changes nothing more") do
      user = data_user()
      new_email = "twice-#{uuid_v4}@example.com"
      token = User.find(user._key).start_email_change(new_email)
      post("/account/email", {"token": token})
      again = post("/account/email", {"token": token})
      assert_eq(res_status(again), 200)
      assert_contains(res_body(again), "This link was used already")
      assert_eq(res_status(get("/account/email?token=#{token}")), 200)
      assert_eq(User.find(user._key).email, new_email)
    end

    test("expired: refused, and the address unchanged") do
      user = data_user()
      token = User.find(user._key).start_email_change("late-#{uuid_v4}@example.com")
      stale = User.find(user._key)
      stale.email_change_sent_at = DateTime.utc.to_unix - EMAIL_CHANGE_TTL - 1
      stale.update()
      response = post("/account/email", {"token": token})
      assert_eq(res_status(response), 410)
      assert_contains(res_body(response), "This link has expired")
      assert_eq(res_status(get("/account/email?token=#{token}")), 410)
      assert_eq(User.find(user._key).email, user.email)
    end

    test("a forged or missing token is refused, and changes no one") do
      user = data_user()
      User.find(user._key).start_email_change("forged-#{uuid_v4}@example.com")
      assert_eq(res_status(post("/account/email", {"token": uuid_v4()})), 404)
      assert_eq(res_status(post("/account/email", {})), 404)
      assert_eq(res_status(get("/account/email")), 404)
      assert_eq(User.find(user._key).email, user.email)
    end

    test("the new address taken by another account meanwhile: refused, and the change dropped") do
      user = data_user()
      new_email = "raced-#{uuid_v4}@example.com"
      token = User.find(user._key).start_email_change(new_email)
      racer = User.new()
      racer.email = new_email
      racer.set_password(DATA_PASSWORD)
      racer.save
      response = post("/account/email", {"token": token})
      assert_eq(res_status(response), 409)
      assert_contains(res_body(response), "#{new_email} now belongs to another account")
      stored = User.find(user._key)
      assert_eq(stored.email, user.email)
      assert_null(stored.email_change_to)
    end

    test("a new password stops a change under way") do
      user = data_user()
      data_sign_in(user)
      token = User.find(user._key).start_email_change("stopped-#{uuid_v4}@example.com")
      post(
        "/app/account/password",
        {
          "current_password": DATA_PASSWORD,
          "password": "another long password",
          "password_confirmation": "another long password"
        }
      )
      assert_eq(res_status(post("/account/email", {"token": token})), 404)
      assert_eq(User.find(user._key).email, user.email)
    end
  end

  describe("the playground") do
    test("says the MIDI view and the AI are in the app, with a way to sign up") do
      page = res_body(get("/playground"))
      assert_contains(page, "data-app-only")
      assert_contains(page, "the MIDI view and the AI features")
      assert_contains(page, "href=\"/signup\"")
    end
  end
end
