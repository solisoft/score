# Migration: add_score_sharing — who a score is shared with (ScoreShare), and
# the scores' share links (Score#share_token, unique).

def up(db)
  db.create_collection("score_shares")
  db.create_index("score_shares", "idx_score_shares_score", ["score_id"], {})
  db.create_index("score_shares", "idx_score_shares_email", ["email"], {})
  db.create_index("scores", "idx_scores_share_token", ["share_token"], {
    "unique": true,
    "sparse": true
  })
end

def down(db)
  db.drop_index("scores", "idx_scores_share_token")
  db.drop_collection("score_shares")
end
