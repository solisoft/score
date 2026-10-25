# The payments, for an admin (#399): the invoices Stripe holds, read live
# from Stripe, each linked to the account it bills; and the events Stripe
# sent the webhook, with what each changed.
class AdminPaymentsController < AdminBaseController
  # GET /admin/payments — `after` (an invoice id) for the next page
  def index
    @after = params["after"].to_s.trim
    @invoices = AdminReport.invoices(nil, @after)
    rows = @invoices["invoices"] ?? []
    @accounts = AdminReport.accounts_of(rows)
    @next_after = @invoices["more"] == true && rows.length > 0 ? rows[rows.length - 1]["id"] : nil
    @events = AdminReport.recent_events(50)
    @names = User.names_of(@events.map(&:user_id))
    @stripe_invoices = Stripe.dashboard_url("invoices")
    @title = "Payments · Admin"
    @description = "The invoices and the events of Stripe."
  end
end
