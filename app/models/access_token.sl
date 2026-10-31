# A personal access token (#460): what a client of the MCP server (/mcp,
# McpController) sends as "Authorization: Bearer …" to act as its account —
# Claude Code, or any MCP client. It is shown once, when it is made; the
# site keeps only its SHA-256 (`digest`) and its first characters, to tell
# tokens apart in the account's list. Its owner names it and revokes it.
const ACCESS_TOKEN_PREFIX = "score_"
const ACCESS_TOKENS_PER_USER = 10
const ACCESS_TOKEN_NAME_LENGTH = 60
# How often its "last used" is written: a client calling every second does
# not write every second.
const ACCESS_TOKEN_TOUCH_SECONDS = 300

class AccessToken < Model
  validates("user_id", {"presence": true})
  validates("name", {"presence": true})
  validates("digest", {"presence": true})

  # A new token for `user`, named `name`: {"token" (the secret, shown once),
  # "record"}, or {"error"} with nothing written.
  static def issue(user, name)
    label = name.to_s.trim
    return {"error": "Give the token a name: where it is used, say."} if label.blank?
    if label.chars().length > ACCESS_TOKEN_NAME_LENGTH
      return {"error": "A name holds #{ACCESS_TOKEN_NAME_LENGTH} characters at most."}
    end

    if AccessToken.where({"user_id": user._key}).count >= ACCESS_TOKENS_PER_USER
      return {"error": "You have #{ACCESS_TOKENS_PER_USER} tokens: revoke one you no longer use first."}
    end

    secret = ACCESS_TOKEN_PREFIX + Crypto.random_token(32)
    record = AccessToken.create({
      "user_id": user._key,
      "name": label,
      "digest": Crypto.sha256(secret),
      "hint": secret.substring(0, ACCESS_TOKEN_PREFIX.length + 4),
      "created_at": DateTime.utc.to_unix,
      "last_used_at": nil
    })
    return {"error": "The token could not be made: try again."} unless record._errors.nil?

    {"token": secret, "record": record}
  end

  # The account `secret` (a token as sent) acts as, or nil: unknown, revoked
  # or not a token at all. Its use is noted, at most every few minutes.
  static def user_for(secret)
    text = secret.to_s.trim
    unless text.starts_with?(ACCESS_TOKEN_PREFIX) && text.length > ACCESS_TOKEN_PREFIX.length + 16
      return nil
    end

    record = AccessToken.where({"digest": Crypto.sha256(text)}).first
    return nil if record.nil?

    user = User.find_by("_key", record.user_id)
    return nil if user.nil?

    now = DateTime.utc.to_unix
    if record.last_used_at.to_s.to_i < now - ACCESS_TOKEN_TOUCH_SECONDS
      record.last_used_at = now
      record.update()
    end
    user
  end

  # `user`'s tokens, the latest made first.
  static def of(user)
    AccessToken.where({"user_id": user._key}).order("created_at", "desc").all
  end

  # `user`'s token of key `key` revoked: true, or false when they have none so.
  static def revoke(user, key)
    record = AccessToken.where({
      "user_id": user._key,
      "_key": key.to_s
    }).first
    return false if record.nil?

    record.delete
    true
  end

  # Every token of `user`'s (their account goes).
  static def delete_all_of(user)
    AccessToken.where({"user_id": user._key}).delete_all
    nil
  end
end
