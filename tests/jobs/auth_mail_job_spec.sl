# The account e-mails AuthMailJob sends (#539), off the request that asked:
# each kind's mail, in the language of that request, its links absolute (to
# the site's own address), and the language it chose not left behind for
# the next job the worker runs.
#
# `soli test` loads no mailer (app/mailers) in the spec's process, nor the
# views a mailer renders (#671), so the message itself is not built here:
# what the job decides — the mail due, its subject and links in the
# request's language (AuthMailJob.prepare / letter, which AuthMailer only
# copies into its view) — is what these specs read. The message, built and
# handed to delivery by the test server's worker, is account_mail_spec's.

def auth_mail_user(confirmed = true)
  user = User.new()
  user.email = "auth-mail-#{uuid_v4}@example.com"
  user.set_password("correct horse battery")
  user.confirmed_at = DateTime.utc.to_unix if confirmed
  user.save
  user
end

# The letter of `kind` AuthMailJob writes to `user` in `locale`, as the job
# does: the mail due, then its letter in that language.
def auth_letter(user, kind, locale, extra = {})
  args = {
    "kind": kind,
    "email": user.email,
    "locale": locale,
    "letter": uuid_v7()
  }.merge(extra)
  previous = I18n.locale()
  I18n.set_locale(AuthMailJob.locale_of(args))
  due = AuthMailJob.due(User.find(user._key), kind, args)
  assert_not_null(due, "#{kind} due")
  letter = AuthMailJob.letter(User.find(user._key), due)
  I18n.set_locale(previous)
  letter
end

# A message as a mailer's, which the mail server takes or, `refused`,
# refuses — on purpose, and its warning says so: CI fails on any other
# "could not be sent" in the suite's log (#671).
class AuthMailStandIn
  def deliver_now
    throw "550 mailbox unavailable (on purpose: auth_mail_job_spec)" if @refused

    true
  end
end

# One attempt of the job of `args`, as the worker makes it, its message a
# stand-in the mail server takes or refuses (`refused`); the link the
# letter carried is pushed on `links`.
def auth_mail_attempt(args, refused, links)
  AuthMailJob.send_for(args, fn(user, letter) {
    links.push(letter["links"]["reset_url"] ?? letter["links"]["confirm_url"])
    AuthMailStandIn.new({"refused": refused})
  })
end

# The arguments `ask` queues for a letter of `kind` to `user`.
def auth_mail_args(user, kind)
  {
    "kind": kind,
    "email": user.email,
    "locale": "en",
    "letter": uuid_v7()
  }
end

# Every link of `letter` goes to the site's own address.
def auth_links_absolute(letter)
  links = letter["links"]
  assert_gt(links.keys.length, 0)
  links.keys.each do |name|
    assert(links[name].starts_with?(auth_base_url() + "/"), "absolute: " + name)
  end
end

