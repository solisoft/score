# Migration: create_scores — the app's library (Score): one document per
# score, its owner's key in user_id.

def up(db)
  db.create_collection("scores")
  db.create_index("scores", "idx_scores_user", ["user_id", "trashed_at"], {})
end

def down(db)
  db.drop_collection("scores")
end
