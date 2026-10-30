# Migration: create_shared_sections — the shared library of sections
# (#444): bars of a score its author publishes for everyone (SharedSection),
# the stars each person gives one (SectionRating, one each), what people say
# of it (SectionComment), and what they report to the admins (SectionReport).

def up(db)
  db.create_collection("shared_sections")
  db.create_index("shared_sections", "idx_shared_sections_listed", ["hidden", "created_at"], {})
  db.create_index("shared_sections", "idx_shared_sections_user", ["user_id", "created_at"], {})
  db.create_collection("section_ratings")
  db.create_index("section_ratings", "idx_section_ratings_one", ["section_id", "user_id"], {"unique": true})
  db.create_collection("section_comments")
  db.create_index("section_comments", "idx_section_comments_section", ["section_id", "created_at"], {})
  db.create_index("section_comments", "idx_section_comments_user", ["user_id", "created_at"], {})
  db.create_collection("section_reports")
  db.create_index("section_reports", "idx_section_reports_open", ["resolved_at", "created_at"], {})
  db.create_index("section_reports", "idx_section_reports_user", ["user_id", "created_at"], {})
end

def down(db)
  db.drop_collection("section_reports")
  db.drop_collection("section_comments")
  db.drop_collection("section_ratings")
  db.drop_collection("shared_sections")
end
