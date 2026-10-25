# Push notifications on a device (#400), asked by the account page's
# script: the browser's subscription kept, or let go, and a test message.
# JSON in and out. Behind `require_login`; the CSRF token comes in the
# X-CSRF-Token header.
class AppPushController < AppBaseController
  # POST /app/push/subscriptions — the browser's subscription (its
  # `toJSON()`): 201, or 422 saying why not
  def create
    return render_json({"error": "Push notifications are not set up on this server."}, 503) unless WebPush.configured?

    headers = req["headers"] ?? {}
    kept = PushSubscription.keep(current_user(), req["json"], headers["user-agent"])
    return render_json({"error": kept["error"]}, 422) unless kept["error"].nil?

    render_json({"devices": PushSubscription.count_of(current_user())}, 201)
  end

  # POST /app/push/subscriptions/remove — `endpoint`: this device let go
  def destroy
    endpoint = (req["json"] ?? {})["endpoint"]
    forgotten = PushSubscription.forget(current_user(), endpoint)
    render_json({"removed": forgotten, "devices": PushSubscription.count_of(current_user())})
  end

  # POST /app/push/test — a message to each of one's devices
  def test
    render_json(WebPush.test(current_user()))
  end
end
