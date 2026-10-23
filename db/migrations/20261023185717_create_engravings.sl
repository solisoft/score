# Migration: create_engravings — the server's engravings kept a few days
# (Engraving), so the same score at the same size is engraved once.

def up(db)
  db.create_collection("engravings")
  db.create_index("engravings", "idx_engravings_created_at", ["created_at"], {})
end

def down(db)
  db.drop_collection("engravings")
end
