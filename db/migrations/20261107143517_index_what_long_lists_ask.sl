# Migration: index_what_long_lists_ask — the indexes the queries of a big
# account, a big library and the nightly clean-up ask for and did not have
# (#689): each read that filtered on these fields went through the whole
# collection. And a score is shared with an address once: the shares made
# twice before (two invitations at once) are merged first — the oldest
# kept, with the stronger role (ScoreShare.duplicates_in) — then a unique
# index holds it.
#
# Run again, it changes nothing: an index already there is left as it is.

const INDEXES_689 = [
  ["scores", "idx_scores_trashed", ["trashed_at"], {}],
  ["score_suggestions", "idx_score_suggestions_score", ["score_id"], {}],
  ["score_takes", "idx_score_takes_user", ["user_id"], {}],
  ["score_readings", "idx_score_readings_created", ["created_at"], {}],
  ["users", "idx_users_email_change", ["email_change_digest"], {"sparse": true}],
  ["users", "idx_users_email_changed", ["email_changed_digest"], {"sparse": true}],
  ["score_versions", "idx_score_versions_user", ["user_id"], {}],
  ["score_shares", "idx_score_shares_owner", ["owner_id"], {}],
  ["score_comments", "idx_score_comments_user", ["user_id"], {}],
  ["oauth_codes", "idx_oauth_codes_user", ["user_id"], {}],
  ["access_tokens", "idx_access_tokens_client", ["oauth_client_id"], {"sparse": true}],
  ["section_reports", "idx_section_reports_target", ["target", "target_id"], {}],
  ["score_shares", "idx_score_shares_one", ["score_id", "email"], {"unique": true}]
]

def up(db)
  print("#{_merge_shares_689(db)} shares made twice merged")
  INDEXES_689.each do |index|
    _index_689(db, index[0], index[1], index[2], index[3])
  end
end

def down(db)
  INDEXES_689.each do |index|
    db.drop_index(index[0], index[1]) if _has_index_689(db, index[0], index[1])
  end
end

# The shares made twice merged (ScoreShare.duplicates_in): how many went.
# Through `db`, the database migrated; none on a server that never shared.
def _merge_shares_689(db)
  return 0 unless db.list_collections().includes?("score_shares")

  rows = db.query("FOR s IN score_shares SORT s.score_id ASC, s.email ASC, s.created_at ASC, s._key ASC "
  + "RETURN {\"key\": s._key, \"score_id\": s.score_id, \"email\": s.email, \"role\": s.role}")
  throw "The shares could not be read: #{rows}" if rows.is_a?("string")

  plan = ScoreShare.duplicates_in(rows)
  # The keys are the database's own: written into the query as they are.
  if plan["to_write"].length > 0
    db.query("FOR s IN score_shares FILTER s._key IN #{plan["to_write"].to_json} UPDATE s WITH {role: \"write\"} IN score_shares")
  end
  if plan["gone"].length > 0
    db.query("FOR s IN score_shares FILTER s._key IN #{plan["gone"].to_json} REMOVE s IN score_shares")
  end
  plan["gone"].length
end

def _has_index_689(db, collection, name)
  db.list_indexes(collection).any? do |index|
    index["name"] == name
  end
end

def _index_689(db, collection, name, fields, options)
  return nil if _has_index_689(db, collection, name)

  db.create_index(collection, name, fields, options)
end
