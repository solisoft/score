# The account e-mails a form asks for (#539): a password reset, a
# confirmation link (sent again, or a sign-up's), the note to the owner of an
# address someone tried to sign up with. The form only queues the job,
# whether or not the address has an account, and answers: looking the
# account up, making the link's token and sending the mail happen here, off
# the request, so that its time says nothing of the address. The token is
# made here too, so the queue never holds one.
#
# Args: `kind` ("reset", "confirm", "signup_taken"), `email`, `locale` (the
# request's: the mail is written in it). Answers what it did: {"found" (an
# account has the address), "due" (a mail was to go), "sent" (it left)}.
class AuthMailJob
  static def perform(args: Hash)
    locale = args["locale"].to_s
    I18n.set_locale(locale) if SITE_LOCALES.includes?(locale)
    user = User.find_by("email", args["email"].to_s.trim.downcase)
    if user.nil?
      return {
        "found": false,
        "due": false,
        "sent": false
      }
    end

    due = AuthMailJob.due(user, args["kind"].to_s)
    if due.nil?
      return {
        "found": true,
        "due": false,
        "sent": false
      }
    end

    sent = MailDelivery.attempt(due["kind"], fn() { AuthMailJob.message(user, due) })
    {
      "found": true,
      "due": true,
      "sent": sent
    }
  end

  # The mail of `kind` due to `user`: {"kind", "token"} (its link's token,
  # made now), or nil when none is — a confirmation to an address confirmed
  # already, a kind unknown.
  static def due(user, kind)
    if kind == "reset"
      return {"kind": kind, "token": user.start_password_reset}
    end

    if kind == "signup_taken"
      return {"kind": kind, "token": nil}
    end

    return nil if kind != "confirm" || user.confirmed?

    {"kind": kind, "token": user.start_email_confirmation}
  end

  # The message `due` names, to `user`.
  static def message(user, due)
    return AuthMailer.reset_password(user, due["token"]) if due["kind"] == "reset"
    return AuthMailer.signup_taken(user) if due["kind"] == "signup_taken"

    AuthMailer.confirm_email(user, due["token"])
  end

  # Queued for `email`, in the language of the request asking (`perform_later`
  # answers at once: the request does no more for a known address than for
  # an unknown one).
  static def ask(kind, email)
    AuthMailJob.perform_later({
      "kind": kind,
      "email": email.to_s.trim.downcase,
      "locale": I18n.locale()
    })
  end
end
