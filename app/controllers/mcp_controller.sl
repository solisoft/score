# The MCP server's address (#460): POST /mcp, the Model Context Protocol's
# Streamable HTTP transport without a session — one JSON-RPC message (or a
# batch of them) a request, its answer as JSON. The client sends a personal
# access token (AccessToken) as "Authorization: Bearer …" and acts as its
# account; what it may do is ScoreMcp's.
const MCP_CALLS_PER_MINUTE = 120
# The most messages one batch may carry: each is counted as a call.
const MCP_BATCH_MOST = 20

class McpController < Controller
  # POST /mcp — JSON-RPC: 200 with the answer, 202 for notifications alone,
  # 401 without a valid token, 429 past MCP_CALLS_PER_MINUTE, 400 for an
  # empty batch or one of more than MCP_BATCH_MOST
  def handle
    user = AccessToken.user_for(@_bearer(req))
    return @_unauthorized if user.nil?

    limiter = RateLimiter("mcp:#{user._key}", MCP_CALLS_PER_MINUTE, 60)
    message = req["json"]
    # A batch counts each of its messages against the limit, not the
    # request once: those past it are answered "too many", not run.
    if type(message) == "array"
      # An empty batch is one invalid request, answered once (JSON-RPC 2.0).
      return @_reply(ScoreMcp.error(nil, -32600, "An empty batch is not a request."), 400) if message.length == 0
      if message.length > MCP_BATCH_MOST
        return @_reply(ScoreMcp.error(nil, -32600, "A batch is #{MCP_BATCH_MOST} messages at most."), 400)
      end

      return @_too_many if limiter.throttle() > 0

      answers = message.map do |one|
        limiter.allowed() ? ScoreMcp.handle(user, one) : @_too_many_in_batch(one)
      end.filter do |answer|
        !answer.nil?
      end
      if answers.length == 0
        return {"status": 202, "body": ""}
      end

      return @_reply(answers, 200)
    end

    return @_too_many unless limiter.allowed()
    return @_reply(ScoreMcp.error(nil, -32700, "The body is not JSON."), 400) if message.nil?

    answer = ScoreMcp.handle(user, message)
    if answer.nil?
      return {"status": 202, "body": ""}
    end

    @_reply(answer, 200)
  end

  # GET /mcp — no stream of server messages here: 405, as the transport says
  def stream
    {
      "status": 405,
      "headers": {"Allow": "POST", "Content-Type": "application/json"},
      "body": {"error": "POST JSON-RPC messages here: this server opens no stream."}.to_json
    }
  end

  private

  def _too_many
    answer = @_reply(ScoreMcp.error(nil, -32000, "Too many calls: wait a minute."), 429)
    answer["headers"]["Retry-After"] = "60"
    answer
  end

  # A batch's message past the limit: its refusal, or nothing for a
  # notification, which is never answered.
  def _too_many_in_batch(one)
    return ScoreMcp.error(nil, -32000, "Too many calls: wait a minute.") unless type(one) == "hash"
    return nil if one["id"].nil?

    ScoreMcp.error(one["id"], -32000, "Too many calls: wait a minute.")
  end

  # The token after "Bearer " in the Authorization header, or "".
  def _bearer(req)
    header = (req["headers"] ?? {})["authorization"].to_s.trim
    return "" unless header.downcase.starts_with?("bearer ")

    header.substring(7, header.length).trim
  end

  def _unauthorized
    {
      "status": 401,
      "headers": {"Content-Type": "application/json", "WWW-Authenticate": OauthServer.challenge},
      "body": ScoreMcp.error(
        nil,
        -32001,
        "Sign in to Score from your MCP client, or send a personal access token "
        + "as \"Authorization: Bearer …\" (Account › Access tokens)."
      ).to_json
    }
  end

  # Where to sign in from (#461): the metadata OauthServer serves.
  def _reply(body, status)
    {
      "status": status,
      "headers": {"Content-Type": "application/json"},
      "body": body.to_json
    }
  end
end
