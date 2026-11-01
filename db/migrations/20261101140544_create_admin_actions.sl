# Migration: create_admin_actions — what the admins did (#544): each change
# made from the admin section (Pro offered or taken back, signing in
# unlocked, an address confirmed, a report acted on), by whom, to what, when.
# Read by target (one customer's page) and newest first (the whole list).

def up(db)
  db.create_collection("admin_actions")
  db.create_index("admin_actions", "idx_admin_actions_target", ["target_id", "at"], {})
  db.create_index("admin_actions", "idx_admin_actions_at", ["at"], {})
end

def down(db)
  db.drop_collection("admin_actions")
end
