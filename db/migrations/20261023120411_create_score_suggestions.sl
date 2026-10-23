# Migration: create_score_suggestions — the editor's AI assistant at work on
# a score (ScoreSuggestion), counted per person per day.

def up(db)
  db.create_collection("score_suggestions")
  db.create_index("score_suggestions", "idx_score_suggestions_user", ["user_id", "created_at"], {})
end

def down(db)
  db.drop_collection("score_suggestions")
end
