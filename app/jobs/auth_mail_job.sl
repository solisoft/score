# The account e-mails a form asks for (#539): a password reset, a
# confirmation link (sent again, or a sign-up's), the note to the owner of an
# address someone tried to sign up with, the note that signing in to the
# account was locked. The form only queues the job, whether or not the
# address has an account, and answers: looking the account up, making the
# link's token and sending the mail happen here, off the request, so that
# its time says nothing of the address. The token is made here too, so the
# queue never holds one.
#
# Args: `kind` ("reset", "confirm", "signup_taken", "account_locked"),
# `email`, `locale` (the request's: the mail is written in it; English
# without a valid one), and for "account_locked" `lock` ("source": one
# network's; "account": every browser the account does not know) and
# `by_code` (the guesses were at the two-step code, not the password).
# Answers what it did: {"found" (an account has the address), "due" (a mail
# was to go), "sent" (it left)}.
class AuthMailJob
  # The mail written in the request's language, and the worker's language
  # put back as it was afterwards: the next job it runs must not be written
  # in this one's.
  static def perform(args: Hash)
    previous = I18n.locale()
    I18n.set_locale(AuthMailJob.locale_of(args))
    try
      return AuthMailJob.send_for(args)
    finally
      I18n.set_locale(previous) unless previous.blank?
    end
  end

  # The language the mail of `args` is written in: the request's, or
  # English when it is none the site has.
  static def locale_of(args)
    locale = args["locale"].to_s
    SITE_LOCALES.includes?(locale) ? locale : SITE_LOCALES[0]
  end

  static def send_for(args)
    user = User.find_by("email", args["email"].to_s.trim.downcase)
    if user.nil?
      return {
        "found": false,
        "due": false,
        "sent": false
      }
    end

    due = AuthMailJob.due(user, args["kind"].to_s, args)
    if due.nil?
      return {
        "found": true,
        "due": false,
        "sent": false
      }
    end

    letter = AuthMailJob.letter(user, due)
    sent = MailDelivery.attempt(due["kind"], fn() { AuthMailJob.message(user, letter) })
    {
      "found": true,
      "due": true,
      "sent": sent
    }
  end

  # The mail of `kind` due to `user`: {"kind", "token"} (its link's token,
  # made now) and, for a lock, {"lock", "by_code"}; or nil when none is — a
  # confirmation to an address confirmed already, a kind unknown. A sign-up
  # with an address whose account is not confirmed yet sends its link again:
  # most likely the owner, who lost the first.
  static def due(user, kind, args = {})
    if kind == "reset"
      return {"kind": kind, "token": user.start_password_reset}
    end

    if kind == "account_locked"
      return {
        "kind": kind,
        "token": nil,
        "lock": args["lock"] == "account" ? "account" : "source",
        "by_code": args["by_code"] == true
      }
    end

    if kind == "signup_taken" && user.confirmed?
      return {"kind": kind, "token": nil}
    end

    return nil unless ["confirm", "signup_taken"].includes?(kind)
    return nil if user.confirmed?

    {"kind": "confirm", "token": user.start_email_confirmation}
  end

  # What the mail `due` to `user` says, in the current language: {"action"
  # (the AuthMailer method), "to", "subject", "links" (absolute: the site's
  # own address), "minutes", "lock", "by_code"}.
  static def letter(user, due)
    kind = due["kind"]
    base = auth_base_url()
    reset_url = base + SiteLocale.path("/password/reset")
    if kind == "reset"
      return AuthMailJob._letter(
        user,
        "reset_password",
        "mail.reset_password.title",
        {"reset_url": base + SiteLocale.path("/password/edit") + "?token=" + due["token"]}
      )
    end

    if kind == "signup_taken"
      return AuthMailJob._letter(user, "signup_taken", "security_539.signup_taken.title", {
        "login_url": base + SiteLocale.path("/login"),
        "reset_url": reset_url
      })
    end

    if kind == "account_locked"
      letter = AuthMailJob._letter(user, "account_locked", "mail.account_locked.title", {"reset_url": reset_url})
      letter["lock"] = due["lock"]
      letter["by_code"] = due["by_code"]
      letter["minutes"] = (due["lock"] == "account" ? AUTH_ACCOUNT_WINDOW : AUTH_LOCKOUT_SECONDS) / 60
      return letter
    end

    AuthMailJob._letter(
      user,
      "confirm_email",
      "mail.confirm_email.title",
      {"confirm_url": base + SiteLocale.path("/confirm_email") + "?token=" + due["token"]}
    )
  end

  static def _letter(user, action, subject_key, links)
    {
      "action": action,
      "to": user.email,
      "subject": SiteText.t(subject_key),
      "links": links
    }
  end

  # The message `letter` describes, to `user`.
  static def message(user, letter)
    action = letter["action"]
    return AuthMailer.reset_password(user, letter) if action == "reset_password"
    return AuthMailer.signup_taken(user, letter) if action == "signup_taken"
    return AuthMailer.account_locked(user, letter) if action == "account_locked"

    AuthMailer.confirm_email(user, letter)
  end

  # Queued for `email`, in the language of the request asking (`perform_later`
  # answers at once: the request does no more for a known address than for
  # an unknown one), with `extra` arguments of the kind.
  static def ask(kind, email, extra = {})
    AuthMailJob.perform_later({
      "kind": kind,
      "email": email.to_s.trim.downcase,
      "locale": I18n.locale()
    }.merge(extra))
  end
end
