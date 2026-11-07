# MailDelivery: an e-mail the request must not fail over is sent, or its
# failure is logged and answered, never raised. Mailers live in the server
# process, so a stand-in message plays one here; the real mails are sent
# through it by the controller specs (sign-up, reset, invitations).
#
# The failures below are made on purpose, and their warnings say so
# ("on purpose: mail_delivery_spec"): CI fails the suite on any other
# "could not be sent" in its log or the test servers' (#671).

class StandInMessage
  def deliver_now
    throw "SMTP refused the recipient (on purpose: mail_delivery_spec)" if @fails

    @sent = true
  end

  def sent?
    @sent
  end
end

describe("MailDelivery") do
  before_each() do
    Logger.set_capture(true)
  end

  after_each() do
    Logger.set_capture(false)
  end

  test("sends the message and answers true, logging nothing") do
    message = StandInMessage.new({
      "fails": false,
      "sent": false
    })
    assert(MailDelivery.attempt("password reset", fn() { message }))
    assert(message.sent?)
    assert_eq(Logger.entries().filter(&{ |line|
      line.contains("could not be sent")
    }).length, 0)
  end

  test("a message that cannot be sent answers false and leaves a warning naming it") do
    message = StandInMessage.new({
      "fails": true,
      "sent": false
    })
    assert_not(MailDelivery.attempt("invitation", fn() { message }))
    assert_not(message.sent?)
    warnings = Logger.entries().filter do |line|
      line.contains("invitation email could not be sent")
    end
    assert_eq(warnings.length, 1)
    assert_contains(warnings[0], "WARN")
    assert_contains(warnings[0], "SMTP refused the recipient")
  end

  test("error_of answers why it could not leave, or nil when it left") do
    refused = StandInMessage.new({
      "fails": true,
      "sent": false
    })
    error = MailDelivery.error_of("invitation", fn() { refused })
    assert_contains(error, "SMTP refused the recipient")
    taken = StandInMessage.new({
      "fails": false,
      "sent": false
    })
    assert_null(MailDelivery.error_of("invitation", fn() { taken }))
    assert(taken.sent?)
  end

  test("a message that cannot even be built answers false too") do
    assert_not(MailDelivery.attempt("confirmation", fn() {
      throw "no such template (on purpose: mail_delivery_spec)"
    }))
    assert_eq(Logger.entries().filter(&{ |line|
      line.contains("confirmation email could not be sent")
    }).length, 1)
  end
end
