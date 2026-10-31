# Migration: create_oauth_server — Score as an OAuth 2.1 authorization
# server for its MCP endpoint (#461, OauthServer): the clients that
# registered themselves (OauthClient), the single-use codes of the consent
# page (OauthCode), and the refresh tokens of the connections they make,
# kept on access_tokens (AccessToken), looked up by their SHA-256.

def up(db)
  db.create_collection("oauth_clients")
  db.create_index("oauth_clients", "idx_oauth_clients_client_id", ["client_id"], {"unique": true})
  db.create_collection("oauth_codes")
  db.create_index("oauth_codes", "idx_oauth_codes_digest", ["code_digest"], {"unique": true})
  db.create_index("access_tokens", "idx_access_tokens_refresh", ["refresh_digest"], {"sparse": true})
end

def down(db)
  db.drop_index("access_tokens", "idx_access_tokens_refresh")
  db.drop_collection("oauth_codes")
  db.drop_collection("oauth_clients")
end
