# The admin section (/admin, #399): only an account whose `role` is "admin"
# (User#admin?) reaches it. Anyone else, signed in or not, is answered 404:
# the section does not say it exists. `require_login` (order 40) has sent a
# guest to sign in before this runs.
#
# An admin reaches it with two-step sign-in on (#544): a stolen password
# alone must not open every account. An admin without it is sent to a page
# that says so and leads to the account's two-step setting
# (/admin/two-step, outside this middleware), never locked out of the rest.

# order: 45
# scope_only: true

def require_admin(req)
  user = req["current_user"]
  halt(404, "Not found") if user.nil? || !user.admin?
  return req if user.two_step?

  redirect(admin_two_step_path())
end
