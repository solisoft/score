# A test message (#400) to a person's devices, asked for on the account
# page: sent here, out of the request, so no request waits on a push
# service (#543). Answers the counts (WebPush.test_key).
class PushTestJob
  static def perform(args: Hash)
    WebPush.test_key(args["user_id"])
  end
end
