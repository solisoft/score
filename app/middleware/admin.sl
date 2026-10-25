# The admin section (/admin, #399): only an account whose `role` is "admin"
# (User#admin?) reaches it. Anyone else, signed in or not, is answered 404:
# the section does not say it exists. `require_login` (order 40) has sent a
# guest to sign in before this runs.

# order: 45
# scope_only: true

def require_admin(req)
  user = req["current_user"]
  return req if !user.nil? && user.admin?

  halt(404, "Not found")
end
