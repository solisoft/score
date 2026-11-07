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
# network's; "account": every browser the account does not know; "code":
# the two-step code step, paused after wrong codes, #538) and
# `by_code` (the guesses were at the two-step code, not the password).
# Answers what it did: {"found" (an account has the address), "due" (a mail
# was to go), "sent" (it left)}. A mail due that could not leave fails the
# job instead (#671): the queue tries it again, and its row keeps why.
#
# A retry must not change the link (#671's review). The mail of a failed
# attempt may have left all the same (the mail server took it, then the
# connection dropped): a new token would kill the link it carries, and a
# server refusing for good would see a new one at every attempt. So each
# letter has an id, `letter` (a UUID v7, time-ordered, put in the args by
# `ask`), and its link's token is derived from it — an HMAC of the id under
# SOLI_ENCRYPTION_KEY — instead of drawn at random: every attempt of the job
# rebuilds the same token, and the account notes which letter made its link
# (`reset_letter`, `confirmation_letter`). Nothing readable holds the token:
# the queue has the id only, worthless without the key, which lives in the
# server's environment and not in the database; the account keeps the
# token's digest, as before. A retry finding its own letter's link sends it
# again, or nothing once the link was followed or dropped; a letter older
# than the one that made the account's link sends nothing, so as not to
# kill the newer link. Without a key, the first attempt draws a random
# token as before, and a retry that would need it fails, saying so: it
# cannot be rebuilt, and drawing another would kill the first.
class AuthMailJob
  static def perform(args: Hash)
    AuthMailJob.in_language_of(args, fn() { AuthMailJob.send_for(args) })
  end

  # What the job decides for `args`, sending nothing: {"found", "due", and
  # when a mail is due its "kind", "user" and "letter" (AuthMailJob.letter)},
  # in the request's language, its link made. The specs read the job here:
  # `soli test` loads no mailer (app/mailers) in the spec's own process
  # (#671), so the message is built, and its delivery proven, by the test
  # server's worker (tests/controllers/account_mail_spec.sl).
  static def prepare(args: Hash) -> Hash
    AuthMailJob.in_language_of(args, fn() { AuthMailJob._prepare(args) })
  end

  # `work` done in the language of the request that asked (`args`), and the
  # worker's language put back as it was afterwards: the next job it runs
  # must not be written in this one's.
  static def in_language_of(args: Hash, work: () -> Any) -> Any
    previous = I18n.locale()
    I18n.set_locale(AuthMailJob.locale_of(args))
    try
      return work()
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

  # The job's work: the mail of `args` prepared and sent. `build` makes the
  # message of a user and a letter (AuthMailJob.message, the mailer's;
  # the specs hand a stand-in, the spec process loading no mailer).
  static def send_for(args, build = nil)
    build ||= fn(user, letter) { AuthMailJob.message(user, letter) }
    prepared = AuthMailJob._prepare(args)
    unless prepared["due"]
      return {
        "found": prepared["found"],
        "due": false,
        "sent": false
      }
    end

    kind = prepared["kind"]
    user = prepared["user"]
    letter = prepared["letter"]
    error = MailDelivery.error_of(kind, fn() { build(user, letter) })
    # Not sent, the job fails: the queue tries again later (a mail server
    # refusing for a moment), and the row says so, with the mail server's or
    # the template's own words, where the operator and the specs look — not
    # only in a warning of the log.
    throw "#{kind} email could not be sent: #{error}" unless error.nil?

    {
      "found": true,
      "due": true,
      "sent": true
    }
  end

  static def _prepare(args)
    user = User.find_by("email", args["email"].to_s.trim.downcase)
    if user.nil?
      return {"found": false, "due": false}
    end

    due = AuthMailJob.due(user, args["kind"].to_s, args)
    if due.nil?
      return {"found": true, "due": false}
    end

    {
      "found": true,
      "due": true,
      "kind": due["kind"],
      "user": user,
      "letter": AuthMailJob.letter(user, due)
    }
  end

  # The mail of `kind` due to `user`: {"kind", "token"} (its link's token,
  # AuthMailJob.link_token) and, for a lock, {"lock", "by_code"}; or nil
  # when none is — a confirmation to an address confirmed already, a kind
  # unknown, a link a retry must not send (link_token). A sign-up with an
  # address whose account is not confirmed yet sends its link again: most
  # likely the owner, who lost the first.
  static def due(user, kind, args = {})
    if kind == "reset"
      token = AuthMailJob.link_token(user, kind, args)
      return token.nil? ? nil : {
        "kind": kind,
        "token": token
      }
    end

    if kind == "account_locked"
      return {
        "kind": kind,
        "token": nil,
        "lock": ["account", "code"].includes?(args["lock"]) ? args["lock"] : "source",
        "by_code": args["by_code"] == true
      }
    end

    if kind == "signup_taken" && user.confirmed?
      return {"kind": kind, "token": nil}
    end

    return nil unless ["confirm", "signup_taken"].includes?(kind)
    return nil if user.confirmed?

    token = AuthMailJob.link_token(user, "confirm", args)
    token.nil? ? nil : {"kind": "confirm", "token": token}
  end

  # The token of the link the letter `args` asked for carries, `kind`
  # "reset" or "confirm" — made now, the account's link from then on, or
  # the one an earlier attempt of the same letter made (see the top of the
  # file); nil when this letter must send no link: its link was followed or
  # dropped since, or a newer letter's is the account's. `key`: the
  # server's SOLI_ENCRYPTION_KEY unless given ("" for none, as the specs
  # do: one `soli test` run has one environment).
  static def link_token(user, kind, args, key = nil)
    key = getenv("SOLI_ENCRYPTION_KEY") if key.nil?
    letter = args["letter"].to_s
    # Queued before letters had an id (#671's review): made as then.
    return AuthMailJob._make_link(user, kind, uuid_v4(), nil) if letter.blank?

    reset = kind == "reset"
    made_by = (reset ? user.reset_letter : user.confirmation_letter).to_s
    digest = reset ? user.reset_token_digest : user.confirmation_token_digest
    token = AuthMailJob.letter_token(letter, key)
    if made_by == letter
      return nil if digest.blank?

      throw "#{kind} link of letter #{letter}: cannot be made again without SOLI_ENCRYPTION_KEY" if token.nil?

      return Crypto.sha256(token) == digest ? token : nil
    end
    return nil if made_by.present? && letter < made_by

    AuthMailJob._make_link(user, kind, token ?? uuid_v4(), letter)
  end

  # The token of the link of the letter `letter`, under `key`: the same at
  # every attempt of its job, and no one's to guess without the key. Nil
  # without one.
  static def letter_token(letter, key)
    return nil if key.blank?

    Crypto.hmac("score account mail link\n" + letter, key)
  end

  static def _make_link(user, kind, token, letter)
    return user.start_password_reset(token, letter) if kind == "reset"

    user.start_email_confirmation(token, letter)
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
      letter["minutes"] = AuthMailJob.lock_seconds(due["lock"]) / 60
      return letter
    end

    AuthMailJob._letter(
      user,
      "confirm_email",
      "mail.confirm_email.title",
      {"confirm_url": base + SiteLocale.path("/confirm_email") + "?token=" + due["token"]}
    )
  end

  # How long a lock of kind `lock` lasts.
  static def lock_seconds(lock)
    return AUTH_ACCOUNT_WINDOW if lock == "account"
    return TWO_STEP_LOCK_SECONDS if lock == "code"

    AUTH_LOCKOUT_SECONDS
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
  # an unknown one), with `extra` arguments of the kind. `letter`: the id
  # of this letter (see the top of the file), not a secret.
  static def ask(kind, email, extra = {})
    AuthMailJob.perform_later({
      "kind": kind,
      "email": email.to_s.trim.downcase,
      "locale": I18n.locale(),
      "letter": uuid_v7()
    }.merge(extra))
  end
end
