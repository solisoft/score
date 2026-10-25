# Push notifications (#400): what the app tells someone (UserNotification)
# sent to the devices they turned them on for (PushSubscription), as their
# settings allow (User#pushes?). Each notification is sent by
# PushNotificationJob, right after it is made; the service worker
# (public/sw.js) shows it and opens it when clicked.
#
# The environment (none of it set: the account page says push is not set
# up, and nothing is sent):
#   VAPID_PUBLIC_KEY   the application server's public key (base64url)
#   VAPID_PRIVATE_KEY  its private key (base64url), never shown
#   VAPID_SUBJECT      how a push service reaches the site (mailto: or
#                      https:); the site's address when not set
# The prod-db workflow's `push` action makes the keys on the server.
#
# As CLAUDE.md's "Trap 3" says: each setting is read by one method of one
# line, and each message goes through a `transport`, fn(subscription,
# payload) answering {"status"}: `WebPush.http` in the app, a stand-in in
# the specs, which never reach the network.
const WEB_PUSH_TTL = 86400
# Tries a device may fail in a row (not "gone") before it is let go.
const WEB_PUSH_FAILURES_MAX = 5

class WebPush
  static def public_key
    getenv("VAPID_PUBLIC_KEY").to_s
  end

  static def private_key
    getenv("VAPID_PRIVATE_KEY").to_s
  end

  static def subject
    getenv("VAPID_SUBJECT").present? ? getenv("VAPID_SUBJECT").to_s : auth_base_url()
  end

  # Whether push can be sent: both keys set.
  static def configured?
    WebPush.public_key.present? && WebPush.private_key.present?
  end

  # `notification` handed to PushNotificationJob, when push is set up and
  # its person has a device: whether it was.
  static def queue(notification)
    return false if notification.nil? || !WebPush.configured?
    return false if PushSubscription.where({"user_id": notification.user_id}).count == 0

    PushNotificationJob.perform_later({"notification_id": notification._key}, {"max_retries": 0})
    true
  end

  # The notification whose key is `key` sent to its person's devices.
  # Answers {"sent", "gone", "failed", "off"}: devices, and "off" 1 when it
  # was not sent at all (the notification or its person gone, the kind
  # turned off, read already).
  static def deliver_key(key, transport = nil)
    notification = UserNotification.find_by("_key", key.to_s)
    return WebPush.counts(1) if notification.nil?

    WebPush.deliver(notification, transport)
  end

  static def deliver(notification, transport = nil)
    user = User.find_by("_key", notification.user_id)
    return WebPush.counts(1) if user.nil? || !user.pushes?(notification.kind) || notification.read?

    payload = WebPush.payload(notification).to_json
    done = WebPush.counts(0)
    PushSubscription.of(user).each do |device|
      outcome = WebPush.outcome(WebPush.call(device.subscription, payload, transport))
      WebPush.after(device, outcome)
      done[outcome] = done[outcome] + 1
    end
    done
  end

  static def counts(off)
    {
      "sent": 0,
      "gone": 0,
      "failed": 0,
      "off": off
    }
  end

  # What a push service's `answer` means: "sent", "gone" (the device
  # unsubscribed: 404, 410) or "failed".
  static def outcome(answer)
    status = (answer ?? {})["status"].to_s.to_i
    return "sent" if status >= 200 && status < 300
    return "gone" if [404, 410].includes?(status)

    "failed"
  end

  # `device` after a message's `outcome`: deleted when gone, or after
  # WEB_PUSH_FAILURES_MAX failures in a row; its count reset when sent.
  static def after(device, outcome)
    return device.delete if outcome == "gone"

    device.failures = outcome == "sent" ? 0 : (device.failures ?? 0) + 1
    device.last_sent_at = DateTime.utc.to_unix if outcome == "sent"
    return device.delete if device.failures >= WEB_PUSH_FAILURES_MAX

    device.save
  end

  # What the service worker shows: a title, the sentence, where a click
  # goes (the notification's own page, which marks it read), and a tag so
  # one notification is shown once.
  static def payload(notification)
    body = notification.sentence
    body = body + ": " + notification.excerpt unless notification.excerpt.blank?
    {
      "title": "EUI Score",
      "body": body,
      "url": "/app/notifications/#{notification._key}/open",
      "tag": "notification-#{notification._key}"
    }
  end

  # A test message to each of `user`'s devices: the counts.
  static def test(user, transport = nil)
    payload = {
      "title": "EUI Score",
      "body": "Push notifications work on this device.",
      "url": "/app/account#push",
      "tag": "test"
    }.to_json
    done = WebPush.counts(0)
    PushSubscription.of(user).each do |device|
      outcome = WebPush.outcome(WebPush.call(device.subscription, payload, transport))
      WebPush.after(device, outcome)
      done[outcome] = done[outcome] + 1
    end
    done
  end

  # `payload` to `subscription`, by `transport` (WebPush.http when nil).
  static def call(subscription, payload, transport = nil)
    send_with = transport ?? fn(device, text) { WebPush.http(device, text) }
    send_with(subscription, payload)
  end

  # The message itself, signed and encrypted (RFC 8291, 8292): {"status"},
  # or nil when the push service could not be reached.
  static def http(subscription, payload)
    vapid_send(subscription, payload, WebPush.private_key, WebPush.public_key, WebPush.subject, {
      "ttl": WEB_PUSH_TTL,
      "urgency": "normal"
    }) rescue nil
  end
end
