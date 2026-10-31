# The signed-in person's account: who they are, a new password, two-step
# sign-in, an AI key for photos and the assistant, leaving. Behind `require_login`.
class AppAccountController < AppBaseController
  # GET /app/account
  def show
    @user = current_user()
    @title = "Account"
    @description = "Your Score account."
    @error = ""
  end

  # POST /app/account/password — the current password, then the new one twice
  def password
    @user = current_user()
    @error = @user.password_change_error(
      params["current_password"],
      params["password"],
      params["password_confirmation"]
    )
    unless @error.nil?
      @title = "Account"
      return render("app/account/show", {}, {"status": 422})
    end

    @user.change_password(params["password"].to_s)
    # This browser stays signed in, on the new version.
    session_regenerate()
    session_set("user_id", @user["_key"])
    session_set("session_version", @user.current_session_version())
    flash("notice", "Password changed. Your other browsers are signed out.")
    redirect(app_account_path())
  end

  # POST /app/account/two-step — a new secret for an authenticator app, to confirm
  def two_step
    @user = current_user()
    return redirect(app_account_path()) if @user.two_step?() || !User.two_step_available?()

    @_show_enrolment(@user.start_two_step(), "")
  end

  # POST /app/account/two-step/confirm — a first code from the app turns it on
  def confirm_two_step
    @user = current_user()
    secret = @user.pending_two_step()
    return redirect(app_account_path()) if secret.nil?

    codes = @user.confirm_two_step(params["code"])
    wrong = "That code is not the app's: check its clock, and type the code it shows now."
    return @_show_enrolment(secret, wrong) if codes.nil?

    @codes = codes
    @title = "Your backup codes"
    @description = "The codes that sign you in without your phone."
    render("app/account/backup_codes")
  end

  # POST /app/account/two-step/stop — the password and a code turn it off
  def stop_two_step
    @user = current_user()
    unless @user.authenticate(params["password"].to_s) && @user.second_step?(params["code"])
      @title = "Account"
      @description = "Your Score account."
      @error = "Two-step sign-in is still on: that password or that code is not right."
      return render("app/account/show", {}, {"status": 422})
    end

    @user.stop_two_step()
    flash("notice", "Two-step sign-in is off.")
    redirect(app_account_path())
  end

  # POST /app/account/ai — a provider, a model and an API key of one's own
  def ai_key
    @user = current_user()
    @ai_error = @user.keep_ai_key(params["provider"], params["model"], params["key"]).to_s
    unless @ai_error.blank?
      @title = "Account"
      @description = "Your Score account."
      @error = ""
      return render("app/account/show", {}, {"status": 422})
    end

    flash("notice", "The AI features now use your #{AiClient.provider_name(this.user.ai_provider)} key.")
    redirect(app_account_path())
  end

  # POST /app/account/ai/remove — the key forgotten: no AI until another one
  def forget_ai_key
    current_user().forget_ai_key()
    flash("notice", "Your AI key is removed.")
    redirect(app_account_path())
  end

  # POST /app/account/notifications — the e-mails wanted: `kinds[]` checked
  # (NOTIFICATION_KINDS); those left out are not sent, and stay in the app
  def notifications
    wanted = params["kinds"] ?? []
    wanted = [wanted] unless wanted.is_a?("array")
    current_user().keep_mail_prefs(wanted.filter(&{ |kind|
      NOTIFICATION_KINDS.includes?(kind)
    }))
    flash("notice", "Your e-mail settings are saved.")
    redirect(app_account_path() + "#notifications")
  end

  # POST /app/account/push — `kinds[]`, the push notifications wanted (#400)
  def push_prefs
    wanted = params["kinds"] ?? []
    wanted = [wanted] unless wanted.is_a?("array")
    current_user().keep_push_prefs(wanted.filter(&{ |kind|
      NOTIFICATION_KINDS.includes?(kind)
    }))
    flash("notice", "Your push notification settings are saved.")
    redirect(app_account_path() + "#push")
  end

  # DELETE /app/account — the password confirms it
  def destroy
    @user = current_user()
    unless @user.authenticate(params["password"].to_s)
      @title = "Account"
      @error = "That is not your password: the account is still here."
      return render("app/account/show", {}, {"status": 422})
    end

    @user.erase_account
    session_destroy()
    session_regenerate()
    # "signed_out": the layout clears what this browser kept of the app.
    flash("signed_out", "Your account is deleted.")
    redirect(app_home_path())
  end

  # POST /app/account/export — a zip of everything in the account (?part=N
  # of a big one: AccountExport)
  def download_data
    user = current_user()
    unless AccountExport.allowed?(user)
      @export_error = "You have downloaded your data #{EXPORTS_PER_WINDOW} times this hour: try again in an hour."
      return @_refuse(user, "", 429)
    end

    parts = AccountExport.parts(user)
    number = params["part"].blank? ? 1 : params["part"].to_s.to_i
    halt(404, "That part of the export does not exist.") if number < 1 || number > parts.length

    now = DateTime.utc.to_unix
    name = "eui-score-#{DateTime.from_unix(now).to_iso.substring(0, 10)}"
    name = "#{name}-part-#{number}-of-#{parts.length}" if parts.length > 1
    {
      "status": 200,
      "headers": {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=\"#{name}.zip\"",
        "Cache-Control": "no-store"
      },
      "body": AccountExport.zip(user, parts, number, now)
    }
  end

  # POST /app/account/email — a new address, with the password (and a code,
  # with two-step sign-in on): a link goes to it, a notice to the old one
  def change_email
    user = current_user()
    unless User.email_change_allowed?(user)
      wait = "You have asked to change your address #{EMAIL_CHANGES_PER_HOUR} times this hour: try again in an hour."
      return @_refuse(user, wait, 429)
    end

    error = user.email_change_error(params["email"], params["password"], params["code"])
    return @_refuse(user, error, 422) unless error.nil?
    unless User.account_email_allowed?(params["email"], client_ip(req))
      return @_refuse(user, AUTH_EMAILS_REFUSED, 429)
    end

    token = user.start_email_change(params["email"])
    sent = MailDelivery.attempt("email change", fn() { AuthMailer.confirm_new_email(user, token) })
    unless sent
      user.forget_email_change()
      user.update()
      return @_refuse(
        user,
        "The email to #{params["email"].to_s.trim} could not be sent: try again in a moment.",
        503
      )
    end

    MailDelivery.attempt("email change notice", fn() { AuthMailer.email_change_requested(user) })
    flash(
      "notice",
      "A link is on its way to #{user.email_change_to}: follow it within a day to use that address."
      + " Until then, your address is still #{user.email}."
    )
    redirect(app_account_path())
  end

  # POST /app/account/email/cancel — the change under way dropped: its link stops working
  def cancel_email_change
    user = current_user()
    user.forget_email_change()
    user.update()
    flash("notice", "The change of address is cancelled: the link sent stops working.")
    redirect(app_account_path())
  end

  # The account page again, saying why the change of address or the export
  # was refused.
  def _refuse(user, message, status)
    @user = user
    @title = "Account"
    @description = "Your Score account."
    @error = ""
    @email_error = message
    @typed_email = params["email"].to_s.trim
    render("app/account/show", {}, {"status": status})
  end

  # The page that sets an authenticator app up: the QR code and the secret.
  def _show_enrolment(secret, error)
    @secret = secret
    @uri = @user.two_step_uri(secret)
    @error = error
    @title = "Two-step sign-in"
    @description = "Sign in with a code from your phone, too."
    render("app/account/two_step", {}, {"status": error.blank? ? 200 : 422})
  end
end
