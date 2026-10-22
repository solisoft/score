# Migration: create_score_versions — the history of each score (ScoreVersion).

def up(db)
  db.create_collection("score_versions")
  db.create_index("score_versions", "idx_score_versions_score", ["score_id", "created_at"], {})
end

def down(db)
  db.drop_collection("score_versions")
end
