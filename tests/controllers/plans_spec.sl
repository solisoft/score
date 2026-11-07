# The plans over HTTP (#393), while the site is free (#699, Plan.free?) and
# with no Stripe set up (as the specs run): the Pricing page leads to the
# home page, the account says nothing of plans, Upgrade, Manage billing and
# the way back from Stripe are 404 behind a sign-in; the webhook refuses
# everything while no secret is set. The Free plan's limits do not apply:
# everyone has Pro's (Plan.limits). And deleting an account with a
# subscription still deletes it.

const PLANS_PASSWORD = "correct horse battery"
const PLANS_WAV = "RIFF....WAVEfmt data of a short take"

def plans_user(name = nil)
  user = User.new()
  user.email = "plans-#{uuid_v4}@example.com"
  user.name = name unless name.nil?
  user.set_password(PLANS_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  User.find(user._key)
end

def plans_make_pro(user, ends_in = 30 * 86400)
  user.plan = "pro"
  user.plan_status = "active"
  user.current_period_end = DateTime.utc.to_unix + ends_in
  user.stripe_customer_id = "cus_#{user._key}"
  user.stripe_subscription_id = "sub_#{user._key}"
  user.update()
  User.find(user._key)
end

def plans_sign_in(user)
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": PLANS_PASSWORD}
  )
end

def plans_upload(score, track)
  boundary = "----soli-plans-spec"
  fields = {
    "track": track,
    "name": "Voice",
    "offset": "0",
    "rate": "1",
    "duration": "2"
  }
  payload = ""
  fields.keys.each do |key|
    payload = payload + "--#{boundary}\r\nContent-Disposition: form-data; name=\"#{key}\"\r\n\r\n#{fields[key]}\r\n"
  end
  payload = payload + "--#{boundary}\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"take.wav\"\r\n"
  + "Content-Type: audio/wav\r\n\r\n#{PLANS_WAV}\r\n--#{boundary}--\r\n"
  set_header("Content-Type", "multipart/form-data; boundary=#{boundary}")
  answer = post("/app/scores/#{score._key}/takes", payload)
  clear_headers()
  answer
end

