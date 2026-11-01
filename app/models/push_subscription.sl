# A device a person turned push notifications on for (#400): the browser's
# subscription, as `PushSubscription.toJSON()` gives it — the push
# service's `endpoint`, and the keys its messages are encrypted with
# (`p256dh`, `auth`). One row an endpoint (a unique index): a browser that
# subscribes again, maybe signed in as someone else, takes the row over.
# WebPush sends to them; one the push service says is gone is deleted.
const PUSH_KEY_PATTERN = "^[A-Za-z0-9_-]+={0,2}$"
const PUSH_DEVICES_MAX = 20
# The push services browsers subscribe through (#543): an endpoint on any
# other host is refused, so the app never posts to an address a person
# chose. Chrome, Opera, Brave and Samsung Internet use Google's FCM;
# Firefox, Mozilla's autopush; Safari, Apple's; Edge on Windows,
# Microsoft's WNS. A host here, or one under a domain below. A row kept
# before this check, on any other host, is deleted (prune_unreachable),
# never counted.
const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com"
]
const PUSH_SERVICE_DOMAINS = ["push.services.mozilla.com", "notify.windows.com"]

class PushSubscription < Model
  validates("user_id", {"presence": true})
  validates(
    "endpoint",
    {"presence": true, "max_length": 1000}
  )
  validates(
    "p256dh",
    {
      "presence": true,
      "format": PUSH_KEY_PATTERN,
      "max_length": 200
    }
  )
  validates(
    "auth",
    {
      "presence": true,
      "format": PUSH_KEY_PATTERN,
      "max_length": 100
    }
  )

  # `raw` (the browser's subscription) kept for `user`, from a browser
  # named `label`: {"subscription"}, or {"error"} saying why not.
  static def keep(user, raw, label)
    data = raw.is_a?("hash") ? raw : {}
    keys = data["keys"].is_a?("hash") ? data["keys"] : {}
    endpoint = data["endpoint"].to_s.trim
    return {"error": "This is not a push subscription."} unless PushSubscription.push_service?(endpoint)
    if keys["p256dh"].to_s.blank? || keys["auth"].to_s.blank?
      return {"error": "This is not a push subscription."}
    end

    existing = PushSubscription.find_by("endpoint", endpoint)
    if existing.nil? && PushSubscription.count_of(user) >= PUSH_DEVICES_MAX
      return {"error": "Push notifications are on for #{PUSH_DEVICES_MAX} devices already: turn one off first."}
    end

    row = existing ?? PushSubscription.new()
    row.user_id = user._key
    row.endpoint = endpoint
    row.p256dh = keys["p256dh"].to_s
    row.auth = keys["auth"].to_s
    row.label = label.to_s.substring(0, 120)
    row.created_at ||= DateTime.utc.to_unix
    row.failures = 0
    row.save
    return {"error": "This is not a push subscription."} if row._errors && row._errors.length > 0

    {"subscription": row}
  end

  # `user`'s subscription at `endpoint` deleted: whether there was one.
  static def forget(user, endpoint)
    row = PushSubscription.where({
      "user_id": user._key,
      "endpoint": endpoint.to_s
    }).first
    return false if row.nil?

    row.delete
    true
  end

  # Whether `endpoint` is an https:// address on a browser's push service
  # (PUSH_SERVICE_HOSTS, PUSH_SERVICE_DOMAINS): its host plain letters,
  # digits, dots and dashes (no port, no user), then a path.
  static def push_service?(endpoint)
    text = endpoint.to_s
    return false unless Regex.matches("^https://[a-z0-9.-]+/", text)

    host = text.substring(8, text.length).split("/")[0]
    return true if PUSH_SERVICE_HOSTS.includes?(host)

    PUSH_SERVICE_DOMAINS.any? do |domain|
      host.ends_with?(".#{domain}")
    end
  end

  # The devices of `user`: those on a push service, at most
  # PUSH_DEVICES_MAX (a row kept before #543 checked the host is not one).
  static def of(user)
    PushSubscription.of_key(user._key)
  end

  # The devices of the person whose key is `key`.
  static def of_key(key)
    PushSubscription.reachable(PushSubscription.where({"user_id": key}).all).slice(0, PUSH_DEVICES_MAX)
  end

  # The devices of `user` counted: on a push service only.
  static def count_of(user)
    PushSubscription.of(user).length
  end

  # Those of `rows` on a push service.
  static def reachable(rows)
    rows.filter do |device|
      PushSubscription.push_service?(device.endpoint)
    end
  end

  # `user`'s rows on a host that is not a push service deleted: how many.
  static def prune_unreachable(user)
    PushSubscription.prune(PushSubscription.where({"user_id": user._key}).all)
  end

  # Everyone's rows on a host that is not a push service deleted (the
  # migration prune_unreachable_push_subscriptions): how many.
  static def prune_unreachable_all
    PushSubscription.prune(PushSubscription.all)
  end

  static def prune(rows)
    stray = rows.filter do |device|
      !PushSubscription.push_service?(device.endpoint)
    end
    stray.each do |device|
      device.delete
    end
    stray.length
  end

  # Gone with their account (User#destroy_account).
  static def delete_all_of(user)
    PushSubscription.where({"user_id": user._key}).delete_all
  end

  # The subscription as `vapid_send` takes it.
  def subscription
    {"endpoint": @endpoint, "keys": {
      "p256dh": @p256dh,
      "auth": @auth
    }}
  end
end
