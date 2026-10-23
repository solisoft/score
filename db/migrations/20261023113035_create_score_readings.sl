# Migration: create_score_readings — photos of scores being read by Claude
# (ScoreReading), counted per person per day.

def up(db)
  db.create_collection("score_readings")
  db.create_index("score_readings", "idx_score_readings_user", ["user_id", "created_at"], {})
end

def down(db)
  db.drop_collection("score_readings")
end
