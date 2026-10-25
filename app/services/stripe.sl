# Stripe, for the Pro plan (#393): the settings read from the environment,
# the requests made of Stripe's API, and the check of a webhook's
# signature. What the answers mean for an account is Billing's.
#
# The environment (none of it set: the site works as before, the plans are
# shown, and Upgrade says payments are not open yet):
#   STRIPE_SECRET_KEY         the API key (sk_…)
#   STRIPE_WEBHOOK_SECRET     the webhook endpoint's signing secret (whsec_…)
#   STRIPE_PRICE_PRO_MONTHLY  the Price of Pro paid monthly (price_…)
#   STRIPE_PRICE_PRO_ANNUAL   the Price of Pro paid yearly (price_…)
# No publishable key: the browser only follows Stripe's own pages (Checkout,
# the customer portal), so Stripe.js is not needed.
#
# As CLAUDE.md's "Trap 3" says: each setting is read by one method of one
# line, and every request goes through a `transport`, fn(method, path, body)
# answering {"status", "body"}: `Stripe.http` in the app, a stand-in in the
# specs, which never reach the network.
const STRIPE_API = "https://api.stripe.com/v1/"
# How old a webhook's signature may be, in seconds, either way.
const STRIPE_SIGNATURE_TOLERANCE = 300

class Stripe
  static def secret_key
    getenv("STRIPE_SECRET_KEY").to_s
  end

  static def webhook_secret
    getenv("STRIPE_WEBHOOK_SECRET").to_s
  end

  # The Price of Pro paid every `interval` ("monthly", "annual").
  static def price_id(interval)
    Stripe.price_in(interval, getenv("STRIPE_PRICE_PRO_MONTHLY").to_s, getenv("STRIPE_PRICE_PRO_ANNUAL").to_s)
  end

  static def price_in(interval, monthly, annual)
    Plan.interval(interval) == "annual" ? annual : monthly
  end

  # Whether payments are open: a key, and both Prices.
  static def configured?
    Stripe.open_with?(Stripe.secret_key, Stripe.price_id("monthly"), Stripe.price_id("annual"))
  end

  static def open_with?(key, monthly, annual)
    key.present? && monthly.present? && annual.present?
  end

  # Stripe's dashboard at `path` ("customers/cus_…"), in the mode the key
  # is in: live, or test (the admin section's links, #399).
  static def dashboard_url(path)
    Stripe.dashboard_in(path, Stripe.secret_key)
  end

  static def dashboard_in(path, key)
    mode = key.to_s.starts_with?("sk_live") || key.to_s.starts_with?("rk_live") ? "" : "test/"
    "https://dashboard.stripe.com/#{mode}#{path}"
  end

  # Whether `price_id` is one of Pro's (either interval).
  static def pro_price?(price_id)
    return false if price_id.blank?

    [Stripe.price_id("monthly"), Stripe.price_id("annual")].includes?(price_id)
  end

  # The request `method` `path` with the form `body`, made by `transport`
  # (Stripe.http when nil): {"ok": true, "data"} or {"ok": false, "error"}.
  static def call(method, path, body, transport = nil)
    request_with = transport ?? fn(verb, where, form) { Stripe.http(verb, where, form) }
    answer = request_with(method, path, body)
    if answer.nil?
      return {"ok": false, "error": "unreachable"}
    end

    Stripe.parsed(answer["status"] ?? 0, answer["body"].to_s)
  end

  # The request itself, to api.stripe.com with the secret key: the response
  # ({"status", "body"}), or nil when Stripe could not be reached.
  static def http(method, path, body)
    headers = {
      "Authorization": "Bearer #{Stripe.secret_key}",
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2024-06-20"
    }
    HTTP.request(method, STRIPE_API + path, headers, body) rescue nil
  end

  # A response's status and text as {"ok": true, "data"}, or {"ok": false,
  # "error"}: Stripe's own message when it gave one.
  static def parsed(status, raw)
    data = json_parse(raw) rescue nil
    if status < 200 || status >= 300
      message = data.is_a?("hash") ? (data["error"] ?? {})["message"] : nil
      return {"ok": false, "error": message ?? "Stripe answered #{status}"}
    end

    unless data.is_a?("hash")
      return {"ok": false, "error": "Stripe's answer was not JSON"}
    end

    {"ok": true, "data": data}
  end

  # A form body from `fields` (each key and value encoded), in order.
  static def form(fields)
    fields.keys.map do |key|
      "#{url_encode(key)}=#{url_encode(fields[key].to_s)}"
    end.join("&")
  end

  # The Checkout session that subscribes `customer_id` to `price_id`: the
  # user's key on the session and on the subscription, so every event
  # finds them.
  static def checkout_form(customer_id, price_id, user_key, interval, success_url, cancel_url)
    Stripe.form({
      "mode": "subscription",
      "customer": customer_id,
      "client_reference_id": user_key,
      "line_items[0][price]": price_id,
      "line_items[0][quantity]": 1,
      "success_url": success_url,
      "cancel_url": cancel_url,
      "allow_promotion_codes": "true",
      "metadata[user_key]": user_key,
      "metadata[plan]": "pro",
      "metadata[interval]": interval,
      "subscription_data[metadata][user_key]": user_key,
      "subscription_data[metadata][plan]": "pro",
      "subscription_data[metadata][app]": "score"
    })
  end

  # A new Stripe customer for `user`.
  static def customer_form(user)
    Stripe.form({
      "email": user.email,
      "name": user.name.to_s,
      "metadata[user_key]": user._key,
      "metadata[app]": "score"
    })
  end

  # Whether `header` (Stripe-Signature: t=<seconds>,v1=<hex>[,v1=…]) signs
  # `payload` with `secret`: HMAC-SHA256 of "t.payload", made within
  # STRIPE_SIGNATURE_TOLERANCE seconds of `now`, compared in constant time.
  static def signed?(payload, header, secret, now)
    return false if secret.blank? || header.blank? || payload.nil?

    stamp = ""
    signatures = []
    header.to_s.split(",").each do |part|
      pair = part.trim
      cut = pair.index_of("=")
      unless cut < 1
        name = pair.substring(0, cut)
        value = pair.substring(cut + 1, pair.length)
        stamp = value if name == "t"
        signatures.push(value) if name == "v1"
      end
    end
    return false unless Regex.matches("^[0-9]{1,12}$", stamp)
    return false if signatures.length == 0

    age = now - stamp.to_i
    return false if age > STRIPE_SIGNATURE_TOLERANCE || age < -STRIPE_SIGNATURE_TOLERANCE

    expected = Crypto.hmac("#{stamp}.#{payload}", secret)
    signatures.any? do |signature|
      Crypto.secure_compare(expected, signature)
    end
  end

  # The header Stripe would send for `payload` signed with `secret` at
  # `stamp`: what the specs (and a hand test) sign with.
  static def signature_for(payload, secret, stamp)
    mac = Crypto.hmac("#{stamp}.#{payload}", secret)
    "t=#{stamp},v1=#{mac}"
  end
end
