# A device a person turned push notifications on for (#400): the browser's
# subscription, as `PushSubscription.toJSON()` gives it — the push
# service's `endpoint`, and the keys its messages are encrypted with
# (`p256dh`, `auth`). One row an endpoint (a unique index): a browser that
# subscribes again, maybe signed in as someone else, takes the row over.
# WebPush sends to them; one the push service says is gone is deleted.
const PUSH_KEY_PATTERN = "^[A-Za-z0-9_-]+={0,2}$"
const PUSH_DEVICES_MAX = 20

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
    return {"error": "This is not a push subscription."} unless endpoint.starts_with?("https://")
    if keys["p256dh"].to_s.blank? || keys["auth"].to_s.blank?
      return {"error": "This is not a push subscription."}
    end

    existing = PushSubscription.find_by("endpoint", endpoint)
    if existing.nil? && PushSubscription.where({"user_id": user._key}).count >= PUSH_DEVICES_MAX
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

  # The devices of `user`.
  static def of(user)
    PushSubscription.where({"user_id": user._key}).limit(PUSH_DEVICES_MAX).all
  end

  static def count_of(user)
    PushSubscription.where({"user_id": user._key}).count
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
