# An application that registered itself with Score's OAuth server (#461,
# OauthServer) by dynamic client registration (RFC 7591) — Claude Code,
# claude.ai's connectors, Cursor — to ask a person for access to /mcp.
# Public clients only, no secret: what binds a code to the client that
# asked for it is PKCE and the exact redirect URI registered here.
class OauthClient < Model
  validates("client_id", {"presence": true})
  validates("client_name", {"presence": true})

  # A new client named `name`, sending codes to `redirect_uris` (checked by OauthServer).
  static def register(name, redirect_uris)
    label = name.to_s.trim
    label = "MCP client" if label.blank?
    label = label.substring(0, 100) if label.chars().length > 100
    OauthClient.create({
      "client_id": "score_oc_" + nanoid(24),
      "client_name": label,
      "redirect_uris": redirect_uris,
      "created_at": DateTime.utc.to_unix
    })
  end

  # The client of id `client_id`, or nil.
  static def for_id(client_id)
    return nil if client_id.to_s.blank?

    OauthClient.where({"client_id": client_id.to_s}).first
  end

  # Whether codes may be sent to `uri`: one it registered, exactly.
  def redirect_uri?(uri)
    (@redirect_uris ?? []).includes?(uri.to_s)
  end
end
