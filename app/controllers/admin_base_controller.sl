# What every screen of the admin section (/admin, #399) shares, and no
# action: the app's layout, and the time "now" for the figures. The routes
# behind it sit in `require_login` then `require_admin`
# (app/middleware/admin.sl): anyone but an admin is answered 404.
class AdminBaseController < Controller
  static {
    this.layout = "app"
  }

  private

  def _now
    DateTime.utc.to_unix
  end
end
