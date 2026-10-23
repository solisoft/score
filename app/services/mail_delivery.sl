# Sends an e-mail the request must not fail over (sign-up, confirmation,
# password reset, invitations): a failure is logged as a warning, never
# raised, and the caller learns whether the message left.
class MailDelivery
  # Builds the message with `build` (a function answering a mailer's
  # message) and sends it now. Answers true when it left, false when it
  # could not be built or sent; `purpose` names it in the log line.
  static def attempt(purpose, build)
    try
      build().deliver_now
      return true
    catch error
      Logger.warn(
        "#{purpose} email could not be sent",
        {"purpose": purpose, "error": str(error)}
      )
      return false
    end
  end
end
