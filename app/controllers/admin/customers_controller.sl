# The customers, for an admin (#399): every account, searched and filtered,
# and one account's whole picture — its plan, its Stripe customer and
# invoices, its scores — with what an admin may change: Pro offered or
# taken back, signing in unlocked, the address confirmed.
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
    @title = "#{this.customer.display_name} · Admin"
    @description = "One account of the site."
  end

  # POST /admin/customers/:id/gift — `days` of Pro offered
  def gift
    customer = User.find(params["id"])
    refusal = customer.gift_pro(params["days"].to_s.to_i, @_now)
    @_back(
      customer,
      refusal ?? "Pro offered until #{DateTime.from_unix(customer.current_period_end).format("%b %-d, %Y")}."
    )
  end

  # POST /admin/customers/:id/gift/stop — the offer of Pro ended now
  def stop_gift
    customer = User.find(params["id"])
    @_back(customer, customer.stop_gift ?? "The offer of Pro ended: the account is on Free.")
  end

  # POST /admin/customers/:id/unlock — signing in allowed again
  def unlock
    customer = User.find(params["id"])
    customer.unlock
    @_back(customer, "Signing in is allowed again.")
  end

  # POST /admin/customers/:id/confirm — the address taken as confirmed
  def confirm
    customer = User.find(params["id"])
    return @_back(customer, "The address was confirmed already.") if customer.confirmed?

    customer.confirm_email
    @_back(customer, "The address is confirmed.")
  end

  private

  def _back(customer, message)
    flash("notice", message)
    redirect(admin_customer_path(customer))
  end
end
