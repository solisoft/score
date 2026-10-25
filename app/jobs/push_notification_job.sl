# One notification (#400) sent to its person's devices, right after it is
# made (WebPush.queue): each device that is gone is let go. Answers the
# counts (WebPush.deliver).
class PushNotificationJob
  static def perform(args: Hash)
    WebPush.deliver_key(args["notification_id"])
  end
end
