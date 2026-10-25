# Migration: create_push_subscriptions — the devices a person turned push
# notifications on for (#400): one row a browser's subscription, its
# endpoint unique (a browser that subscribes again replaces its row).

def up(db)
  db.create_collection("push_subscriptions")
  db.create_index("push_subscriptions", "idx_push_subscriptions_endpoint", ["endpoint"], {"unique": true})
  db.create_index("push_subscriptions", "idx_push_subscriptions_user", ["user_id"], {})
end

def down(db)
  db.drop_collection("push_subscriptions")
end
