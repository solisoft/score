# The admin section (/admin, #399): only an account whose `role` is "admin"
# (User#admin?) reaches it. Anyone else, signed in or not, is answered 404:
# the section does not say it exists. `require_login` (order 40) has sent a
# guest to sign in before this runs.
#
# An admin reaches it from a session that passed a second step (#544,
# SecondStep): a stolen password alone must not open every account — nor a
# session opened before two-step was turned on. Anyone else is sent to a
# page that says what to do (/admin/two-step, outside this middleware):
# turn two-step on, or sign in again with the code. Never locked out of the
# rest of the app.

# order: 45
# scope_only: true

def require_admin(req)
  user = req["current_user"]
  halt(404, "Not found") if user.nil? || !user.admin?
  return req if SecondStep.passed?(user)

  redirect(admin_two_step_path())
end
