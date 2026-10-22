# The app's screens that belong to someone: a guest is sent to sign in, and
# comes back to where they were going once signed in (`return_to`).
# `load_current_user` (current_user.sl, order 5) has already read the session.

# order: 40
# scope_only: true

def require_login(req)
  return req unless req["current_user"].nil?

  redirect("/login?return_to=" + url(req["path"].to_s))
end
