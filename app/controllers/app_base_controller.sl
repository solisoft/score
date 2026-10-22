# What every screen of the score-writing app (/app) shares, and no action:
# its full-screen layout. The routes behind it sit in the
# `require_app_database` middleware (app/middleware/app_setup.sl).
class AppBaseController < Controller
  static {
    this.layout = "app"
  }
end
