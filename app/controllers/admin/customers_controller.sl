# The customers, for an admin (#399): every account, searched and filtered,
# and one account's whole picture — its plan, its Stripe customer and
# invoices, its scores — with what an admin may change: Pro offered or
# taken back, signing in unlocked, the address confirmed. Each change made
# is kept as an AdminAction (#544), shown on the account's page.
class AdminCustomersController < AdminBaseController
  # GET /admin/customers — `q` (address or name), `filter` (pro, gift,
  # past_due, cancelling, unconfirmed, admins), `page`
  def index
    @query = params["q"].to_s.trim
    @filter = ADMIN_FILTERS[params["filter"].to_s].nil? ? "" : params["filter"].to_s
    @page = Score.page_number(params["page"])
    found = AdminReport.customers(@query, @filter, @page, @_now)
    @users = found["users"]
    @more = found["more"]
    @scores = AdminReport.score_counts(@users)
    @filters = [
      ["pro", "On Pro"],
      ["gift", "Pro offered"],
      ["past_due", "Payment failed"],
      ["cancelling", "Cancelling"],
      ["unconfirmed", "Not confirmed"],
      ["admins", "Admins"]
    ]
    @title = "Customers · Admin"
    @description = "Every account of the site."
  end

  # GET /admin/customers/:id
  def show
    @customer = User.find(params["id"])
    @picture = AdminReport.customer(@customer)
    stripe_id = @customer.stripe_customer_id
    @invoices = stripe_id.blank? ? {
      "invoices": [],
      "more": false
    } : AdminReport.invoices(stripe_id, nil)
    @stripe_customer = stripe_id.blank? ? nil : Stripe.dashboard_url("customers/#{stripe_id}")
    @admin_actions = AdminAction.about(@customer._key)
    @title = "#{this.customer.display_name} · Admin"
    @description = "One account of the site."
  end

  # POST /admin/customers/:id/gift — `days` of Pro offered
  def gift
    customer = User.find(params["id"])
    days = params["days"].to_s.to_i
    refusal = customer.gift_pro(days, @_now)
    if refusal.nil?
      @_record("gift", customer, {
        "days": days,
        "until": customer.current_period_end
      })
    end
    @_back(
      customer,
      refusal ?? "Pro offered until #{DateTime.from_unix(customer.current_period_end).format("%b %-d, %Y")}."
    )
  end

  # POST /admin/customers/:id/gift/stop — the offer of Pro ended now
  def stop_gift
    customer = User.find(params["id"])
    refusal = customer.stop_gift
    @_record("stop_gift", customer, {}) if refusal.nil?
    @_back(customer, refusal ?? "The offer of Pro ended: the account is on Free.")
  end

  # POST /admin/customers/:id/unlock — signing in allowed again
  def unlock
    customer = User.find(params["id"])
    customer.unlock
    @_record("unlock", customer, {})
    @_back(customer, "Signing in is allowed again.")
  end

  # POST /admin/customers/:id/confirm — the address taken as confirmed
  def confirm
    customer = User.find(params["id"])
    return @_back(customer, "The address was confirmed already.") if customer.confirmed?

    customer.confirm_email
    @_record("confirm", customer, {"email": customer.email})
    @_back(customer, "The address is confirmed.")
  end

  private

  # The change kept: which admin made it, to which account, and how.
  def _record(action, customer, details)
    AdminAction.record(current_user(), action, "user", customer._key, details)
  end

  def _back(customer, message)
    flash("notice", message)
    redirect(admin_customer_path(customer))
  end
end