describe("AuthMailJob") do
  before_each() do
    I18n.set_locale("en")
  end

  test("a reset, its link, in English and in French") do
    user = auth_mail_user()
    english = auth_letter(user, "reset", "en")
    assert_eq(english["action"], "reset_password")
    assert_eq(english["to"], user.email)
    assert_eq(english["subject"], SiteText.t("mail.reset_password.title", {}, "en"))
    assert_contains(english["links"]["reset_url"], auth_base_url() + "/password/edit?token=")
    auth_links_absolute(english)
    french = auth_letter(user, "reset", "fr")
    assert_eq(french["subject"], SiteText.t("mail.reset_password.title", {}, "fr"))
    assert_ne(french["subject"], english["subject"])
    assert_contains(french["links"]["reset_url"], auth_base_url() + "/fr/password/edit?token=")
    # The link's token is the account's.
    token = french["links"]["reset_url"].split("token=")[1]
    assert_eq(User.find(user._key).reset_token_digest, Crypto.sha256(token))
  end

  test("a confirmation, its link, in both languages, and none to an address confirmed already") do
    user = auth_mail_user(false)
    english = auth_letter(user, "confirm", "en")
    assert_eq(english["action"], "confirm_email")
    assert_eq(english["subject"], SiteText.t("mail.confirm_email.title", {}, "en"))
    assert_contains(english["links"]["confirm_url"], auth_base_url() + "/confirm_email?token=")
    auth_links_absolute(english)
    french = auth_letter(user, "confirm", "fr")
    assert_eq(french["subject"], SiteText.t("mail.confirm_email.title", {}, "fr"))
    assert_contains(french["links"]["confirm_url"], auth_base_url() + "/fr/confirm_email?token=")
    assert_null(AuthMailJob.due(auth_mail_user(), "confirm", {}))
  end

  test("the note of a sign-up with a taken address, in both languages") do
    user = auth_mail_user()
    english = auth_letter(user, "signup_taken", "en")
    assert_eq(english["action"], "signup_taken")
    assert_eq(english["subject"], "Your address already has an account")
    assert_eq(english["links"]["login_url"], auth_base_url() + "/login")
    assert_eq(english["links"]["reset_url"], auth_base_url() + "/password/reset")
    french = auth_letter(user, "signup_taken", "fr")
    assert_eq(french["subject"], "Votre adresse a déjà un compte")
    assert_eq(french["links"]["login_url"], auth_base_url() + "/fr/login")
    # An address whose account is not confirmed gets its link instead.
    waiting = auth_mail_user(false)
    again = auth_letter(waiting, "signup_taken", "en")
    assert_eq(again["action"], "confirm_email")
    assert_not_null(User.find(waiting._key).confirmation_token_digest)
  end

  test("the lock, a network's or the account's, for its time") do
    user = auth_mail_user()
    network = auth_letter(user, "account_locked", "en", {"lock": "source"})
    assert_eq(network["action"], "account_locked")
    assert_eq(network["lock"], "source")
    assert_eq(network["minutes"], AUTH_LOCKOUT_SECONDS / 60)
    assert_not(network["by_code"])
    assert_eq(network["subject"], SiteText.t("mail.account_locked.title", {}, "en"))
    auth_links_absolute(network)
    account = auth_letter(user, "account_locked", "fr", {
      "lock": "account",
      "by_code": true
    })
    assert_eq(account["lock"], "account")
    assert_eq(account["minutes"], AUTH_ACCOUNT_WINDOW / 60)
    assert(account["by_code"])
    assert_eq(account["links"]["reset_url"], auth_base_url() + "/fr/password/reset")
    odd = auth_letter(user, "account_locked", "en", {"lock": "anything"})
    assert_eq(odd["lock"], "source")
  end

  test("the code step's pause, after wrong two-step codes, for its time, in both languages (#538)") do
    user = auth_mail_user()
    paused = auth_letter(user, "account_locked", "fr", {
      "lock": "code",
      "by_code": true
    })
    assert_eq(paused["lock"], "code")
    assert_eq(paused["minutes"], TWO_STEP_LOCK_SECONDS / 60)
    assert(paused["by_code"])
    assert_eq(paused["links"]["reset_url"], auth_base_url() + "/fr/password/reset")
    assert_contains(SiteText.t("security_538.account_locked.code_body", {}, "en"), "was typed right")
    assert_contains(SiteText.t("security_538.account_locked.code_advice", {}, "en"), "someone has your password")
    assert_contains(SiteText.t("security_538.account_locked.code_body", {}, "fr"), "aucun code")
    assert_contains(SiteText.t("security_538.account_locked.code_advice", {}, "fr"), "quelqu'un a votre mot de passe")
  end

  test("the lock mail says the usual browser still signs in, in both languages") do
    assert_contains(SiteText.t("security_539.account_locked.source_advice", {}, "en"), "from your usual browser too")
    assert_contains(
      SiteText.t("security_539.account_locked.account_advice", {}, "en"),
      "Your usual browser still signs you in"
    )
    assert_contains(
      SiteText.t("security_539.account_locked.account_body", {}, "en"),
      "a browser you have signed in from before"
    )
    assert_contains(SiteText.t("security_539.account_locked.source_advice", {}, "fr"), "navigateur habituel")
    assert_contains(
      SiteText.t("security_539.account_locked.account_body", {}, "fr"),
      "un navigateur où vous vous êtes déjà connecté"
    )
  end

  test("writes in the request's language, English without a valid one") do
    assert_eq(AuthMailJob.locale_of({"locale": "fr"}), "fr")
    assert_eq(AuthMailJob.locale_of({"locale": "en"}), "en")
    assert_eq(AuthMailJob.locale_of({"locale": "de"}), "en")
    assert_eq(AuthMailJob.locale_of({}), "en")
  end

  test("writes in the request's language, and leaves the worker's as it found it") do
    user = auth_mail_user()
    french = AuthMailJob.prepare({
      "kind": "reset",
      "email": user.email,
      "locale": "fr"
    })
    assert_eq(french["kind"], "reset")
    assert_eq(french["user"]._key, user._key)
    assert_eq(french["letter"]["subject"], SiteText.t("mail.reset_password.title", {}, "fr"))
    assert_eq(I18n.locale(), "en", "the French job did not leave French behind")
    I18n.set_locale("fr")
    english = AuthMailJob.prepare({
      "kind": "reset",
      "email": user.email,
      "locale": "en"
    })
    assert_eq(english["letter"]["subject"], SiteText.t("mail.reset_password.title", {}, "en"))
    assert_eq(I18n.locale(), "fr", "restored to what it was")
    I18n.set_locale("en")
  end

  test("the language is put back when the job fails too") do
    I18n.set_locale("fr")
    assert_raises("on purpose") do
      AuthMailJob.in_language_of({"locale": "en"}, fn() {
        assert_eq(I18n.locale(), "en")
        throw "failed on purpose"
      })
    end
    assert_eq(I18n.locale(), "fr")
    I18n.set_locale("en")
  end

  test("sends nothing to an address without an account, nor a kind it does not know") do
    user = auth_mail_user()
    nobody_args = {
      "kind": "reset",
      "email": "nobody-#{uuid_v4}@example.com",
      "locale": "en"
    }
    assert_eq(
      AuthMailJob.prepare(nobody_args),
      {"found": false, "due": false}
    )
    # Nothing due is not a failure: the job answers, and sends nothing.
    assert_eq(
      AuthMailJob.perform_now(nobody_args),
      {
        "found": false,
        "due": false,
        "sent": false
      }
    )
    odd = AuthMailJob.perform_now({
      "kind": "unknown",
      "email": user.email,
      "locale": "en"
    })
    assert_eq(
      odd,
      {
        "found": true,
        "due": false,
        "sent": false
      }
    )
    assert_null(User.find(user._key).reset_token_digest, "no link made")
  end
