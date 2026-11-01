# Migration: add_previous_refresh_digest_index — an OAuth connection keeps
# the digest of the refresh token it rotated away (#541, AccessToken):
# presented again, it is a reuse and the connection is revoked. Looked up
# on every refresh that misses, so indexed.

def up(db)
  db.create_index(
    "access_tokens",
    "idx_access_tokens_previous_refresh",
    ["previous_refresh_digest"],
    {"sparse": true}
  )
end

def down(db)
  db.drop_index("access_tokens", "idx_access_tokens_previous_refresh")
end
