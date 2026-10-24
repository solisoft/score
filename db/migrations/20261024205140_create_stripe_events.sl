# Migration: create_stripe_events — paid plans (#393). The ids of the Stripe
# events already handled (StripeEvent), unique, so a replayed event does
# nothing; and the users found by their Stripe customer, as the webhook
# finds them.

def up(db)
  db.create_collection("stripe_events")
  db.create_index("stripe_events", "idx_stripe_events_event", ["event_id"], {"unique": true})
  db.create_index("users", "idx_users_stripe_customer", ["stripe_customer_id"], {})
end

def down(db)
  db.drop_index("users", "idx_users_stripe_customer")
  db.drop_collection("stripe_events")
end
