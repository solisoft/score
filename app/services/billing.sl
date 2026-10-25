# The Pro plan's billing (#393), through Stripe: a Checkout session to
# subscribe, the customer portal to change or cancel, and the webhook whose
# events set the plan. The plan comes from the webhook only, never from the
# page Stripe sends the person back to.
#
# A user carries `plan` ("free", "pro"), `plan_status` (Stripe's status of
# the subscription: "active", "trialing", "past_due", "canceled"…),
# `current_period_end` (unix seconds), `cancel_at_period_end`,
# `stripe_customer_id` and `stripe_subscription_id`. User#pro? reads them.
#
# Each method that asks Stripe takes a `transport` (Stripe.call): nil in the
# app, a stand-in in the specs.
const BILLING_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed"
]
# A subscription in one of these is over: the account is on Free again.
const BILLING_ENDED = ["canceled", "incomplete_expired"]
const BILLING_NOT_OPEN = "Payments are not open yet: the Pro plan will be on sale soon. Free stays as it is."
const BILLING_STRIPE_DOWN = "Stripe could not be reached: nothing was charged. Try again in a moment."

class Billing
  # --- Subscribing ----------------------------------------------------------

  # Where to send `user` to pay for Pro every `interval`: {"url"}, or
  # {"error"} to show them.
  static def checkout(user, interval, success_url, cancel_url)
    return {"error": BILLING_NOT_OPEN} unless Stripe.configured?

    Billing.start_checkout(user, Stripe.price_id(interval), Plan.interval(interval), success_url, cancel_url)
  end

  # The Checkout session itself, for `price_id`: the user's Stripe customer
  # made first if they have none, reused if they have.
  static def start_checkout(user, price_id, interval, success_url, cancel_url, transport = nil)
    return {"error": "You are on Pro already: Manage billing changes or cancels it."} if user.pro?

    customer = Billing.customer_of(user, transport)
    return customer if customer["id"].nil?

    form = Stripe.checkout_form(customer["id"], price_id, user._key, interval, success_url, cancel_url)
    answer = Stripe.call("POST", "checkout/sessions", form, transport)
    return {"error": BILLING_STRIPE_DOWN} unless answer["ok"]

    Billing.stripe_page(answer["data"])
  end

  # {"url"} of a page of Stripe's (`data` as Stripe answered it), or
  # {"error"} when the answer holds none.
  static def stripe_page(data)
    stripe_url = data["url"].to_s
    return {"error": BILLING_STRIPE_DOWN} unless stripe_url.starts_with?("https://")

    {"url": stripe_url}
  end

  # `user`'s Stripe customer: {"id"}, made and kept on the account the first
  # time; {"error"} when Stripe could not make it.
  static def customer_of(user, transport = nil)
    return {"id": user.stripe_customer_id} if user.stripe_customer_id.present?

    answer = Stripe.call("POST", "customers", Stripe.customer_form(user), transport)
    return {"error": BILLING_STRIPE_DOWN} unless answer["ok"]

    user.stripe_customer_id = answer["data"]["id"].to_s
    user.update()
    {"id": user.stripe_customer_id}
  end

  # Stripe's customer portal for `user`, to come back to `return_url`:
  # {"url"}, or {"error"}.
  static def portal(user, return_url)
    return {"error": BILLING_NOT_OPEN} unless Stripe.configured?

    Billing.open_portal(user, return_url)
  end

  static def open_portal(user, return_url, transport = nil)
    return {"error": "There is no billing to manage yet: Upgrade starts it."} if user.stripe_customer_id.blank?

    form = Stripe.form({"customer": user.stripe_customer_id, "return_url": return_url})
    answer = Stripe.call("POST", "billing_portal/sessions", form, transport)
    return {"error": BILLING_STRIPE_DOWN} unless answer["ok"]

    Billing.stripe_page(answer["data"])
  end

  # --- Leaving ----------------------------------------------------------------

  # `user`'s subscription cancelled now, as their account is deleted: true
  # when there was none or Stripe cancelled it. When Stripe cannot be
  # asked, it is logged, and the account goes all the same.
  static def cancel_on_leaving(user)
    return true if user.stripe_subscription_id.blank?

    unless Stripe.secret_key.present?
      Logger.warn("billing: #{user._key}'s subscription #{user.stripe_subscription_id} not cancelled: no Stripe key")
      return false
    end

    Billing.cancel_subscription(user)
  end

  static def cancel_subscription(user, transport = nil)
    path = "subscriptions/#{url_encode(user.stripe_subscription_id.to_s)}"
    answer = Stripe.call("DELETE", path, "", transport)
    unless answer["ok"]
      reason = answer["error"]
      Logger.warn("billing: #{user._key}'s subscription #{user.stripe_subscription_id} not cancelled: #{reason}")
      return false
    end

    true
  end

  # --- The webhook ------------------------------------------------------------

  # The answer to a POST of `payload` signed by `header` (Stripe-Signature),
  # checked with `secret` at `now`: {"status", "body"}. 400 when the
  # signature is missing, wrong or stale, with nothing changed; 503 while
  # no secret is set (Stripe tries again later).
  static def receive(payload, header, secret, now, transport = nil)
    if secret.blank?
      return {"status": 503, "body": {"error": "webhook not configured"}}
    end

    unless Stripe.signed?(payload, header, secret, now)
      return {"status": 400, "body": {"error": "invalid signature"}}
    end

    parsed = json_parse(payload) rescue nil
    unless parsed.is_a?("hash")
      return {"status": 400, "body": {"error": "invalid payload"}}
    end

    {"status": 200, "body": {"received": true, "outcome": Billing.handle(parsed, transport)}}
  end

  # `event` applied once: "processed", "ignored" (not one of BILLING_EVENTS,
  # or not this site's), "no_user", "stale" (older than what the account
  # holds) or "duplicate" (handled already).
  static def handle(event, transport = nil)
    kind = event["type"].to_s
    return "ignored" unless BILLING_EVENTS.includes?(kind)

    claimed = StripeEvent.claim(event["id"], kind)
    return "duplicate" if claimed.nil?

    let result = nil
    try
      result = Billing.apply(kind, event, transport)
    catch error
      # Not kept as handled: Stripe sends it again, and it is tried again.
      claimed.delete
      throw error
    end
    claimed.finish(result["outcome"], result["user"])
    result["outcome"]
  end

  # What `event` (of `kind`) changes: {"outcome", "user"}.
  static def apply(kind, event, transport = nil)
    object = (event["data"] ?? {})["object"] ?? {}
    user = Billing.user_for(object)
    if user.nil?
      return {"outcome": "no_user", "user": nil}
    end

    at = event["created"].to_s.to_i
    if at < (user.billing_event_at ?? 0)
      return {"outcome": "stale", "user": user._key}
    end

    outcome = Billing.applied(kind, object, user, transport)
    if outcome == "processed"
      user.billing_event_at = at
      user.update()
    end
    {"outcome": outcome, "user": user._key}
  end

  static def applied(kind, object, user, transport)
    return Billing.completed(object, user, transport) if kind == "checkout.session.completed"
    return Billing.ended(object, user) if kind == "customer.subscription.deleted"
    return Billing.payment_failed(object, user) if kind == "invoice.payment_failed"

    Billing.subscribed(object, user)
  end

  # The user an event's object is about: by the key stamped at checkout,
  # else by their Stripe customer. nil when neither names one.
  static def user_for(object)
    key = (object["metadata"] ?? {})["user_key"] ?? object["client_reference_id"]
    unless key.to_s.blank?
      user = User.find_by("_key", key.to_s)
      return user unless user.nil?
    end

    customer = Billing.id_of(object["customer"])
    return nil if customer.blank?

    User.find_by("stripe_customer_id", customer)
  end

  # An id Stripe gives as a string, or inside an expanded object.
  static def id_of(value)
    return value["id"].to_s if value.is_a?("hash")

    value.to_s
  end

  # Checkout done: the customer and the subscription kept, and the
  # subscription read from Stripe for its status and period (the session
  # holds neither). If Stripe cannot be read, the subscription's own events
  # bring them.
  static def completed(session, user, transport)
    customer = Billing.id_of(session["customer"])
    subscription = Billing.id_of(session["subscription"])
    user.stripe_customer_id = customer unless customer.blank?
    user.stripe_subscription_id = subscription unless subscription.blank?
    user.update()
    return "processed" if subscription.blank?

    answer = Stripe.call("GET", "subscriptions/#{url_encode(subscription)}", "", transport)
    return "processed" unless answer["ok"]

    Billing.subscribed(answer["data"], user)
  end

  # A subscription made or changed: its status and period kept. Only
  # Pro's (by its Price, or the plan stamped at checkout).
  static def subscribed(subscription, user)
    return "ignored" unless Billing.pro_subscription?(subscription)

    status = subscription["status"].to_s
    user.plan = BILLING_ENDED.includes?(status) ? "free" : "pro"
    user.plan_status = status
    user.current_period_end = Billing.period_end(subscription)
    user.cancel_at_period_end = subscription["cancel_at_period_end"] == true
    user.stripe_subscription_id = subscription["id"].to_s
    user.plan_interval = Billing.interval_of(subscription)
    user.plan_gift = false
    customer = Billing.id_of(subscription["customer"])
    user.stripe_customer_id = customer unless customer.blank?
    user.update()
    "processed"
  end

  # The subscription over: Free again. One that is not the account's
  # (an older one, replaced) changes nothing.
  static def ended(subscription, user)
    return "ignored" if Billing.other_subscription?(user, subscription["id"])
    # Pro offered by an admin (#399) is not a subscription's to end.
    return "ignored" if user.plan_gift == true

    user.plan = "free"
    user.plan_status = "canceled"
    user.cancel_at_period_end = false
    user.stripe_subscription_id = nil
    user.update()
    "processed"
  end

  # A payment refused: the status says so (Pro stops until it is paid:
  # User#pro?), and the portal is where the card is changed.
  static def payment_failed(invoice, user)
    subscription = Billing.invoice_subscription(invoice)
    return "ignored" if subscription.blank? || Billing.other_subscription?(user, subscription)

    user.plan_status = "past_due"
    user.update()
    "processed"
  end

  # Whether `subscription_id` is not the one the account holds.
  static def other_subscription?(user, subscription_id)
    user.stripe_subscription_id.present? && user.stripe_subscription_id != subscription_id.to_s
  end

  static def pro_subscription?(subscription)
    return true if (subscription["metadata"] ?? {})["plan"] == "pro"

    Stripe.pro_price?(Billing.price_of(subscription))
  end

  # The Price of a subscription's first item.
  static def price_of(subscription)
    items = (subscription["items"] ?? {})["data"] ?? []
    return "" if items.length == 0

    Billing.id_of(items[0]["price"])
  end

  # How often a subscription is paid: "annual" when its first item's
  # Price recurs yearly, else "monthly". The admin's revenue reads it.
  static def interval_of(subscription)
    items = (subscription["items"] ?? {})["data"] ?? []
    return "monthly" if items.length == 0

    price = items[0]["price"]
    return "monthly" unless price.is_a?("hash")

    (price["recurring"] ?? {})["interval"] == "year" ? "annual" : "monthly"
  end

  # When the period paid for ends: on the subscription, or (Stripe's newer
  # API versions) on its first item.
  static def period_end(subscription)
    return subscription["current_period_end"] unless subscription["current_period_end"].nil?

    items = (subscription["items"] ?? {})["data"] ?? []
    return nil if items.length == 0

    items[0]["current_period_end"]
  end

  # An invoice's subscription: on the invoice, or (newer API versions) in
  # its parent's details.
  static def invoice_subscription(invoice)
    direct = Billing.id_of(invoice["subscription"])
    return direct unless direct.blank?

    details = (invoice["parent"] ?? {})["subscription_details"] ?? {}
    Billing.id_of(details["subscription"])
  end
end
