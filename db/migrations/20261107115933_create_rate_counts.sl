# Migration: create_rate_counts — what a sender asked for in a window
# (#684, RateCount): the engravings an account or an address has had made,
# the photos it sent to be read, counted in the database so that both
# workers and both deploy slots count together and a restart forgets none.
# One row a sender and a kind; the nightly DataCleanupJob lets those past
# their window go (expires_at).

def up(db)
  db.create_collection("rate_counts")
  db.create_index("rate_counts", "idx_rate_counts_expires", ["expires_at"], {})
end

def down(db)
  db.drop_collection("rate_counts")
end
