# The MCP server's address (#460): POST /mcp, the Model Context Protocol's
# Streamable HTTP transport without a session — one JSON-RPC message (or a
# batch of them) a request, its answer as JSON. The client sends a personal
# access token (AccessToken) as "Authorization: Bearer …" and acts as its
# account; what it may do is ScoreMcp's.
const MCP_CALLS_PER_MINUTE = 120

class McpController < Controller
  # POST /mcp — JSON-RPC: 200 with the answer, 202 for notifications alone,
  # 401 without a valid token, 429 past MCP_CALLS_PER_MINUTE
  def handle
    user = AccessToken.user_for(@_bearer(req))
    return @_unauthorized if user.nil?

    limiter = RateLimiter("mcp:#{user._key}", MCP_CALLS_PER_MINUTE, 60)
    return @_reply(ScoreMcp.error(nil, -32000, "Too many calls: wait a minute."), 429) unless limiter.allowed()

    message = req["json"]
    return @_reply(ScoreMcp.error(nil, -32700, "The body is not JSON."), 400) if message.nil?

    if type(message) == "array"
      answers = message.map do |one|
        ScoreMcp.handle(user, one)
      end.filter do |answer|
        !answer.nil?
      end
      if answers.length == 0
        return {"status": 202, "body": ""}
      end

      return @_reply(answers, 200)
    end

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

  # The token after "Bearer " in the Authorization header, or "".
  def _bearer(req)
    header = (req["headers"] ?? {})["authorization"].to_s.trim
    return "" unless header.downcase.starts_with?("bearer ")

    header.substring(7, header.length).trim
  end

  def _unauthorized
    {
      "status": 401,
      "headers": {"Content-Type": "application/json", "WWW-Authenticate": "Bearer realm=\"score\""},
      "body": ScoreMcp.error(
        nil,
        -32001,
        "Send a personal access token as \"Authorization: Bearer …\": make one in Account › Access tokens."
      ).to_json
    }
  end

  def _reply(body, status)
    {
      "status": status,
      "headers": {"Content-Type": "application/json"},
      "body": body.to_json
    }
  end
end
