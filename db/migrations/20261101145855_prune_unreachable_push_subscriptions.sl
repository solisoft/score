# Migration: prune_unreachable_push_subscriptions — the push
# subscriptions kept before #543 on a host that is not a browser's push
# service (PushSubscription.push_service?) deleted: none is sent to or
# counted any more, and a new one on such a host is refused.

def up(db)
  gone = PushSubscription.prune_unreachable_all
  print("#{gone} push subscriptions on another host deleted")
end

# What was deleted pointed at addresses a person chose: nothing to put back.
def down(db)
  raise("irreversible: 20261101145855_prune_unreachable_push_subscriptions deletes rows on purpose")
end
