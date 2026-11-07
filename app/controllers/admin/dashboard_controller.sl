# The admin section's first screen (#399): the figures of the accounts and
# the plans, the sign-ups week by week, the newest accounts and the last
# events Stripe sent.
class AdminDashboardController < AdminBaseController
  # GET /admin
  def index
    now = @_now
    @figures = AdminReport.figures(now)
    @weeks = AdminReport.weekly_signups(now)
    @peak = [@weeks.map(&:count).max(), 1].max()
    @newest = AdminReport.newest(8)
    @events = AdminReport.recent_events(8)
    @names = User.names_of(@events.map(&:user_id))
    @payments_open = Plan.open?
    @site_free = Plan.free?
    @title = "Admin"
    @description = "The site's accounts, plans and payments."
  end
end
