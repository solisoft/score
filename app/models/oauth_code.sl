# A single-use authorization code (#461): what the consent page sends back
# to the client, traded at /oauth/token for tokens. Only its SHA-256 is
# kept; it lives OAUTH_CODE_SECONDS.
const OAUTH_CODE_SECONDS = 600

class OauthCode < Model
  validates("code_digest", {"presence": true})

  # A code for `user`'s approval of `client_id`, to come back with
  # `redirect_uri` and the verifier of `code_challenge`: the code itself
  # (only its digest is kept). `redirect_uri_sent`: whether the request
  # named the URI, which the exchange must then name too (#541).
  static def issue(client_id, user, redirect_uri, code_challenge, redirect_uri_sent = true)
    raw = Crypto.random_token(32)
    OauthCode.create({
      "code_digest": Crypto.sha256(raw),
      "client_id": client_id,
      "user_id": user._key,
      "redirect_uri": redirect_uri,
      "redirect_uri_sent": redirect_uri_sent,
      "code_challenge": code_challenge,
      "expires_at": DateTime.utc.to_unix + OAUTH_CODE_SECONDS
    })
    raw
  end

  # What code `raw` carried, the code taken away — once: a second exchange
  # of the same code, a replay or a race, finds nothing.
  static def burn(raw)
    return nil if raw.to_s.blank?

    digest = Crypto.sha256(raw.to_s)
    rows = @sdbql{
      FOR code IN oauth_codes
      FILTER code.code_digest == #{digest}
      REMOVE code IN oauth_codes
      RETURN OLD
    }
    return nil unless type(rows) == "array" && rows.length > 0

    rows[0]
  end
end
