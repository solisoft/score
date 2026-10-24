# Stripe billing (#393), with no network: every request goes through a
# stand-in transport, and the webhook's secret is the spec's own. The plan
# changes only through a signed event: a good signature updates it; a bad,
# missing or stale one answers 400 and changes nothing; an event sent
# again does nothing; "deleted" puts the account back on Free, and a
# refused payment sets its status.

const BILL_SECRET = "whsec_spec_only_not_a_real_secret"
const BILL_DAY = 86400

def bill_user
  user = User.new()
  user.email = "bill-#{uuid_v4}@example.com"
  user.set_password("correct horse battery")
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  User.find(user._key)
end

# A transport that answers each request from `answers` ({"METHOD path":
# {"status", "body"}}; nil: unreachable) and notes it in `calls`.
def bill_transport(answers, calls)
  transport = fn(method, path, body) {
    calls.push({
      "method": method,
      "path": path,
      "body": body
    })
    answers["#{method} #{path}"]
  }
  transport
end

def bill_ok(data)
  {"status": 200, "body": data.to_json}
end

# A Stripe event of `kind` about `object`, made `at`.
def bill_event(kind, object, at = nil)
  {
    "id": "evt_#{uuid_v4}",
    "type": kind,
    "created": at ?? DateTime.utc.to_unix,
    "data": {"object": object}
  }
end

# A subscription of `user`'s to Pro.
def bill_subscription(user, status = "active", id = "sub_spec_1")
  {
    "id": id,
    "object": "subscription",
    "customer": "cus_#{user._key}",
    "status": status,
    "current_period_end": DateTime.utc.to_unix + 30 * BILL_DAY,
    "cancel_at_period_end": false,
    "metadata": {
      "user_key": user._key,
      "plan": "pro",
      "app": "score"
    },
    "items": {"data": [{"price": {"id": "price_spec_month"}}]}
  }
end

# The webhook's answer to `event`, signed at `stamp` (now by default).
def bill_receive(event, stamp = nil, secret = BILL_SECRET)
  payload = event.to_json
  now = DateTime.utc.to_unix
  header = Stripe.signature_for(payload, secret, stamp ?? now)
  Billing.receive(payload, header, BILL_SECRET, now)
end

