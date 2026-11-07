# The account e-mails, built and handed to delivery where they really are:
# by the test server's job worker (#671). The spec's own process loads no
# mailer and no mail view (auth_mail_job_spec reads the job's decisions
# there), so a job run here would prove nothing of the message; the queued
# job is the server's, and its row says how it went: "done" once the mail
# left, "failed" with the error when AuthMailer could not build or send it
# (AuthMailJob.send_for). Each mail's subject and link, as it left, are
# tests/mail/account_mail_inbox_spec's.

const ACCOUNT_MAIL_PASSWORD = "correct horse battery"
# The states a job's row ends in: its mail left, or will be tried again, or
# never will.
const ACCOUNT_MAIL_JOB_FINISHED = [
  "done",
  "failed",
  "dead"
]

def account_mail_user(confirmed = true)
  user = User.new()
  user.email = "account-mail-#{uuid_v4}@example.com"
  user.set_password(ACCOUNT_MAIL_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix if confirmed
  user.save
  user
end

# The AuthMailJob row of `kind` queued for `email`, once the server's worker
# has finished with it (ten seconds at most): read from the queue itself,
# not Job.list, which stops at its 500 oldest rows.
def account_mail_job(email, kind)
  tries = 0
  while tries < 80
    rows = @sdbql{
      FOR job IN _jobs
      FILTER job.handler == "AuthMailJob" AND job.args.email == #{email} AND job.args.kind == #{kind}
      RETURN job
    }
    assert_eq(type(rows), "array", "the queue answers: #{rows}")
    return rows[0] if rows.length > 0 && ACCOUNT_MAIL_JOB_FINISHED.includes?(rows[0]["state"])

    sleep(0.125)
    tries += 1
  end
  nil
end

# The job of `kind` for `email` ran once, and its mail left.
def account_mail_left(email, kind)
  job = account_mail_job(email, kind)
  assert_not_null(job, "the server's worker ran the #{kind} job")
  assert_null(job["last_error"], "#{kind}: #{job["last_error"]}")
  assert_eq(job["state"], "done", kind)
  assert_eq(job["attempts"], 1, kind)
end

describe("The account e-mails, as the server's worker sends them") do
  before_each() do
    as_guest()
    clear_cookies()
    I18n.set_locale("en")
  end

  test("a password reset, asked in French") do
    user = account_mail_user()
    assert_eq(res_status(post("/fr/password/reset", {"email": user.email})), 200)
    account_mail_left(user.email, "reset")
    assert_not_null(User.find(user._key).reset_token_digest, "the link the mail carries")
  end

  test("a confirmation link sent again") do
    user = account_mail_user(false)
    assert_eq(res_status(post("/confirmation/resend", {"email": user.email})), 200)
    account_mail_left(user.email, "confirm")
    assert_not_null(User.find(user._key).confirmation_token_digest)
  end

  test("the note to the owner of an address someone signed up with") do
    user = account_mail_user()
    AuthMailJob.ask("signup_taken", user.email)
    account_mail_left(user.email, "signup_taken")
  end

  test("the note that signing in was locked, each kind of lock") do
    user = account_mail_user()
    AuthMailJob.ask("account_locked", user.email, {
      "lock": "source",
      "by_code": false
    })
    account_mail_left(user.email, "account_locked")
    other = account_mail_user()
    AuthMailJob.ask("account_locked", other.email, {
      "lock": "code",
      "by_code": true
    })
    account_mail_left(other.email, "account_locked")
  end

  test("nothing to send is not a failure: an unknown address, a confirmed one") do
    nobody = "nobody-#{uuid_v4}@example.com"
    post("/password/reset", {"email": nobody})
    account_mail_left(nobody, "reset")
    confirmed = account_mail_user()
    post("/confirmation/resend", {"email": confirmed.email})
    account_mail_left(confirmed.email, "confirm")
    assert_null(User.find(confirmed._key).confirmation_token_digest, "no link made")
  end
end