end

# A mail that cannot leave fails the job, and the queue tries it again
# (#671); the attempts of one letter carry one link, never a new one that
# would kill the link of a mail that left all the same (#671's review).
describe("AuthMailJob, a mail that could not leave") do
  before_each() do
    I18n.set_locale("en")
  end

  test("fails the job, with the mail server's own words; sent, it answers so") do
    user = auth_mail_user()
    args = auth_mail_args(user, "reset")
    links = []
    error = assert_raises("reset email could not be sent: ") do
      auth_mail_attempt(args, true, links)
    end
    assert_contains(error, "550 mailbox unavailable")
    assert_eq(links.length, 1, "the message was built")
    sent = auth_mail_attempt(args, false, links)
    assert_eq(
      sent,
      {
        "found": true,
        "due": true,
        "sent": true
      }
    )
  end

  test("every retry of a reset carries the first attempt's link, which stays good") do
    user = auth_mail_user()
    args = auth_mail_args(user, "reset")
    links = []
    assert_raises("could not be sent") do
      auth_mail_attempt(args, true, links)
    end
    first = User.find(user._key)
    assert_raises("could not be sent") do
      auth_mail_attempt(args, true, links)
    end
    auth_mail_attempt(args, false, links)
    assert_eq(links.length, 3)
    assert_eq(links[1], links[0], "the second attempt's link")
    assert_eq(links[2], links[0], "the one that left")
    stored = User.find(user._key)
    assert_eq(stored.reset_token_digest, first.reset_token_digest, "the first link is the account's")
    assert_eq(stored.reset_token_digest, Crypto.sha256(links[0].split("token=")[1]))
    assert_eq(stored.reset_sent_at, first.reset_sent_at, "its time unchanged")
    assert_eq(stored.reset_letter, args["letter"])
  end

  test("a confirmation link too") do
    user = auth_mail_user(false)
    args = auth_mail_args(user, "confirm")
    links = []
    assert_raises("confirm email could not be sent") do
      auth_mail_attempt(args, true, links)
    end
    auth_mail_attempt(args, false, links)
    assert_eq(links[1], links[0])
    assert_eq(User.find(user._key).confirmation_token_digest, Crypto.sha256(links[0].split("token=")[1]))
  end

  test("a retry after the link was followed sends nothing, and makes none") do
    user = auth_mail_user()
    args = auth_mail_args(user, "reset")
    links = []
    assert_raises("could not be sent") do
      auth_mail_attempt(args, true, links)
    end
    User.find(user._key).finish_password_reset("another long password")
    assert_eq(
      auth_mail_attempt(args, false, links),
      {
        "found": true,
        "due": false,
        "sent": false
      }
    )
    assert_eq(links.length, 1, "no second mail")
    assert_null(User.find(user._key).reset_token_digest, "no link made")
  end

  test("an older letter retried after a newer one sends nothing: the newer link stays") do
    user = auth_mail_user()
    older = auth_mail_args(user, "reset")
    sleep(0.01)
    newer = auth_mail_args(user, "reset")
    assert(older["letter"] < newer["letter"], "letters are time-ordered")
    links = []
    assert_raises("could not be sent") do
      auth_mail_attempt(older, true, links)
    end
    auth_mail_attempt(newer, false, links)
    assert_ne(links[1], links[0], "a newer letter, a new link")
    assert_eq(auth_mail_attempt(older, false, links)["due"], false)
    assert_eq(links.length, 2)
    assert_eq(User.find(user._key).reset_token_digest, Crypto.sha256(links[1].split("token=")[1]))
  end

  test("a letter's token is the key's: another key, another token; none without") do
    letter = uuid_v7()
    one = AuthMailJob.letter_token(letter, "a key")
    assert_eq(AuthMailJob.letter_token(letter, "a key"), one)
    assert_ne(AuthMailJob.letter_token(letter, "another key"), one)
    assert_ne(AuthMailJob.letter_token(uuid_v7(), "a key"), one)
    assert_null(AuthMailJob.letter_token(letter, ""))
  end

  test("without a key, the first attempt makes a link, and a retry fails rather than kill it") do
    user = auth_mail_user()
    args = auth_mail_args(user, "reset")
    token = AuthMailJob.link_token(User.find(user._key), "reset", args, "")
    assert_eq(User.find(user._key).reset_token_digest, Crypto.sha256(token))
    assert_raises("cannot be made again without SOLI_ENCRYPTION_KEY") do
      AuthMailJob.link_token(User.find(user._key), "reset", args, "")
    end
    assert_eq(User.find(user._key).reset_token_digest, Crypto.sha256(token), "the first link still good")
    # Followed, nothing is due: no failure.
    User.find(user._key).finish_password_reset("another long password")
    assert_null(AuthMailJob.link_token(User.find(user._key), "reset", args, ""))
  end

  test("a job queued before letters had an id still makes its link") do
    user = auth_mail_user()
    args = {
      "kind": "reset",
      "email": user.email,
      "locale": "en"
    }
    token = AuthMailJob.link_token(User.find(user._key), "reset", args)
    stored = User.find(user._key)
    assert_eq(stored.reset_token_digest, Crypto.sha256(token))
    assert_null(stored.reset_letter)
  end
end
