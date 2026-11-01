# Paying for Pro (#393): Upgrade sends the signed-in person to Stripe's
# Checkout, Manage billing to Stripe's customer portal. Neither changes the
# plan: Stripe's webhook does (WebhooksController, Billing), so coming back
# from Stripe only says thank you. Behind `require_login`.
class AppBillingController < AppBaseController
  # POST /app/billing/checkout — `interval` "monthly" or "annual": off to
  # Stripe, or back to the account saying why not
  def checkout
    interval = Plan.interval(params["interval"])
    answer = Billing.checkout(
      current_user(),
      interval,
      auth_base_url() + app_billing_done_path(),
      auth_base_url() + app_account_path() + "#plan"
    )
    @_to_stripe(answer)
  end

  # POST /app/billing/portal — Stripe's page to change the card, the
  # interval, or cancel
  def portal
    @_to_stripe(Billing.portal(current_user(), auth_base_url() + app_account_path() + "#plan"))
  end

  # GET /app/billing/done — back from a payment: the plan shows once
  # Stripe's webhook has said so
  def done
    flash("notice", SiteText.t("app.account.billing_thanks"))
    redirect(app_account_path() + "#plan")
  end

  private

  # To Stripe's page in `answer`, or the account with its error.
  def _to_stripe(answer)
    unless answer["error"].nil?
      flash("notice", answer["error"])
      return redirect(app_account_path() + "#plan")
    end

    redirect_external(answer["url"])
  end
end
