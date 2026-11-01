# Push notifications (#400): a device's subscription kept for its person
# (JSON, signed in, a real-looking subscription only), taken over by
# whoever subscribes it again, let go by its own person only; the kinds
# chosen in the account; each notification sent to the devices as those
# allow, through a stand-in transport — a device the push service says is
# gone is deleted, one that keeps failing too. No VAPID key is set where
# the specs run: the account says push is not available, and nothing is
# queued.

const PUSH_SPEC_PASSWORD = "correct horse battery"

def push_spec_user
  user = User.new()
  user.email = "push-spec-#{uuid_v4}@example.com"
  user.set_password(PUSH_SPEC_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  User.find(user._key)
end

def push_spec_sign_in(user)
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": PUSH_SPEC_PASSWORD}
  )
end

def push_spec_raw(name = nil)
  {"endpoint": "https://fcm.googleapis.com/fcm/send/#{name ?? uuid_v4}", "keys": {
    "p256dh": "BC4Qx_y-z0123456789",
    "auth": "qZQ-abc_123"
  }}
end

# A subscription to `endpoint`, as a browser would send it.
def push_spec_raw_at(endpoint)
  {"endpoint": endpoint, "keys": {
    "p256dh": "BC4Qx_y-z0123456789",
    "auth": "qZQ-abc_123"
  }}
end

# The rows of the job queue for `job` naming `key` in its arguments.
def push_spec_jobs(job, key)
  Job.list().filter do |row|
    row.to_json.contains(job) && row.to_json.contains(key)
  end
end

def push_spec_device(user, name = nil)
  PushSubscription.keep(user, push_spec_raw(name), "Spec browser")["subscription"]
end

# A transport answering `status` to every message, noting each endpoint.
def push_spec_transport(status, sent)
  transport = fn(subscription, payload) {
    sent.push({"endpoint": subscription["endpoint"], "payload": payload})
    status.nil? ? nil : {"status": status, "body": ""}
  }
  transport
end

def push_spec_notification(user, kind = "reply")
  UserNotification.create({
    "user_id": user._key,
    "kind": kind,
    "score_id": "score-#{uuid_v4}",
    "score_title": "Nocturne",
    "actor_ids": ["someone"],
    "actor_names": ["Clara"],
    "label": "bar 4",
    "excerpt": "Lovely phrase",
    "created_at": DateTime.utc.to_unix,
    "read_at": nil,
    "mail": "pending",
    "mail_tries": 0
  })
end