describe("Stripe and Billing") do
  describe("the webhook's signature") do
    test("a signature of the payload, now, with the secret, is good") do
      now = DateTime.utc.to_unix
      header = Stripe.signature_for("{\"id\":1}", BILL_SECRET, now)
      assert(Stripe.signed?("{\"id\":1}", header, BILL_SECRET, now))
      # Stripe sends one v1 per secret while a secret is being rolled.
      signed_text = "#{now}.{\"id\":1}"
      good = Crypto.hmac(signed_text, BILL_SECRET)
      stale_mac = "0" * 64
      both = "t=#{now},v1=#{stale_mac},v1=#{good}"
      assert(Stripe.signed?("{\"id\":1}", both, BILL_SECRET, now))
    end

    test("refuses a changed payload, another secret, a missing header and a bare one") do
      now = DateTime.utc.to_unix
      header = Stripe.signature_for("{\"id\":1}", BILL_SECRET, now)
      assert_not(Stripe.signed?("{\"id\":2}", header, BILL_SECRET, now))
      assert_not(Stripe.signed?("{\"id\":1}", header, "whsec_other", now))
      assert_not(Stripe.signed?("{\"id\":1}", "", BILL_SECRET, now))
      assert_not(Stripe.signed?("{\"id\":1}", nil, BILL_SECRET, now))
      assert_not(Stripe.signed?("{\"id\":1}", "t=#{now}", BILL_SECRET, now))
      assert_not(Stripe.signed?("{\"id\":1}", "v1=abc", BILL_SECRET, now))
      assert_not(Stripe.signed?("{\"id\":1}", "t=soon,v1=abc", BILL_SECRET, now))
      assert_not(Stripe.signed?("{\"id\":1}", header, "", now))
    end

    test("five minutes either way, and not a second more") do
      now = DateTime.utc.to_unix
      body = "{\"id\":1}"
      assert(Stripe.signed?(body, Stripe.signature_for(body, BILL_SECRET, now - 300), BILL_SECRET, now))
      assert_not(Stripe.signed?(body, Stripe.signature_for(body, BILL_SECRET, now - 301), BILL_SECRET, now))
      assert(Stripe.signed?(body, Stripe.signature_for(body, BILL_SECRET, now + 300), BILL_SECRET, now))
      assert_not(Stripe.signed?(body, Stripe.signature_for(body, BILL_SECRET, now + 301), BILL_SECRET, now))
    end
  end

  describe("Billing.receive") do
    test("a good signature: the subscription puts the account on Pro, its period kept") do
      user = bill_user()
      subscription = bill_subscription(user)
      answer = bill_receive(bill_event("customer.subscription.created", subscription))
      assert_eq(answer["status"], 200)
      assert_eq(answer["body"]["outcome"], "processed")
      stored = User.find(user._key)
      assert_eq(stored.plan, "pro")
      assert_eq(stored.plan_status, "active")
      assert_eq(stored.current_period_end, subscription["current_period_end"])
      assert_eq(stored.stripe_subscription_id, "sub_spec_1")
      assert_eq(stored.stripe_customer_id, "cus_#{user._key}")
      assert(stored.pro?)
    end

    test("bad, missing or stale signatures answer 400, and change nothing") do
      user = bill_user()
      event = bill_event("customer.subscription.created", bill_subscription(user))
      payload = event.to_json
      now = DateTime.utc.to_unix
      wrong = bill_receive(event, now, "whsec_someone_else")
      missing = Billing.receive(payload, "", BILL_SECRET, now)
      stale = bill_receive(event, now - 301)
      [wrong, missing, stale].each do |answer|
        assert_eq(answer["status"], 400)
        assert_eq(answer["body"]["error"], "invalid signature")
      end
      stored = User.find(user._key)
      assert_null(stored.plan)
      assert_null(stored.stripe_subscription_id)
      assert_not(StripeEvent.seen?(event["id"]))
    end

    test("no secret set: 503, so Stripe tries again later; a signed body that is not JSON: 400") do
      assert_eq(Billing.receive("{}", "t=1,v1=x", "", DateTime.utc.to_unix)["status"], 503)
      now = DateTime.utc.to_unix
      garbled = Billing.receive("not json", Stripe.signature_for("not json", BILL_SECRET, now), BILL_SECRET, now)
      assert_eq(garbled["status"], 400)
      assert_eq(garbled["body"]["error"], "invalid payload")
    end

    test("an event sent again does nothing") do
      user = bill_user()
      event = bill_event("customer.subscription.created", bill_subscription(user))
      assert_eq(bill_receive(event)["body"]["outcome"], "processed")
      assert(StripeEvent.seen?(event["id"]))
      # Changed meanwhile (here by hand): the replay must not undo it.
      stored = User.find(user._key)
      stored.plan_status = "past_due"
      stored.update()
      again = bill_receive(event)
      assert_eq(again["status"], 200)
      assert_eq(again["body"]["outcome"], "duplicate")
      assert_eq(User.find(user._key).plan_status, "past_due")
      assert_eq(StripeEvent.where({"event_id": event["id"]}).count, 1)
    end

    test("deleted: back on Free") do
      user = bill_user()
      bill_receive(bill_event("customer.subscription.created", bill_subscription(user)))
      assert(User.find(user._key).pro?)
      ended = bill_receive(bill_event("customer.subscription.deleted", bill_subscription(user, "canceled")))
      assert_eq(ended["body"]["outcome"], "processed")
      stored = User.find(user._key)
      assert_eq(stored.plan, "free")
      assert_eq(stored.plan_status, "canceled")
      assert_null(stored.stripe_subscription_id)
      assert_not(stored.pro?)
      assert_eq(Plan.limits(stored)["plan"], "free")
    end

    test("deleted, for an older subscription than the account's: nothing changes") do
      user = bill_user()
      bill_receive(bill_event("customer.subscription.created", bill_subscription(user, "active", "sub_new")))
      old = bill_receive(bill_event("customer.subscription.deleted", bill_subscription(user, "canceled", "sub_old")))
      assert_eq(old["body"]["outcome"], "ignored")
      assert(User.find(user._key).pro?)
    end

    test("payment_failed: the status says so, and Pro stops until it is paid") do
      user = bill_user()
      bill_receive(bill_event("customer.subscription.created", bill_subscription(user)))
      invoice = {
        "id": "in_spec_1",
        "object": "invoice",
        "customer": "cus_#{user._key}",
        "subscription": "sub_spec_1"
      }
      failed = bill_receive(bill_event("invoice.payment_failed", invoice))
      assert_eq(failed["body"]["outcome"], "processed")
      stored = User.find(user._key)
      assert_eq(stored.plan_status, "past_due")
      assert_eq(stored.plan, "pro")
      assert_not(stored.pro?)
      assert_contains(stored.plan_summary(), "The last payment failed")
    end

    test("payment_failed in the newer API's shape, and for another subscription") do
      user = bill_user()
      bill_receive(bill_event("customer.subscription.created", bill_subscription(user)))
      other = {"customer": "cus_#{user._key}", "subscription": "sub_someone_else"}
      assert_eq(bill_receive(bill_event("invoice.payment_failed", other))["body"]["outcome"], "ignored")
      assert_eq(User.find(user._key).plan_status, "active")
      newer = {"customer": "cus_#{user._key}", "parent": {"subscription_details": {"subscription": "sub_spec_1"}}}
      assert_eq(bill_receive(bill_event("invoice.payment_failed", newer))["body"]["outcome"], "processed")
      assert_eq(User.find(user._key).plan_status, "past_due")
    end

    test("an event older than the last one applied changes nothing") do
      user = bill_user()
      now = DateTime.utc.to_unix
      bill_receive(bill_event("customer.subscription.deleted", bill_subscription(user, "canceled"), now))
      late = bill_receive(bill_event("customer.subscription.updated", bill_subscription(user), now - 60))
      assert_eq(late["body"]["outcome"], "stale")
      assert_eq(User.find(user._key).plan, "free")
    end

    test("found by the Stripe customer when no key was stamped; nobody found, or not Pro's: nothing") do
      user = bill_user()
      user.stripe_customer_id = "cus_by_customer"
      user.update()
      subscription = bill_subscription(user, "trialing", "sub_portal")
      subscription["metadata"] = {"plan": "pro"}
      subscription["customer"] = {"id": "cus_by_customer"}
      assert_eq(
        bill_receive(bill_event("customer.subscription.updated", subscription))["body"]["outcome"],
        "processed"
      )
      assert_eq(User.find(user._key).plan_status, "trialing")
      assert(User.find(user._key).pro?)
      stranger = bill_subscription(user)
      stranger["metadata"] = {}
      stranger["customer"] = "cus_nobody"
      assert_eq(bill_receive(bill_event("customer.subscription.updated", stranger))["body"]["outcome"], "no_user")
      not_ours = bill_subscription(user, "active", "sub_portal")
      not_ours["metadata"] = {"user_key": user._key}
      assert_eq(bill_receive(bill_event("customer.subscription.updated", not_ours))["body"]["outcome"], "ignored")
      assert_eq(bill_receive(bill_event("charge.refunded", {"id": "ch_1"}))["body"]["outcome"], "ignored")
    end

    test("the period end read from the subscription's item, as newer API versions give it") do
      user = bill_user()
      subscription = bill_subscription(user)
      subscription["current_period_end"] = nil
      ends = DateTime.utc.to_unix + 9 * BILL_DAY
      subscription["items"] = {"data": [{
        "price": {"id": "price_x"},
        "current_period_end": ends
      }]}
      bill_receive(bill_event("customer.subscription.updated", subscription))
      assert_eq(User.find(user._key).current_period_end, ends)
      assert_null(Billing.period_end({"items": {"data": []}}))
      assert_eq(Billing.price_of({"items": {"data": [{"price": "price_plain"}]}}), "price_plain")
      assert_eq(Billing.price_of({}), "")
    end

    test("checkout completed: the customer and subscription kept, the subscription read from Stripe") do
      user = bill_user()
      session = {
        "id": "cs_spec_1",
        "object": "checkout.session",
        "client_reference_id": user._key,
        "customer": "cus_checkout",
        "subscription": "sub_checkout",
        "metadata": {"user_key": user._key}
      }
      calls = []
      subscription = bill_subscription(user, "active", "sub_checkout")
      subscription["customer"] = "cus_checkout"
      transport = bill_transport({"GET subscriptions/sub_checkout": bill_ok(subscription)}, calls)
      outcome = Billing.handle(bill_event("checkout.session.completed", session), transport)
      assert_eq(outcome, "processed")
      assert_eq(calls.length, 1)
      assert_eq(calls[0]["method"], "GET")
      stored = User.find(user._key)
      assert_eq(stored.stripe_customer_id, "cus_checkout")
      assert_eq(stored.stripe_subscription_id, "sub_checkout")
      assert(stored.pro?)
    end

    test("checkout completed while Stripe cannot be read: the ids kept, the plan left to the subscription's event") do
      user = bill_user()
      session = {
        "client_reference_id": user._key,
        "customer": "cus_c2",
        "subscription": "sub_c2"
      }
      outcome = Billing.handle(bill_event("checkout.session.completed", session), bill_transport({}, []))
      assert_eq(outcome, "processed")
      stored = User.find(user._key)
      assert_eq(stored.stripe_subscription_id, "sub_c2")
      assert_not(stored.pro?)
      none = {"client_reference_id": user._key, "customer": "cus_c2"}
      assert_eq(Billing.handle(bill_event("checkout.session.completed", none), bill_transport({}, [])), "processed")
    end
  end

  describe("an event whose handling fails") do
    test("is not kept as handled, so Stripe's next try applies it") do
      user = bill_user()
      session = {
        "client_reference_id": user._key,
        "customer": "cus_f",
        "subscription": "sub_f"
      }
      event = bill_event("checkout.session.completed", session)
      failing = fn(method, path, body) {
        throw "the network fell over"
      }
      assert_raises("the network fell over") do
        Billing.handle(event, failing)
      end
      assert_not(StripeEvent.seen?(event["id"]))
      subscription = bill_subscription(user, "active", "sub_f")
      again = Billing.handle(event, bill_transport({"GET subscriptions/sub_f": bill_ok(subscription)}, []))
      assert_eq(again, "processed")
      assert(User.find(user._key).pro?)
    end
  end

  describe("Checkout and the portal") do
    test("a new customer made and kept, then the session for the Price, with the user's key on it") do
      user = bill_user()
      calls = []
      transport = bill_transport(
        {"POST customers": bill_ok({"id": "cus_new"}), "POST checkout/sessions": bill_ok({
          "id": "cs_1",
          "url": "https://checkout.stripe.com/c/pay/cs_1"
        })},
        calls
      )
      answer = Billing.start_checkout(
        user,
        "price_annual",
        "annual",
        "https://x.test/done",
        "https://x.test/back",
        transport
      )
      assert_eq(answer["url"], "https://checkout.stripe.com/c/pay/cs_1")
      assert_eq(calls.map(&:path), ["customers", "checkout/sessions"])
      assert_contains(calls[0]["body"], "metadata%5Buser_key%5D=#{user._key}")
      session = calls[1]["body"]
      assert_contains(session, "mode=subscription")
      assert_contains(session, "customer=cus_new")
      assert_contains(session, "line_items%5B0%5D%5Bprice%5D=price_annual")
      assert_contains(session, "client_reference_id=#{user._key}")
      assert_contains(session, "subscription_data%5Bmetadata%5D%5Buser_key%5D=#{user._key}")
      assert_contains(session, "success_url=https%3A%2F%2Fx.test%2Fdone")
      stored = User.find(user._key)
      assert_eq(stored.stripe_customer_id, "cus_new")
      # Checkout is not the webhook: no plan yet.
      assert_null(stored.plan)
    end

    test("an existing customer is reused") do
      user = bill_user()
      user.stripe_customer_id = "cus_kept"
      user.update()
      calls = []
      transport = bill_transport({"POST checkout/sessions": bill_ok({"url": "https://checkout.stripe.com/x"})}, calls)
      answer = Billing.start_checkout(
        User.find(user._key),
        "price_m",
        "monthly",
        "https://a/",
        "https://b/",
        transport
      )
      assert_eq(answer["url"], "https://checkout.stripe.com/x")
      assert_eq(calls.map(&:path), ["checkout/sessions"])
      assert_contains(calls[0]["body"], "customer=cus_kept")
    end

    test("Stripe unreachable or refusing: a clear error, no customer kept, nothing charged") do
      user = bill_user()
      down = Billing.start_checkout(user, "price_m", "monthly", "https://a/", "https://b/", bill_transport({}, []))
      assert_eq(down["error"], BILLING_STRIPE_DOWN)
      assert_null(User.find(user._key).stripe_customer_id)
      refusing = bill_transport(
        {"POST customers": bill_ok({"id": "cus_r"}), "POST checkout/sessions": {
          "status": 400,
          "body": "{\"error\":{\"message\":\"No such price\"}}"
        }},
        []
      )
      refused = Billing.start_checkout(user, "price_x", "monthly", "https://a/", "https://b/", refusing)
      assert_eq(refused["error"], BILLING_STRIPE_DOWN)
      no_url = bill_transport({"POST checkout/sessions": bill_ok({"id": "cs_no_url"})}, [])
      assert_eq(
        Billing.start_checkout(User.find(user._key), "p", "monthly", "a", "b", no_url)["error"],
        BILLING_STRIPE_DOWN
      )
    end

    test("someone on Pro already is sent to Manage billing") do
      user = bill_user()
      bill_receive(bill_event("customer.subscription.created", bill_subscription(user)))
      calls = []
      answer = Billing.start_checkout(User.find(user._key), "p", "monthly", "a", "b", bill_transport({}, calls))
      assert_contains(answer["error"], "You are on Pro already")
      assert_eq(calls.length, 0)
    end

    test("the portal: for a customer only") do
      user = bill_user()
      calls = []
      transport = bill_transport(
        {"POST billing_portal/sessions": bill_ok({"url": "https://billing.stripe.com/p/1"})},
        calls
      )
      assert_contains(Billing.open_portal(user, "https://x/account", transport)["error"], "no billing to manage")
      assert_eq(calls.length, 0)
      user.stripe_customer_id = "cus_portal"
      user.update()
      answer = Billing.open_portal(User.find(user._key), "https://x/account", transport)
      assert_eq(answer["url"], "https://billing.stripe.com/p/1")
      assert_eq(calls[0]["body"], "customer=cus_portal&return_url=https%3A%2F%2Fx%2Faccount")
      assert_eq(Billing.open_portal(User.find(user._key), "r", bill_transport({}, []))["error"], BILLING_STRIPE_DOWN)
    end

    test("without Stripe set up here, payments are not open") do
      user = bill_user()
      assert_not(Stripe.configured?)
      assert_eq(Billing.checkout(user, "monthly", "a", "b")["error"], BILLING_NOT_OPEN)
      assert_eq(Billing.portal(user, "a")["error"], BILLING_NOT_OPEN)
      assert(Stripe.open_with?("sk_x", "price_m", "price_a"))
      assert_not(Stripe.open_with?("sk_x", "price_m", ""))
      assert_not(Stripe.open_with?("", "price_m", "price_a"))
      assert_eq(Stripe.price_in("annual", "m", "a"), "a")
      assert_eq(Stripe.price_in("monthly", "m", "a"), "m")
      assert_not(Stripe.pro_price?(""))
      assert_not(Stripe.pro_price?("price_unknown"))
    end
  end

  describe("cancelling on leaving") do
    test("cancels the subscription; logs and answers false when Stripe refuses or cannot be reached") do
      user = bill_user()
      user.stripe_subscription_id = "sub_leaving"
      calls = []
      ok = bill_transport({"DELETE subscriptions/sub_leaving": bill_ok({
        "id": "sub_leaving",
        "status": "canceled"
      })}, calls)
      assert(Billing.cancel_subscription(user, ok))
      assert_eq(calls[0]["method"], "DELETE")
      assert_not(Billing.cancel_subscription(user, bill_transport({}, [])))
      # No subscription: nothing to cancel.
      assert(Billing.cancel_on_leaving(bill_user()))
      # No key on this server: logged, and the account may go all the same.
      assert_not(Billing.cancel_on_leaving(user))
    end
  end

  describe("Stripe's answers") do
    test("parsed: data on 2xx, Stripe's message otherwise") do
      assert_eq(Stripe.parsed(200, "{\"id\":\"x\"}")["data"]["id"], "x")
      assert_eq(Stripe.parsed(402, "{\"error\":{\"message\":\"Card declined\"}}")["error"], "Card declined")
      assert_eq(Stripe.parsed(500, "oops")["error"], "Stripe answered 500")
      assert_eq(Stripe.parsed(200, "oops")["error"], "Stripe's answer was not JSON")
      assert_eq(Stripe.call("GET", "x", "", fn(m, p, b) { nil })["error"], "unreachable")
      assert_eq(Stripe.form({"a b": "c&d", "n": 1}), "a%20b=c%26d&n=1")
    end
  end
end
