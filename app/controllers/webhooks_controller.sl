# What other services post to the site. Stripe's events set the Pro plan
# (#393): public, without CSRF (config/application.sl), each request proven
# by its Stripe-Signature instead. The checks and what an event changes are
# Billing's (Billing.receive), so a spec proves them without the
# environment's secret.
class WebhooksController < Controller
  # POST /webhooks/stripe — 200 once handled (or handled already), 400 when
  # the signature is missing, wrong or stale, 503 while no secret is set
  def stripe
    headers = req["headers"] ?? {}
    answer = Billing.receive(
      req["body"].to_s,
      headers["stripe-signature"].to_s,
      Stripe.webhook_secret,
      DateTime.utc.to_unix
    )
    render_json(answer["body"], answer["status"])
  end
end
