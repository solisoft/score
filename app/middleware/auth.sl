# The app's screens that belong to someone: a guest is sent to sign in, and
# comes back to where they were going once signed in (`return_to`).
# `load_current_user` (current_user.sl, order 5) has already read the session.
# A request that wants JSON (the editor's save, its version and AI calls) is
# answered 401 JSON instead: a redirect to the sign-in page would reach a
# fetch as HTML, which the editor would take for a network failure.

# order: 40
# scope_only: true

def require_login(req)
  return req unless req["current_user"].nil?
  return render_json({"error": "signed out"}, 401) if _wants_json(req)

  redirect("/login?return_to=" + url(req["path"].to_s))
end

# Whether `req` asks for JSON, or sends it.
def _wants_json(req)
  headers = req["headers"] ?? {}
  headers["accept"].to_s.contains("application/json") ||
      headers["content-type"].to_s.contains("application/json")
end