describe("Push notifications") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  describe("the devices") do
    test("a subscription is kept for its person, once an endpoint") do
      user = push_spec_user()
      kept = PushSubscription.keep(user, push_spec_raw("one"), "Firefox")
      assert(kept["error"].nil?)
      assert_eq(PushSubscription.count_of(user), 1)
      again = PushSubscription.keep(user, push_spec_raw("one"), "Firefox")
      assert(again["error"].nil?)
      assert_eq(PushSubscription.count_of(user), 1)
      device = PushSubscription.of(user)[0]
      assert_eq(device.subscription["keys"]["auth"], "qZQ-abc_123")
      assert_eq(device.label, "Firefox")
    end

    test("refuses what is not a subscription, and keeps nothing") do
      user = push_spec_user()
      assert_contains(PushSubscription.keep(user, nil, "")["error"], "not a push subscription")
      assert_contains(PushSubscription.keep(user, {
        "endpoint": "http://push.example.com/x",
        "keys": {"p256dh": "a", "auth": "b"}
      }, "")["error"], "not a push")
      assert_contains(PushSubscription.keep(user, {
        "endpoint": "https://push.example.com/x",
        "keys": {}
      }, "")["error"], "not a push")
      assert_contains(PushSubscription.keep(user, {
        "endpoint": "https://push.example.com/x",
        "keys": {"p256dh": "no spaces allowed", "auth": "b"}
      }, "")["error"], "not a push")
      assert_eq(PushSubscription.count_of(user), 0)
    end

    test("refuses an endpoint on a host that is not a browser's push service, and keeps nothing") do
      user = push_spec_user()
      [
        "https://evil.example/push",
        "https://evil.example/fcm.googleapis.com/x",
        "https://fcm.googleapis.com.evil.example/x",
        "https://fcm.googleapis.com@evil.example/x",
        "https://fcm.googleapis.com:8443/x",
        "https://evilfcm.googleapis.com/x",
        "https://10.0.0.1/x",
        "https://fcm.googleapis.com"
      ].each do |endpoint|
        refused = PushSubscription.keep(user, push_spec_raw_at(endpoint), "")
        assert_contains(refused["error"].to_s, "not a push subscription", endpoint)
      end
      assert_eq(PushSubscription.count_of(user), 0)
      assert_eq(PushSubscription.where({"endpoint": "https://evil.example/push"}).count, 0)
    end

    test("keeps an endpoint on each browser's push service") do
      user = push_spec_user()
      [
        "https://fcm.googleapis.com/fcm/send/abc",
        "https://updates.push.services.mozilla.com/wpush/v2/abc",
        "https://web.push.apple.com/QGx",
        "https://wns2-par02p.notify.windows.com/w/?token=abc"
      ].each do |endpoint|
        kept = PushSubscription.keep(user, push_spec_raw_at("#{endpoint}#{user._key}"), "")
        assert(kept["error"].nil?, endpoint)
      end
      assert_eq(PushSubscription.count_of(user), 4)
    end

    test("someone else subscribing the same browser takes it over; one forgets only their own") do
      first = push_spec_user()
      second = push_spec_user()
      push_spec_device(first, "shared-browser")
      push_spec_device(second, "shared-browser")
      assert_eq(PushSubscription.count_of(first), 0)
      assert_eq(PushSubscription.count_of(second), 1)
      endpoint = push_spec_raw("shared-browser")["endpoint"]
      assert_not(PushSubscription.forget(first, endpoint))
      assert_eq(PushSubscription.count_of(second), 1)
      assert(PushSubscription.forget(second, endpoint))
      assert_eq(PushSubscription.count_of(second), 0)
    end

    test("a person has at most PUSH_DEVICES_MAX devices") do
      user = push_spec_user()
      (0 .. PUSH_DEVICES_MAX).each do |i|
        push_spec_device(user, "max-#{user._key}-#{i}")
      end
      assert_eq(PushSubscription.count_of(user), PUSH_DEVICES_MAX)
      refused = PushSubscription.keep(user, push_spec_raw("one-more-#{user._key}"), "")
      assert_contains(refused["error"], "#{PUSH_DEVICES_MAX} devices already")
    end

    test("go with the account") do
      user = push_spec_user()
      push_spec_device(user)
      user.erase_account
      assert_eq(PushSubscription.where({"user_id": user._key}).count, 0)
    end
  end

  describe("over HTTP") do
    test("a guest is refused, and nothing is kept") do
      set_header("Content-Type", "application/json")
      set_header("Accept", "application/json")
      response = post("/app/push/subscriptions", push_spec_raw("guest").to_json)
      assert_eq(res_status(response), 401)
      assert_eq(PushSubscription.where({"endpoint": push_spec_raw("guest")["endpoint"]}).count, 0)
    end

    test("without VAPID keys, subscribing answers 503, and the account says push is not available") do
      user = push_spec_user()
      push_spec_sign_in(user)
      page = res_body(get("/app/account"))
      assert_contains(page, "id=\"push\"")
      assert_contains(page, "data-push-unavailable")
      assert_not(page.contains("data-push-script"))
      set_header("Content-Type", "application/json")
      set_header("Accept", "application/json")
      response = post("/app/push/subscriptions", push_spec_raw().to_json)
      assert_eq(res_status(response), 503)
      assert_eq(PushSubscription.count_of(user), 0)
    end

    test("forgets this device's subscription, and only its own person's") do
      owner = push_spec_user()
      other = push_spec_user()
      device = push_spec_device(owner)
      push_spec_sign_in(other)
      set_header("Content-Type", "application/json")
      set_header("Accept", "application/json")
      answer = post("/app/push/subscriptions/remove", {"endpoint": device.endpoint}.to_json)
      assert_eq(res_status(answer), 200)
      assert_contains(res_body(answer), "\"removed\":false")
      assert_eq(PushSubscription.count_of(owner), 1)

      clear_headers()
      push_spec_sign_in(owner)
      set_header("Content-Type", "application/json")
      set_header("Accept", "application/json")
      mine = post("/app/push/subscriptions/remove", {"endpoint": device.endpoint}.to_json)
      assert_contains(res_body(mine), "\"removed\":true")
      assert_eq(PushSubscription.count_of(owner), 0)
    end

    test("a test with no device queues nothing") do
      user = push_spec_user()
      push_spec_sign_in(user)
      set_header("Accept", "application/json")
      answer = post("/app/push/test", {})
      assert_eq(res_status(answer), 200)
      assert_eq(res_json(answer)["devices"], 0)
      assert_eq(res_json(answer)["queued"], false)
      assert_eq(push_spec_jobs("PushTestJob", user._key).length, 0)
    end

    test("a test is queued for a job and answered at once: no push service is called in the request") do
      user = push_spec_user()
      device = push_spec_device(user)
      push_spec_sign_in(user)
      set_header("Accept", "application/json")
      answer = post("/app/push/test", {})
      assert_eq(res_status(answer), 200)
      assert_eq(res_json(answer)["devices"], 1)
      assert_eq(res_json(answer)["queued"], true)
      assert_eq(push_spec_jobs("PushTestJob", user._key).length, 1)
      # A send would have counted a failure (no VAPID key here) or a success.
      stored = PushSubscription.find(device._key)
      assert_eq(stored.failures, 0)
      assert_null(stored.last_sent_at)
    end

    test("tests are limited to PUSH_TESTS_PER_HOUR an hour, each person their own") do
      user = push_spec_user()
      push_spec_device(user)
      push_spec_sign_in(user)
      set_header("Accept", "application/json")
      (0 .. PUSH_TESTS_PER_HOUR).each do |i|
        assert_eq(res_status(post("/app/push/test", {})), 200)
      end
      refused = post("/app/push/test", {})
      assert_eq(res_status(refused), 429)
      assert_contains(res_json(refused)["error"], "Too many test messages")
      assert_eq(push_spec_jobs("PushTestJob", user._key).length, PUSH_TESTS_PER_HOUR)

      other = push_spec_user()
      push_spec_device(other)
      clear_headers()
      push_spec_sign_in(other)
      set_header("Accept", "application/json")
      assert_eq(res_status(post("/app/push/test", {})), 200)
    end

    test("keeps the kinds chosen, the others off") do
      user = push_spec_user()
      assert(user.pushes?("changed"))
      push_spec_sign_in(user)
      response = post("/app/account/push", {"kinds": [
        "reply",
        "mention",
        "nonsense"
      ]})
      assert_contains(res_location(response), "#push")
      again = User.find(user._key)
      assert(again.pushes?("reply"))
      assert(again.pushes?("mention"))
      assert_not(again.pushes?("changed"))
      assert_not(again.pushes?("shared"))
      post("/app/account/push", {"kinds": "none"})
      assert_not(User.find(user._key).pushes?("reply"))
    end
  end

  describe("sending") do
    test("a notification goes to each device, with its sentence and its page") do
      user = push_spec_user()
      push_spec_device(user, "a-#{user._key}")
      push_spec_device(user, "b-#{user._key}")
      notification = push_spec_notification(user)
      sent = []
      done = WebPush.deliver(notification, push_spec_transport(201, sent))
      assert_eq(done["sent"], 2)
      assert_eq(sent.length, 2)
      payload = json_parse(sent[0]["payload"])
      assert_contains(payload["body"], "Clara replied in a thread on")
      assert_contains(payload["body"], "Lovely phrase")
      assert_eq(payload["url"], "/app/notifications/#{notification._key}/open")
      assert_eq(payload["tag"], "notification-#{notification._key}")
      assert(PushSubscription.of(user)[0].last_sent_at.present?)
    end

    test("a device the push service says is gone is deleted") do
      user = push_spec_user()
      push_spec_device(user)
      done = WebPush.deliver(push_spec_notification(user), push_spec_transport(410, []))
      assert_eq(done["gone"], 1)
      assert_eq(PushSubscription.count_of(user), 0)
    end

    test("a device that keeps failing is let go after WEB_PUSH_FAILURES_MAX tries") do
      user = push_spec_user()
      push_spec_device(user)
      (1 .. WEB_PUSH_FAILURES_MAX).each do |i|
        WebPush.deliver(push_spec_notification(user), push_spec_transport(500, []))
      end
      assert_eq(PushSubscription.count_of(user), 1)
      unreachable = WebPush.deliver(push_spec_notification(user), push_spec_transport(nil, []))
      assert_eq(unreachable["failed"], 1)
      assert_eq(PushSubscription.count_of(user), 0)
    end

    test("nothing goes for a kind turned off, a read notification, or one that is gone") do
      user = push_spec_user()
      push_spec_device(user)
      user.keep_push_prefs(["mention"])
      sent = []
      off = WebPush.deliver(push_spec_notification(User.find(user._key), "reply"), push_spec_transport(201, sent))
      assert_eq(off["off"], 1)
      read = push_spec_notification(user, "mention")
      read.read!
      assert_eq(WebPush.deliver(read, push_spec_transport(201, sent))["off"], 1)
      assert_eq(WebPush.deliver_key("no-such-notification")["off"], 1)
      assert_eq(PushNotificationJob.perform({"notification_id": "no-such-notification"})["off"], 1)
      assert_eq(sent.length, 0)
    end

    test("a test message goes to each device") do
      user = push_spec_user()
      push_spec_device(user)
      sent = []
      assert_eq(WebPush.test(user, push_spec_transport(201, sent))["sent"], 1)
      assert_contains(sent[0]["payload"], "Push notifications work")
    end

    test("the test job sends nothing without VAPID keys, nor for someone gone") do
      user = push_spec_user()
      device = push_spec_device(user)
      assert_eq(PushTestJob.perform({"user_id": user._key})["off"], 1)
      assert_eq(PushTestJob.perform({"user_id": "no-such-user"})["off"], 1)
      assert_eq(PushSubscription.find(device._key).failures, 0)
    end

    test("a device kept before the push services were checked is skipped, not sent to") do
      user = push_spec_user()
      push_spec_device(user, "good-#{user._key}")
      PushSubscription.create({
        "user_id": user._key,
        "endpoint": "https://evil.example/relay-#{user._key}",
        "p256dh": "BC4Qx_y-z0123456789",
        "auth": "qZQ-abc_123",
        "failures": 0
      })
      assert_eq(PushSubscription.count_of(user), 2)
      sent = []
      done = WebPush.deliver(push_spec_notification(user), push_spec_transport(201, sent))
      assert_eq(done["sent"], 1)
      WebPush.test(user, push_spec_transport(201, sent))
      assert_eq(sent.length, 2)
      sent.each do |message|
        assert(message["endpoint"].starts_with?("https://fcm.googleapis.com/"), message["endpoint"])
      end
    end

    test("without VAPID keys nothing is queued, and the subject falls back to the site") do
      user = push_spec_user()
      push_spec_device(user)
      assert_not(WebPush.configured?)
      assert_not(WebPush.queue(push_spec_notification(user)))
      assert_not(WebPush.queue(nil))
      assert(WebPush.subject.starts_with?("http"))
      assert_eq(WebPush.outcome({"status": 202}), "sent")
      assert_eq(WebPush.outcome({"status": 404}), "gone")
      assert_eq(WebPush.outcome(nil), "failed")
      assert_eq(user.push_setup["key"], "")
      assert_eq(user.push_setup["devices"], 1)
    end
  end
end
