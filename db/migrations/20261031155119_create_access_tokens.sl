# Migration: create_access_tokens — personal access tokens (#460): what a
# client of the MCP server (/mcp) sends to act as its account. Only the
# token's SHA-256 is kept, looked up by it; a person lists theirs.

def up(db)
  db.create_collection("access_tokens")
  db.create_index("access_tokens", "idx_access_tokens_digest", ["digest"], {"unique": true})
  db.create_index("access_tokens", "idx_access_tokens_user", ["user_id", "created_at"], {})
end

def down(db)
  db.drop_collection("access_tokens")
end
