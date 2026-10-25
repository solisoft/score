# The plans over HTTP (#393), on a server with no Stripe set up (as the
# specs run, and as the site runs until payments open): the Pricing page and
# the account's Subscription section show the plans; Upgrade and Manage
# billing need a sign-in and say payments are not open yet; coming back
# from Stripe changes no plan; the webhook refuses everything while no
# secret is set. Until payments open, the Free plan's new limits do not
# apply: nothing that worked before is refused (Plan.limits). And
# deleting an account with a subscription still deletes it.

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

# The page a redirect leads to (where its flash is shown).
def plans_followed(response)
  res_body(get(res_location(response)))
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

  describe("GET /pricing") do
    test("shows both plans, their limits read from Plan, and that payments are not open yet") do
      response = get("/pricing")
      assert_eq(res_status(response), 200)
      page = res_body(response)
      assert_contains(page, "data-plan=\"free\"")
      assert_contains(page, "data-plan=\"pro\"")
      # The site's own AI is gone (#396): Free has none, Pro's runs on one's own key.
      assert_contains(page, "<li data-plan-ai>No AI</li>")
      assert_contains(
        page,
        "<li data-plan-ai>AI (photo reading, assistant) with your own key from Anthropic, OpenAI, Gemini, "
        + "Mistral, DeepSeek, Kimi…</li>"
      )
      assert_not(page.contains("site's AI"))
      assert_not(page.contains("photos read a day"))
      # Payments closed: anyone may use their own key today.
      assert_contains(
        page,
        "<p class=\"muted\" data-ai-today>Until payments open, anyone signed in can use the AI with their own key.</p>"
      )
      assert_eq(assigns()["ai_note"], Plan.ai_note(false))
      # Once open, the note goes: the cards say who has the AI.
      assert_null(Plan.ai_note(true))
      assert_contains(page, "1 audio track a score")
      assert_contains(page, "2 GB of audio takes")
      assert_contains(page, "Share a score with up to 3 people")
      assert_contains(page, "6 € <small>a month</small>")
      assert_contains(page, "or 60 € a year")
      assert_contains(page, "data-payments-closed")
      assert_eq(assigns()["payments_open"], false)
      assert_eq(assigns()["plans"].length, 2)
    end

    test("is linked from the site's navigation") do
      assert_contains(res_body(get("/guide")), "<a href=\"/pricing\">Pricing</a>")
      assert_contains(res_body(get("/pricing")), "<a href=\"/pricing\" aria-current=\"page\">Pricing</a>")
    end
  end

  describe("the account's Subscription section") do
    test("on Free: the plan, Upgrade monthly and yearly, the way to Pricing, payments not open") do
      user = plans_user()
      plans_sign_in(user)
      page = res_body(get("/app/account"))
      assert_contains(page, "id=\"plan\"")
      assert_contains(page, "You are on <strong>Free</strong>.")
      assert_contains(page, "action=\"/app/billing/checkout\"")
      assert_contains(page, "name=\"interval\" value=\"monthly\"")
      assert_contains(page, "name=\"interval\" value=\"annual\"")
      assert_contains(page, "Upgrade: 6 € a month")
      assert_contains(page, "Upgrade: 60 € a year")
      assert_contains(page, "href=\"/pricing\"")
      assert_contains(page, "data-payments-closed")
      assert_not(page.includes?("Manage billing"), "no billing to manage")
    end

    test("on Pro: the plan, when it renews, Manage billing, and no Upgrade") do
      user = plans_make_pro(plans_user(), 10 * 86400)
      plans_sign_in(user)
      page = res_body(get("/app/account"))
      renews = DateTime.from_unix(user.current_period_end).format("%B %-d, %Y")
      assert_contains(page, "You are on <strong>Pro</strong>. Renews on #{renews}.")
      assert_contains(page, "action=\"/app/billing/portal\"")
      assert_contains(page, "Manage billing")
      assert_not(page.includes?("action=\"/app/billing/checkout\""), "no Upgrade on Pro")
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

    test("with no Stripe here: a clear refusal, back on the account, and nothing kept") do
      user = plans_user()
      plans_sign_in(user)
      ["monthly", "annual", "weekly"].each do |interval|
        response = post("/app/billing/checkout", {"interval": interval})
        assert_eq(res_status(response), 302)
        assert_eq(res_location(response), "/app/account#plan")
        assert_contains(plans_followed(response), BILLING_NOT_OPEN)
      end
      portal = post("/app/billing/portal", {})
      assert_eq(res_location(portal), "/app/account#plan")
      assert_contains(plans_followed(portal), BILLING_NOT_OPEN)
      stored = User.find(user._key)
      assert_null(stored.stripe_customer_id)
      assert_null(stored.plan)
    end

    test("back from Stripe: thanks, and the plan is still the webhook's to set") do
      user = plans_user()
      plans_sign_in(user)
      response = get("/app/billing/done?session_id=cs_forged")
      assert_eq(res_location(response), "/app/account#plan")
      assert_contains(plans_followed(response), "as soon as Stripe confirms the payment")
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

  describe("while payments are not open, over HTTP") do
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
      assert_eq(listed["pricing"], "/pricing")
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
