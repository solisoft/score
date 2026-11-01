# The admin section (#399): only an admin reaches it — a guest is sent to
# sign in, a member is answered 404 and changes nothing. An admin sees the
# figures, finds a customer by address, name or plan, opens one, offers
# Pro and takes it back, unlocks signing in, confirms an address; a paying
# account's Pro is left to Stripe. Stripe's invoices are read through a
# stand-in, never the network. An admin signs in in two steps, or is sent to
# turn it on (#544); every change an admin makes is kept as an AdminAction.

const ADMIN_SPEC_PASSWORD = "correct horse battery"
const ADMIN_SPEC_DAY = 86400

# An account; an admin has two-step sign-in on unless `two_step` is false.
def admin_spec_user(role = "member", name = nil, two_step = true)
  user = User.new()
  user.email = "admin-spec-#{uuid_v4}@example.com"
  user.name = name unless name.nil?
  user.role = role
  user.set_password(ADMIN_SPEC_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  if role == "admin" && two_step
    secret = User.find(user._key).start_two_step
    User.find(user._key).confirm_two_step(Crypto.totp_generate(secret, DateTime.utc.to_unix, 30))
  end
  User.find(user._key)
end

# Signed in as `user`: the password, then the code when two-step is on.
def admin_spec_sign_in(user)
  clear_cookies()
  response = post(
    "/login",
    {"email": user.email, "password": ADMIN_SPEC_PASSWORD}
  )
  account = User.find(user._key)
  return response unless account.two_step?

  secret = Crypto.decrypt(account.totp_secret, getenv("SOLI_ENCRYPTION_KEY"))
  post("/login/code", {"code": Crypto.totp_generate(secret, DateTime.utc.to_unix + 30, 30)})
end

def admin_spec_paying(user, interval = "monthly")
  user.plan = "pro"
  user.plan_status = "active"
  user.plan_interval = interval
  user.current_period_end = DateTime.utc.to_unix + 30 * ADMIN_SPEC_DAY
  user.stripe_customer_id = "cus_#{user._key}"
  user.stripe_subscription_id = "sub_#{user._key}"
  user.update()
  User.find(user._key)
end

# A transport answering every request with `answer`, noting each path.
def admin_spec_transport(answer, paths)
  transport = fn(method, path, body) {
    paths.push("#{method} #{path}")
    answer
  }
  transport
end

describe("The admin section") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  describe("who reaches it") do
    test("a guest is sent to sign in") do
      response = get("/admin")
      assert_eq(res_status(response), 302)
      assert_contains(res_location(response), "/login")
    end

    test("a member is answered 404 everywhere, and the nav has no Admin link") do
      member = admin_spec_user()
      admin_spec_sign_in(member)
      ["/admin", "/admin/customers", "/admin/customers/#{member._key}", "/admin/payments"].each do |path|
        assert_eq(res_status(get(path)), 404)
      end
      assert_not(res_body(get("/app/account")).contains("data-admin-link"))
    end

    test("a member's POST offers nothing and unlocks nothing") do
      member = admin_spec_user()
      target = admin_spec_user()
      target.locked_at = DateTime.utc.to_unix
      target.failed_attempts = 10
      target.update()
      admin_spec_sign_in(member)
      assert_eq(res_status(post("/admin/customers/#{target._key}/gift", {"days": "365"})), 404)
      assert_eq(res_status(post("/admin/customers/#{target._key}/unlock", {})), 404)
      again = User.find(target._key)
      assert_not(again.pro?)
      assert_not(again.locked_at.nil?)
    end

    test("an admin without two-step is sent to turn it on, and changes nothing") do
      admin = admin_spec_user("admin", nil, false)
      target = admin_spec_user()
      admin_spec_sign_in(admin)
      [
        "/admin",
        "/admin/customers",
        "/admin/customers/#{target._key}",
        "/admin/payments",
        "/admin/reports",
        "/admin/actions"
      ].each do |path|
        response = get(path)
        assert_eq(res_status(response), 302, path)
        assert_eq(res_location(response), "/admin/two-step", path)
      end
      gift = post("/admin/customers/#{target._key}/gift", {"days": "365"})
      assert_eq(res_location(gift), "/admin/two-step")
      assert_not(User.find(target._key).pro?)
      assert_eq(AdminAction.about(target._key).length, 0)

      page = get("/admin/two-step")
      assert_eq(res_status(page), 200)
      assert_contains(res_body(page), "Turn on two-step sign-in in your account to use the admin.")
      assert_contains(res_body(page), "href=\"/app/account#two-step\" data-turn-on-two-step")
      # Not locked out: the rest of the app still opens.
      assert_eq(res_status(get("/app/account")), 200)
    end

    test("the two-step page: 404 for a member, the section for an admin with two-step, sign-in for a guest") do
      assert_contains(res_location(get("/admin/two-step")), "/login")
      admin_spec_sign_in(admin_spec_user())
      assert_eq(res_status(get("/admin/two-step")), 404)
      admin_spec_sign_in(admin_spec_user("admin"))
      assert_eq(res_location(get("/admin/two-step")), "/admin")
      assert_eq(res_status(get("/admin")), 200)
    end

    test("a session that passed no second step is refused, even once the account has two-step on") do
      admin = admin_spec_user("admin", nil, false)
      target = admin_spec_user()
      # Signed in with the password alone, then two-step turned on behind
      # this session's back (by whoever holds the password, say).
      admin_spec_sign_in(admin)
      secret = User.find(admin._key).start_two_step
      User.find(admin._key).confirm_two_step(Crypto.totp_generate(secret, DateTime.utc.to_unix, 30))
      assert(User.find(admin._key).two_step?)
      ["/admin", "/admin/customers", "/admin/actions"].each do |path|
        response = get(path)
        assert_eq(res_status(response), 302, path)
        assert_eq(res_location(response), "/admin/two-step", path)
      end
      gift = post("/admin/customers/#{target._key}/gift", {"days": "365"})
      assert_eq(res_location(gift), "/admin/two-step")
      assert_not(User.find(target._key).pro?)
      assert_eq(AdminAction.about(target._key).length, 0)
      page = get("/admin/two-step")
      assert_eq(res_status(page), 200)
      assert_contains(res_body(page), "Sign out, then sign in again with the code of your authenticator app")
      assert_contains(res_body(page), "data-sign-in-again")
      assert_not(res_body(page).contains("data-turn-on-two-step"))

      # The same account, signed in again with its code: the section opens.
      admin_spec_sign_in(User.find(admin._key))
      assert_eq(res_status(get("/admin")), 200)
      assert_eq(res_location(get("/admin/two-step")), "/admin")
    end

    test("a code sign-in opens it for that account only, not for the next one signed in on the browser") do
      admin = admin_spec_user("admin")
      admin_spec_sign_in(admin)
      assert_eq(res_status(get("/admin")), 200)
      # Another admin signs in on the same browser with the password alone,
      # then turns two-step on outside this session: the first one's code
      # does not carry over.
      other = admin_spec_user("admin", nil, false)
      post(
        "/login",
        {"email": other.email, "password": ADMIN_SPEC_PASSWORD}
      )
      secret = User.find(other._key).start_two_step
      User.find(other._key).confirm_two_step(Crypto.totp_generate(secret, DateTime.utc.to_unix, 30))
      assert_eq(res_location(get("/admin")), "/admin/two-step")
    end

    test("turning two-step on in this session, with a first code, opens it") do
      admin = admin_spec_user("admin", nil, false)
      admin_spec_sign_in(admin)
      assert_eq(res_location(get("/admin")), "/admin/two-step")
      post("/app/account/two-step", {"password": ADMIN_SPEC_PASSWORD})
      secret = User.find(admin._key).pending_two_step
      assert_not_null(secret)
      # A wrong first code turns nothing on, and opens nothing.
      post("/app/account/two-step/confirm", {"code": "000000"})
      assert_eq(res_location(get("/admin")), "/admin/two-step")
      confirmed = post("/app/account/two-step/confirm", {"code": Crypto.totp_generate(
        secret,
        DateTime.utc.to_unix,
        30
      )})
      assert_eq(res_status(confirmed), 200)
      assert(User.find(admin._key).two_step?)
      assert_eq(res_status(get("/admin")), 200)
    end

    test("an admin sees the overview, and an Admin link in the nav") do
      admin = admin_spec_user("admin")
      admin_spec_sign_in(admin)
      response = get("/admin")
      assert_eq(res_status(response), 200)
      page = res_body(response)
      assert_contains(page, "data-admin=\"dashboard\"")
      assert_contains(page, "data-admin-link")
      assert_contains(page, "data-figure=\"accounts\"")
      assert_contains(page, "Payments are not open")
    end
  end

  describe("the overview") do
    test("counts the accounts, Pro, the offers, and the paying accounts' monthly revenue") do
      admin = admin_spec_user("admin")
      admin_spec_paying(admin_spec_user(), "monthly")
      admin_spec_paying(admin_spec_user(), "annual")
      offered = admin_spec_user()
      offered.gift_pro(30, DateTime.utc.to_unix)
      now = DateTime.utc.to_unix
      figures = AdminReport.figures(now)
      assert(figures["accounts"] >= 4)
      assert(figures["pro"] >= 3)
      assert(figures["gifts"] >= 1)
      # The offer brings nothing: 6 € a month, and 60 € a year over twelve.
      assert_eq(AdminReport.monthly_revenue(now) - figures["mrr_cents"], 0)
      assert(figures["mrr_cents"] >= 600 + 500)
      assert_eq(AdminReport.monthly_cents("annual"), 500)
      assert_eq(AdminReport.monthly_cents("monthly"), 600)
      assert(AdminReport.signed_up_since(now - 60).count >= 4)
      assert_eq(AdminReport.signed_up_since(now + 60).count, 0)
      admin_spec_sign_in(admin)
      assert_eq(res_status(get("/admin")), 200)
    end

    test("puts each sign-up in its week, the oldest first") do
      now = 100 * 7 * ADMIN_SPEC_DAY
      weeks = AdminReport.weeks([
        now - 1,
        now - 2,
        now - 8 * ADMIN_SPEC_DAY,
        now - 400 * ADMIN_SPEC_DAY
      ], now)
      assert_eq(weeks.length, 12)
      assert_eq(weeks[11]["count"], 2)
      assert_eq(weeks[10]["count"], 1)
      assert_eq(weeks.map(&:count).sum, 3)
      assert(AdminReport.weekly_signups(DateTime.utc.to_unix).length == 12)
    end
  end

  describe("GET /admin/customers") do
    test("finds an account by address or name, and filters by plan") do
      admin = admin_spec_user("admin")
      named = admin_spec_user("member", "Clara Wieck-#{uuid_v4}")
      paying = admin_spec_paying(admin_spec_user())
      admin_spec_sign_in(admin)

      by_name = res_body(get("/admin/customers?q=#{url_encode(named.name.downcase)}"))
      assert_contains(by_name, "data-customer=\"#{named._key}\"")
      assert_not(by_name.contains("data-customer=\"#{paying._key}\""))

      by_address = res_body(get("/admin/customers?q=#{url_encode(paying.email)}"))
      assert_contains(by_address, "data-customer=\"#{paying._key}\"")

      on_pro = res_body(get("/admin/customers?filter=pro"))
      assert_contains(on_pro, "data-customer=\"#{paying._key}\"")
      assert_not(on_pro.contains("data-customer=\"#{named._key}\""))

      nobody = res_body(get("/admin/customers?q=no-such-account-#{uuid_v4}"))
      assert_contains(nobody, "data-no-customer")
    end

    test("an unknown filter shows everyone") do
      admin = admin_spec_user("admin")
      admin_spec_sign_in(admin)
      get("/admin/customers?filter=nonsense")
      assert_eq(assigns()["filter"], "")
    end
  end

  describe("GET /admin/customers/:id") do
    test("shows the account, its plan and its Stripe customer") do
      admin = admin_spec_user("admin")
      paying = admin_spec_paying(admin_spec_user())
      admin_spec_sign_in(admin)
      page = res_body(get("/admin/customers/#{paying._key}"))
      assert_contains(page, paying.email)
      assert_contains(page, "data-plan-badge=\"pro\"")
      assert_contains(page, "dashboard.stripe.com/test/customers/cus_#{paying._key}")
      # A paying account's Pro is Stripe's: nothing to offer.
      assert_not(page.contains("data-gift"))
      # Stripe is not set up where the specs run: the invoices say so.
      assert_contains(page, "Stripe is not set up")
    end

    test("answers 404 for an account that does not exist") do
      admin = admin_spec_user("admin")
      admin_spec_sign_in(admin)
      assert_eq(res_status(get("/admin/customers/no-such-key")), 404)
    end
  end

  describe("what an admin changes") do
    test("offers Pro, lengthens the offer, then ends it") do
      admin = admin_spec_user("admin")
      customer = admin_spec_user()
      admin_spec_sign_in(admin)
      response = post("/admin/customers/#{customer._key}/gift", {"days": "30"})
      assert_eq(res_location(response), "/admin/customers/#{customer._key}")
      offered = User.find(customer._key)
      assert(offered.pro?)
      assert_eq(offered.plan_gift, true)
      first_end = offered.current_period_end
      assert_contains(offered.plan_summary, "Offered until")

      post("/admin/customers/#{customer._key}/gift", {"days": "30"})
      assert_eq(User.find(customer._key).current_period_end, first_end + 30 * ADMIN_SPEC_DAY)

      post("/admin/customers/#{customer._key}/gift/stop", {})
      ended = User.find(customer._key)
      assert_not(ended.pro?)
      assert_eq(ended.plan_gift, false)

      # Each change kept, the latest first: by whom, what, how long.
      kept = AdminAction.about(customer._key)
      assert_eq(kept.map(&:action), [
        "stop_gift",
        "gift",
        "gift"
      ])
      assert_eq(kept.map(&:admin_id).uniq, [admin._key])
      assert_eq(kept[0].admin_email, admin.email)
      assert_eq(kept[1].details["days"], 30)
      assert_eq(kept[1].target_type, "user")
      assert(kept[0].created_at > 0)
      assert_eq(kept[1].summary, "Offered 30 days of Pro")
      assert_eq(kept[0].summary, "Ended the offer of Pro")
    end

    test("a refused change is not kept as done") do
      paying = admin_spec_paying(admin_spec_user())
      free = admin_spec_user()
      admin_spec_sign_in(admin_spec_user("admin"))
      post("/admin/customers/#{paying._key}/gift", {"days": "30"})
      post("/admin/customers/#{free._key}/gift", {"days": "0"})
      post("/admin/customers/#{free._key}/gift/stop", {})
      post("/admin/customers/#{free._key}/confirm", {})
      assert_eq(AdminAction.about(paying._key).length, 0)
      assert_eq(AdminAction.about(free._key).length, 0, "already confirmed, no offer to end")
    end

    test("the account's page and the Activity tab show what the admins did") do
      admin = admin_spec_user("admin")
      customer = admin_spec_user()
      customer.locked_at = DateTime.utc.to_unix
      customer.update()
      admin_spec_sign_in(admin)
      assert_contains(res_body(get("/admin/customers/#{customer._key}")), "Nothing done by an admin yet.")
      post("/admin/customers/#{customer._key}/unlock", {})
      page = res_body(get("/admin/customers/#{customer._key}"))
      assert_contains(page, "data-admin-action=\"unlock\"")
      assert_contains(page, "Unlocked signing in")
      assert_contains(page, admin.email)
      activity = get("/admin/actions")
      assert_eq(res_status(activity), 200)
      assert_contains(res_body(activity), "data-admin-action=\"unlock\"")
      assert_contains(res_body(activity), "/admin/customers/#{customer._key}")
      assert(assigns()["actions"].length >= 1)
      # A member still learns nothing of it.
      admin_spec_sign_in(admin_spec_user())
      assert_eq(res_status(get("/admin/actions")), 404)
    end

    test("an action of an unknown kind is not kept") do
      admin = admin_spec_user("admin")
      refused = AdminAction.record(admin, "delete_everything", "user", admin._key, {})
      assert_eq(refused._errors[0]["field"], "action")
      assert_eq(AdminAction.about(admin._key).length, 0)
      kept = AdminAction.record(admin, "unlock", "user", admin._key)
      assert_null(kept._errors)
      assert_eq(AdminAction.about(admin._key).length, 1)
    end

    test("refuses an offer to a paying account, a length out of range, and an end with no offer") do
      paying = admin_spec_paying(admin_spec_user())
      assert_contains(paying.gift_pro(30, DateTime.utc.to_unix), "pays for Pro")
      assert_eq(User.find(paying._key).plan_gift, nil)
      free = admin_spec_user()
      assert_contains(free.gift_pro(0, DateTime.utc.to_unix), "from 1 to 3660")
      assert_contains(free.gift_pro(5000, DateTime.utc.to_unix), "from 1 to 3660")
      assert_not(User.find(free._key).pro?)
      assert_contains(free.stop_gift, "no offer")

      admin = admin_spec_user("admin")
      admin_spec_sign_in(admin)
      post("/admin/customers/#{paying._key}/gift", {"days": "30"})
      assert_eq(User.find(paying._key).plan_gift, nil)
      assert_eq(User.find(paying._key).stripe_subscription_id, "sub_#{paying._key}")
    end

    test("a Stripe subscription's end leaves an offer alone; a new subscription replaces it") do
      customer = admin_spec_user()
      customer.gift_pro(30, DateTime.utc.to_unix)
      offered = User.find(customer._key)
      assert_eq(Billing.ended({"id": "sub_old"}, offered), "ignored")
      assert(User.find(customer._key).pro?)
      subscription = {
        "id": "sub_new",
        "status": "active",
        "customer": "cus_x",
        "current_period_end": DateTime.utc.to_unix + 365 * ADMIN_SPEC_DAY,
        "metadata": {"plan": "pro"},
        "items": {"data": [{"price": {
          "id": "price_y",
          "recurring": {"interval": "year"}
        }}]}
      }
      assert_eq(Billing.subscribed(subscription, User.find(customer._key)), "processed")
      now_paying = User.find(customer._key)
      assert_eq(now_paying.plan_gift, false)
      assert_eq(now_paying.plan_interval, "annual")
      assert(now_paying.paying?)
      assert_eq(Billing.interval_of({"items": {"data": [{"price": "price_z"}]}}), "monthly")
      assert_eq(Billing.interval_of({}), "monthly")
    end

    test("unlocks signing in and confirms an address") do
      admin = admin_spec_user("admin")
      customer = admin_spec_user()
      customer.locked_at = DateTime.utc.to_unix
      customer.failed_attempts = 10
      customer.confirmed_at = nil
      customer.update()
      admin_spec_sign_in(admin)
      page = res_body(get("/admin/customers/#{customer._key}"))
      assert_contains(page, "data-locked=\"true\"")
      assert_contains(page, "data-confirmed=\"false\"")

      post("/admin/customers/#{customer._key}/unlock", {})
      post("/admin/customers/#{customer._key}/confirm", {})
      again = User.find(customer._key)
      assert(again.locked_at.nil?)
      assert_eq(again.failed_attempts, 0)
      assert(again.confirmed?)
      kept = AdminAction.about(customer._key)
      assert_eq(kept.map(&:action), ["confirm", "unlock"])
      assert_eq(kept[0].details["email"], customer.email)
      assert_eq(kept[0].summary, "Confirmed the address")

      response = post("/admin/customers/#{customer._key}/confirm", {})
      assert_contains(res_body(get(res_location(response))), "confirmed already")
    end

    test("says which lock holds signing in: some networks', or the account's (#539)") do
      admin = admin_spec_user("admin")
      customer = admin_spec_user()
      admin_spec_sign_in(admin)
      assert_contains(res_body(get("/admin/customers/#{customer._key}")), "data-locked=\"false\">Open")
      (0 .. AUTH_MAX_FAILED_ATTEMPTS).each do |_|
        User.find(customer._key).register_failed_attempt("192.0.2.50")
      end
      one = res_body(get("/admin/customers/#{customer._key}"))
      assert_contains(one, "Locked from 1 network: too many wrong passwords from it")
      (0 .. AUTH_MAX_FAILED_ATTEMPTS).each do |_|
        User.find(customer._key).register_failed_attempt("192.0.2.51")
      end
      assert_contains(res_body(get("/admin/customers/#{customer._key}")), "Locked from 2 networks")
      wide = User.find(customer._key)
      wide.account_locked_at = DateTime.utc.to_unix
      wide.update()
      account = res_body(get("/admin/customers/#{customer._key}"))
      assert_contains(account, "Locked for every browser that never signed in to it")
      post("/admin/customers/#{customer._key}/unlock", {})
      assert_not(User.find(customer._key).locked?)
    end
  end

  describe("the payments") do
    test("without Stripe, the page says so and lists the events") do
      admin = admin_spec_user("admin")
      customer = admin_spec_user()
      event = StripeEvent.claim("evt_#{uuid_v4}", "customer.subscription.updated")
      event.finish("processed", customer._key)
      admin_spec_sign_in(admin)
      page = res_body(get("/admin/payments"))
      assert_contains(page, "data-invoices-error")
      assert_contains(page, "customer.subscription.updated")
      assert_contains(page, "/admin/customers/#{customer._key}")
    end

    test("reads Stripe's invoices, each linked to its account") do
      customer = admin_spec_paying(admin_spec_user())
      paths = []
      answer = {"status": 200, "body": {
        "has_more": true,
        "data": [
          {
            "id": "in_1",
            "number": "A-0001",
            "status": "paid",
            "amount_paid": 600,
            "amount_due": 600,
            "currency": "eur",
            "created": 1767225600,
            "customer": "cus_#{customer._key}",
            "customer_email": customer.email,
            "hosted_invoice_url": "https://invoice.stripe.com/i/1"
          },
          {
            "id": "in_2",
            "status": "open",
            "amount_paid": 0,
            "amount_due": 6000,
            "currency": "usd",
            "customer": {"id": "cus_unknown"}
          }
        ]
      }.to_json}
      found = AdminReport.invoices("cus_#{customer._key}", "in_0", admin_spec_transport(answer, paths))
      assert_eq(paths[0], "GET invoices?limit=25&customer=cus_#{customer._key}&starting_after=in_0")
      assert_eq(found["more"], true)
      assert_eq(found["invoices"][0]["amount"], 600)
      assert_eq(found["invoices"][1]["amount"], 6000)
      assert_eq(found["invoices"][1]["customer"], "cus_unknown")
      accounts = AdminReport.accounts_of(found["invoices"])
      assert_eq(accounts["cus_#{customer._key}"], customer._key)
      assert(accounts["cus_unknown"].nil?)
      assert_eq(AdminReport.invoices_path(nil, nil), "invoices?limit=25")
    end

    test("says when Stripe cannot be read") do
      failed = AdminReport.invoices(nil, nil, admin_spec_transport(
        {"status": 401, "body": "{\"error\":{\"message\":\"Invalid API Key\"}}"},
        []
      ))
      assert_contains(failed["error"], "Invalid API Key")
      assert_eq(AdminReport.accounts_of([]), {})
    end
  end

  describe("the words") do
    test("money, dates and Stripe's dashboard") do
      assert_eq(admin_money(600), "€6.00")
      assert_eq(admin_money(1205, "usd"), "12.05 USD")
      assert_eq(admin_money(nil), "€0.00")
      assert_eq(admin_day(nil), "")
      assert_eq(admin_day(1767225600), "Jan 1, 2026")
      assert_eq(admin_day("2026-01-01T10:00:00+00:00"), "Jan 1, 2026")
      assert_eq(Stripe.dashboard_in("customers/cus_1", "sk_live_x"), "https://dashboard.stripe.com/customers/cus_1")
      assert_eq(
        Stripe.dashboard_in("customers/cus_1", "sk_test_x"),
        "https://dashboard.stripe.com/test/customers/cus_1"
      )
    end
  end
end
