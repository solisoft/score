# Migration: create_score_takes — the audio recorded from the microphone
# onto a score's audio tracks (#390): one take per track (ScoreTake), its
# sound a WAV in SoliDB's blob store.

def up(db)
  db.create_collection("score_takes")
  db.create_index("score_takes", "idx_score_takes_score", ["score_id", "track"], {})
  db.create_collection("score_take_audio", "blob")
end

def down(db)
  db.drop_collection("score_take_audio")
  db.drop_collection("score_takes")
end
