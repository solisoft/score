# The account e-mails AuthMailJob sends (#539), off the request that asked:
# each kind's mail, in the language of that request, its links absolute (to
# the site's own address), and the language it chose not left behind for
# the next job the worker runs.
#
# `soli test` loads no mailer (app/mailers) in the spec's process, and
# imports none either, so the message itself is not rendered here: what the
# job decides — the mail due, its subject and links in the request's
# language (AuthMailJob.letter, which AuthMailer only copies into its view)
# — is what these specs read.

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
    "locale": locale
  }.merge(extra)
  previous = I18n.locale()
  I18n.set_locale(AuthMailJob.locale_of(args))
  due = AuthMailJob.due(User.find(user._key), kind, args)
  assert_not_null(due, "#{kind} due")
  letter = AuthMailJob.letter(User.find(user._key), due)
  I18n.set_locale(previous)
  letter
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

  test("leaves the worker's language as it found it") do
    user = auth_mail_user()
    AuthMailJob.perform_now({
      "kind": "reset",
      "email": user.email,
      "locale": "fr"
    })
    assert_eq(I18n.locale(), "en", "the French job did not leave French behind")
    I18n.set_locale("fr")
    done = AuthMailJob.perform_now({
      "kind": "reset",
      "email": user.email,
      "locale": "en"
    })
    assert(done["due"])
    assert_eq(I18n.locale(), "fr", "restored to what it was")
    I18n.set_locale("en")
  end

  test("sends nothing to an address without an account, nor a kind it does not know") do
    user = auth_mail_user()
    nobody = AuthMailJob.perform_now({
      "kind": "reset",
      "email": "nobody-#{uuid_v4}@example.com",
      "locale": "en"
    })
    assert_eq(
      nobody,
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
    assert(odd["found"])
    assert_not(odd["due"])
    assert_null(User.find(user._key).reset_token_digest, "no link made")
  end
end
