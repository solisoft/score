# A Stripe event handled by the webhook (#393, Billing): its id, unique (the
# migration's index), so an event Stripe sends again is answered and not
# applied twice.
class StripeEvent < Model
  validates(
    "event_id",
    {"presence": true, "uniqueness": true}
  )

  # `event_id` (of `kind`) claimed for handling: the record, or nil when it
  # was handled already (or is being, by another worker: the unique index
  # lets one of two through).
  static def claim(event_id, kind)
    return nil if event_id.to_s.blank?

    record = StripeEvent.create({
      "event_id": event_id.to_s,
      "kind": kind.to_s,
      "received_at": DateTime.utc.to_unix
    })
    return nil if record._errors || record._key.nil?

    record
  end

  # The outcome kept with the event ("processed", "ignored", "no_user").
  def finish(outcome, user_key = nil)
    @outcome = outcome
    @user_id = user_key
    @save
  end

  # Whether `event_id` was handled already.
  static def seen?(event_id)
    StripeEvent.where({"event_id": event_id.to_s}).count > 0
  end
end