describe("The plans") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  describe("GET /pricing, while the site is free (#699)") do
    test("answers 301 to the home page, in the page's language, and shows no plan") do
      response = get("/pricing")
      assert_eq(res_status(response), 301)
      assert_eq(res_location(response), "/")
      assert_not(res_body(response).contains("data-plan"), "no plan card")
      assert_null(assigns()["plans"], "no catalog read")
      french = get("/fr/pricing")
      assert_eq(res_status(french), 301)
      assert_eq(res_location(french), "/fr")
    end

    test("is linked from no page: neither the header, the footer, nor the changelog") do
      guide = res_body(get("/guide"))
      assert_not(guide.contains("href=\"/pricing\""), "the guide links no Pricing")
      assert_not(guide.contains(">Pricing</a>"))
      changelog = res_body(get("/changelog"))
      assert_not(changelog.contains("href=\"/pricing\""), "old entries link the home page instead")
      assert_not(res_body(get("/fr/guide")).contains(">Tarifs</a>"))
    end
  end

  describe("the account, while the site is free (#699)") do
    test("on Free: no plan named, no Subscription section, no Upgrade, no way to Pricing") do
      user = plans_user()
      plans_sign_in(user)
      response = get("/app/account")
      assert_eq(res_status(response), 200)
      page = res_body(response)
      assert_contains(page, "<h1>Your account</h1>")
      assert_not(page.includes?("id=\"plan\""), "no Subscription section")
      assert_not(page.includes?("href=\"#plan\""), "nothing in the side menu")
      assert_not(page.includes?("You are on"), "no plan named")
      assert_not(page.includes?("/app/billing/"), "no form to Stripe")
      assert_not(page.includes?("Upgrade"), "no Upgrade")
      assert_not(page.includes?("Compare the plans"))
      assert_not(page.includes?("/pricing"), "no way to Pricing")
      assert_not(page.includes?("data-payments-closed"))
      assert_not(page.includes?("data-ai-plan"), "the AI is not Pro's")
    end

    test("on Pro, Stripe's customer and all: no plan named either, and no Manage billing") do
      user = plans_make_pro(plans_user(), 10 * 86400)
      plans_sign_in(user)
      page = res_body(get("/app/account"))
      assert_not(page.includes?("id=\"plan\""), "no Subscription section")
      assert_not(page.includes?("<strong>Pro</strong>"), "no plan named")
      assert_not(page.includes?("Manage billing"), "no billing to manage")
      assert_not(page.includes?("/app/billing/"), "no form to Stripe")
    end

    test("cancelled at the period's end, or lapsed: says when it ends or ended") do
      user = plans_make_pro(plans_user())
      user.cancel_at_period_end = true
      user.update()
      ends = DateTime.from_unix(user.current_period_end).format("%B %-d, %Y")
      assert_eq(User.find(user._key).plan_summary(), "Ends on #{ends}: it will not renew.")
      lapsed = plans_make_pro(plans_user(), -86400)
      ended = DateTime.from_unix(lapsed.current_period_end).format("%B %-d, %Y")
      assert_eq(lapsed.plan_summary(), "Pro ended on #{ended}.")
      assert_eq(lapsed.plan_name, "Free")
      trial = plans_make_pro(plans_user())
      trial.plan_status = "trialing"
      assert_contains(trial.plan_summary(), "On trial until")
      assert_null(plans_user().plan_summary())
    end
  end

  describe("Upgrade and Manage billing") do
    test("need a sign-in") do
      # As the account page's forms post them.
      set_header("Content-Type", "application/x-www-form-urlencoded")
      checkout = post("/app/billing/checkout", "interval=monthly")
      assert_eq(res_status(checkout), 302)
      assert_contains(res_location(checkout), "/login")
      portal = post("/app/billing/portal", "")
      assert_eq(res_status(portal), 302)
      assert_contains(res_location(portal), "/login")
      clear_headers()
      done = get("/app/billing/done")
      assert_eq(res_status(done), 302)
      assert_contains(res_location(done), "/login")
      # Asked as JSON: 401, not a page to sign in on.
      assert_eq(res_status(post("/app/billing/checkout", {"interval": "monthly"})), 401)
    end

    test("signed in, while the site is free (#699): 404, no Stripe customer, no plan") do
      user = plans_user()
      plans_sign_in(user)
      ["monthly", "annual", "weekly"].each do |interval|
        response = post("/app/billing/checkout", {"interval": interval})
        assert_eq(res_status(response), 404, interval)
        assert_null(res_location(response), "not sent to Stripe or anywhere")
      end
      assert_eq(res_status(post("/app/billing/portal", {})), 404)
      stored = User.find(user._key)
      assert_null(stored.stripe_customer_id)
      assert_null(stored.plan)
      # A Pro account, with a customer at Stripe, has no portal either.
      pro = plans_make_pro(plans_user())
      plans_sign_in(pro)
      assert_eq(res_status(post("/app/billing/portal", {})), 404)
      assert_eq(res_status(post("/app/billing/checkout", {"interval": "annual"})), 404)
    end

    test("back from Stripe, while the site is free: 404, no thanks, and the plan unchanged") do
      user = plans_user()
      plans_sign_in(user)
      response = get("/app/billing/done?session_id=cs_forged")
      assert_eq(res_status(response), 404)
      assert_not(res_body(response).contains("as soon as Stripe confirms the payment"))
      stored = User.find(user._key)
      assert_null(stored.plan)
      assert_not(stored.pro?)
    end
  end

  describe("POST /webhooks/stripe") do
    test("with no secret set: 503 and nothing changes, signed or not") do
      user = plans_user()
      event = {
        "id": "evt_forged",
        "type": "customer.subscription.created",
        "created": DateTime.utc.to_unix,
        "data": {"object": {
          "id": "sub_forged",
          "status": "active",
          "current_period_end": DateTime.utc.to_unix + 86400,
          "metadata": {"user_key": user._key, "plan": "pro"}
        }}
      }
      payload = event.to_json
      set_header("Stripe-Signature", Stripe.signature_for(payload, "whsec_guess", DateTime.utc.to_unix))
      set_header("Content-Type", "application/json")
      response = post("/webhooks/stripe", payload)
      clear_headers()
      assert_eq(res_status(response), 503)
      assert_eq(res_json(response)["error"], "webhook not configured")
      assert_null(User.find(user._key).plan)
      assert_not(StripeEvent.seen?("evt_forged"))
    end
  end

  describe("while the site is free (#699), over HTTP: Pro's limits for everyone") do
    test("every audio track records, past 50 MB of takes, as before the plans") do
      owner = plans_user()
      score = Score.start(owner, Score.blank_source("Duet"))
      ScoreTake.create({
        "score_id": score._key,
        "user_id": owner._key,
        "track": 3,
        "size": 60000000,
        "created_at": DateTime.utc.to_unix
      })
      plans_sign_in(owner)
      listed = res_json(get("/app/scores/#{score._key}/takes"))
      assert_eq(listed["tracks_allowed"], 4)
      assert_null(listed["pricing"], "no way to Pricing for the editor")
      assert_eq(res_status(plans_upload(score, "2")), 201)
      assert_eq(res_status(plans_upload(score, "4")), 201)
      assert_eq(ScoreTake.where({"score_id": score._key}).count, 3)
      # Out of range is refused as it always was, with no way to Pricing.
      refused = plans_upload(score, "5")
      assert_eq(res_status(refused), 422)
      assert_null(res_json(refused)["upgrade"])
      assert_eq(ScoreTake.where({"score_id": score._key}).count, 3)
    end

    test("a score is shared with a fourth and a fifth person") do
      owner = plans_user()
      score = Score.start(owner, Score.blank_source("Quintet"))
      plans_sign_in(owner)
      ["one", "two", "three", "four", "five"].each do |name|
        invited = post(
          "/app/scores/#{score._key}/invitations",
          {"email": "#{name}-#{uuid_v4}@example.com", "role": "read"}
        )
        assert_eq(res_status(invited), 302)
      end
      assert_eq(ScoreShare.of(score).length, 5)
      assert_not(res_body(get("/app/scores/#{score._key}/share")).includes?("data-upgrade"))
    end
  end

  describe("leaving") do
    test("an account with a subscription is deleted even when Stripe cannot cancel it") do
      user = plans_make_pro(plans_user())
      plans_sign_in(user)
      response = request("DELETE", "/app/account", {"password": PLANS_PASSWORD}, {})
      assert_eq(res_status(response), 302)
      assert_null(User.find_by("_key", user._key))
    end

    test("the export holds the plan") do
      user = plans_make_pro(plans_user())
      shown = AccountExport.account(user, DateTime.utc.to_unix)["plan"]
      assert_eq(shown["plan"], "pro")
      assert_eq(shown["pro_now"], true)
      assert_eq(shown["status"], "active")
      assert_eq(shown["current_period_end"], DateTime.from_unix(user.current_period_end).to_iso)
      assert_eq(shown["stripe_customer_id"], "cus_#{user._key}")
      assert_eq(shown["stripe_subscription_id"], "sub_#{user._key}")
      assert_eq(shown["cancel_at_period_end"], false)
      free = AccountExport.account(plans_user(), DateTime.utc.to_unix)["plan"]
      assert_eq(free["plan"], "free")
      assert_eq(free["pro_now"], false)
      assert_null(free["current_period_end"])
    end
  end
end
