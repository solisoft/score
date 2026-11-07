# The e-mails as they left (#671): their recipient, subject and link, read
# where a `--dev` server keeps every mail it delivers — the dev inbox, held
# in the test database's `_soli_mail_inbox` too. Only a `--dev` test server
# keeps it, so CI runs this file on its own:
#
#   SOLI_TEST_SERVER_DEV=1 soli test tests/mail --no-coverage
#
# and the ordinary suite, whose test server runs without `--dev`, skips it
# (tests/controllers/account_mail_spec proves the same mails left there).
# The spec's own process could not build them: it loads no mailer and no
# mail view (auth_mail_job_spec).

const INBOX_PASSWORD = "correct horse battery"

def inbox_user(confirmed = true)
  user = User.new()
  user.email = "inbox-#{uuid_v4}@example.com"
  user.set_password(INBOX_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix if confirmed
  user.save
  user
end

# The mails delivered to `email` so far, newest first.
def inbox_rows(email)
  rows = @sdbql{
    FOR entry IN _soli_mail_inbox
    FILTER #{email} IN entry.mail.to
    SORT entry.seq DESC
    RETURN entry.mail
  }
  # An "Error: …" string until the first mail creates the collection.
  type(rows) == "array" ? rows : []
end

# The mails delivered to `email`, once there is one (ten seconds at most:
# the account mails leave from the server's job worker).
def inbox_mails(email)
  tries = 0
  while tries < 80
    rows = inbox_rows(email)
    return rows if rows.length > 0

    sleep(0.125)
    tries += 1
  end
  []
end

# The state the AuthMailJob of `kind` for `email` ended in, once the
# server's worker has finished with it (ten seconds at most), or nil.
def inbox_job_state(email, kind)
  tries = 0
  while tries < 80
    rows = @sdbql{
      FOR job IN _jobs
      FILTER job.handler == "AuthMailJob" AND job.args.email == #{email} AND job.args.kind == #{kind}
      RETURN job.state
    }
    assert_eq(type(rows), "array", "the queue answers: #{rows}")
    if rows.length > 0 && [
      "done",
      "failed",
      "dead"
    ].includes?(rows[0])
      return rows[0]
    end

    sleep(0.125)
    tries += 1
  end
  nil
end

# The one mail delivered to `email`.
def inbox_mail(email)
  mails = inbox_mails(email)
  assert_eq(mails.length, 1, "one mail to #{email}")
  mail = mails[0]
  assert_eq(mail["to"], [email])
  assert_eq(mail["error"], nil)
  mail
end

# The token of the link to `path` (absolute, on the site's own address) in
# `mail`.
def inbox_token(mail, path)
  link = auth_base_url() + path + "?token="
  assert_contains(mail["html"], link)
  mail["html"].split(link)[1].split("\"")[0]
end

describe("The e-mails as they left") do
  before_each() do
    skip("needs a --dev test server: SOLI_TEST_SERVER_DEV=1") unless getenv("SOLI_TEST_SERVER_DEV") == "1"
    as_guest()
    clear_cookies()
    I18n.set_locale("en")
  end

  test("a password reset asked in French: in French, with its link") do
    user = inbox_user()
    post("/fr/password/reset", {"email": user.email})
    mail = inbox_mail(user.email)
    assert_eq(mail["subject"], "Réinitialisez votre mot de passe")
    assert_contains(mail["html"], "le mot de passe de <strong>#{user.email}</strong>")
    token = inbox_token(mail, "/fr/password/edit")
    assert_eq(Crypto.sha256(token), User.find(user._key).reset_token_digest, "the account's link")
  end

  test("a confirmation link sent again, in English") do
    user = inbox_user(false)
    post("/confirmation/resend", {"email": user.email})
    mail = inbox_mail(user.email)
    assert_eq(mail["subject"], "Confirm your email address")
    token = inbox_token(mail, "/confirm_email")
    assert_eq(Crypto.sha256(token), User.find(user._key).confirmation_token_digest)
  end

  test("the note to the owner of an address someone signed up with") do
    user = inbox_user()
    I18n.set_locale("fr")
    AuthMailJob.ask("signup_taken", user.email)
    I18n.set_locale("en")
    mail = inbox_mail(user.email)
    assert_eq(mail["subject"], "Votre adresse a déjà un compte")
    assert_contains(mail["html"], "href=\"#{auth_base_url}/fr/login\"")
    assert_contains(mail["html"], "href=\"#{auth_base_url}/fr/password/reset\"")
  end

  test("the note that signing in was locked, for its time") do
    user = inbox_user()
    AuthMailJob.ask("account_locked", user.email, {
      "lock": "account",
      "by_code": false
    })
    mail = inbox_mail(user.email)
    assert_eq(mail["subject"], SiteText.t("mail.account_locked.title", {}, "en"))
    assert_contains(mail["html"], "#{AUTH_ACCOUNT_WINDOW / 60} minutes")
    assert_contains(mail["html"], "href=\"#{auth_base_url}/password/reset\"")
  end

  test("nothing to an address without an account") do
    nobody = "nobody-#{uuid_v4}@example.com"
    post("/password/reset", {"email": nobody})
    # Read once its own job is done: the server's workers run jobs side by
    # side, so another job's mail arriving says nothing of this one.
    assert_eq(inbox_job_state(nobody, "reset"), "done")
    assert_eq(inbox_rows(nobody), [])
  end

  test("an invitation to a score: who shared what, and the link to open it") do
    owner = inbox_user()
    invitee = "invited-#{uuid_v4}@example.com"
    score = Score.start(owner, Score.blank_source("Inbox chorale"))
    post(
      "/login",
      {"email": owner.email, "password": INBOX_PASSWORD}
    )
    invited = post(
      "/app/scores/#{score._key}/invitations",
      {"email": invitee, "role": "read"}
    )
    assert_eq(res_status(invited), 302)
    mail = inbox_mail(invitee)
    assert_eq(mail["subject"], "#{owner.email} shared “Inbox chorale” with you")
    assert_contains(mail["html"], "href=\"#{auth_base_url}/app/scores/#{score._key}\"")
    assert_contains(mail["html"], "href=\"#{auth_base_url}/signup\"")
  end
end
