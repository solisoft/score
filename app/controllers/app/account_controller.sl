# The signed-in person's account: who they are, a new password, two-step
# sign-in, an AI key for photos and the assistant, leaving. Behind `require_login`.
class AppAccountController < AppBaseController
  # GET /app/account
  def show
    @user = current_user()
    @title = SiteText.t("app.account.page_title")
    @description = SiteText.t("app.account.page_description")
    @error = ""
    @tokens = AccessToken.of(@user)
    base = auth_base_url()
    @mcp_url = base + "/mcp"
  end

  # POST /app/account/tokens — a personal access token named `name`, for the
  # MCP server, with the password (#539): shown once, on the page this
  # answers (#460)
  def create_token
    @user = current_user()
    @title = SiteText.t("app.account.page_title")
    @description = SiteText.t("app.account.page_description")
    @error = ""
    if @user.password_tries_spent?
      @token_error = @_tries_spent_message
      @tokens = AccessToken.of(@user)
      return render("app/account/show", {}, {"status": 429})
    end

    made = {"error": SiteText.t("security_539.token_password")}
    made = AccessToken.issue(@user, params["name"]) if @user.confirms_password?(params["password"])
    @tokens = AccessToken.of(@user)
    unless made["error"].nil?
      @token_error = made["error"]
      return render("app/account/show", {}, {"status": 422})
    end

    # The secret, on this page only: never in the session, never again.
    @new_token = made["token"]
    base = auth_base_url()
    @mcp_url = base + "/mcp"
    render("app/account/show")
  end

  # POST /app/account/tokens/:id/revoke — the token stops working at once
  def revoke_token
    revoked = AccessToken.revoke(current_user(), params["id"])
    halt(404, SiteText.t("app.account.no_token")) unless revoked

    flash("notice", SiteText.t("app.account.token_revoked"))
    account = app_account_path()
    redirect(account + "#tokens")
  end

  # POST /app/account/password — the current password, then the new one twice
  def password
    @user = current_user()
    return @_refuse_tries if @user.password_tries_spent?

    @error = @user.password_change_error(
      params["current_password"],
      params["password"],
      params["password_confirmation"]
    )
    unless @error.nil?
      @title = SiteText.t("app.account.page_title")
      return render("app/account/show", {}, {"status": 422})
    end

    @user.change_password(params["password"].to_s)
    # This browser stays signed in, on the new version.
    session_regenerate()
    session_set("user_id", @user["_key"])
    session_set("session_version", @user.current_session_version())
    # Still a browser the account knows: the new password voided the others.
    set_cookie("device", @user.device_cookie, User.device_cookie_options)
    flash("notice", SiteText.t("security_539.password_changed"))
    redirect(app_account_path())
  end

  # POST /app/account/two-step — the password, then a new secret for an
  # authenticator app, to confirm. The password (#538): a browser left signed
  # in must not be enough to tie the account to someone else's app.
  def two_step
    @user = current_user()
    return redirect(app_account_path()) if @user.two_step?() || !User.two_step_available?()
    return @_refuse_two_step(@_tries_spent_message, 429) if @user.password_tries_spent?
    unless @user.confirms_password?(params["password"])
      return @_refuse_two_step(SiteText.t("security_538.two_step_password"), 422)
    end

    @_show_enrolment(@user.start_two_step(), "")
  end

  # POST /app/account/two-step/confirm — a first code from the app turns it
  # on: within TWO_STEP_PENDING_SECONDS of the setup, each code counted
  # (#687, User#confirm_two_step)
  def confirm_two_step
    @user = current_user()
    if @user.two_step_setup_expired?
      expired = SiteText.t("security_687.enrol_expired", {"minutes": TWO_STEP_PENDING_SECONDS / 60})
      return @_refuse_two_step(expired, 422)
    end

    secret = @user.pending_two_step()
    return redirect(app_account_path()) if secret.nil?

    if @user.codes_locked?
      paused = SiteText.t("security_538.too_many_codes", {"minutes": TWO_STEP_LOCK_SECONDS / 60})
      return @_show_enrolment(secret, paused, 429)
    end

    codes = @user.confirm_two_step(params["code"])
    wrong = SiteText.t("app.account.enrol_wrong_code")
    return @_show_enrolment(secret, wrong) if codes.nil?

    # Every other browser is signed out (User#confirm_two_step, #538); this
    # one stays, on the new version, and is still one the account knows (the
    # new version voided every `device` cookie given before).
    session_regenerate()
    session_set("user_id", @user["_key"])
    session_set("session_version", @user.current_session_version())
    set_cookie("device", @user.device_cookie, User.device_cookie_options)
    # A right code, given in this session: as good as a code sign-in (#544).
    SecondStep.mark(@user)
    @codes = codes
    @title = SiteText.t("app.account.backup_title")
    @description = SiteText.t("app.account.backup_description")
    render("app/account/backup_codes")
  end

  # POST /app/account/two-step/stop — the password and a code turn it off
  # (a wrong code counted, #538: User#confirms_with_code?)
  def stop_two_step
    @user = current_user()
    return @_refuse_tries if @user.password_tries_spent?

    unless @user.confirms_with_code?(params["password"], params["code"])
      @title = SiteText.t("app.account.page_title")
      @description = SiteText.t("app.account.page_description")
      @error = SiteText.t("app.account.two_step_still_on")
      return render("app/account/show", {}, {"status": 422})
    end

    @user.stop_two_step()
    flash("notice", SiteText.t("app.account.two_step_stopped"))
    redirect(app_account_path())
  end

  # POST /app/account/ai — a provider, a model and an API key of one's own
  def ai_key
    @user = current_user()
    @ai_error = @user.keep_ai_key(params["provider"], params["model"], params["key"]).to_s
    unless @ai_error.blank?
      @title = SiteText.t("app.account.page_title")
      @description = SiteText.t("app.account.page_description")
      @error = ""
      return render("app/account/show", {}, {"status": 422})
    end

    flash("notice", SiteText.t("app.account.ai_saved", {"provider": AiClient.provider_name(@user.ai_provider)}))
    redirect(app_account_path())
  end

  # POST /app/account/ai/remove — the key forgotten: no AI until another one
  def forget_ai_key
    current_user().forget_ai_key()
    flash("notice", SiteText.t("app.account.ai_removed"))
    redirect(app_account_path())
  end

  # POST /app/account/language — `locale`, "en" or "fr": the app's language
  # on this browser, and the account's on the next one (#505)
  def language
    locale = params["locale"].to_s
    return redirect(app_account_path()) unless SITE_LOCALES.includes?(locale)

    set_cookie("locale", locale)
    I18n.set_locale(locale)
    AppLocale.remember(current_user(), locale)
    flash("notice", SiteText.t("app.account.language_saved"))
    redirect(app_account_path() + "#language")
  end

  # POST /app/account/notifications — the e-mails wanted: `kinds[]` checked
  # (NOTIFICATION_KINDS); those left out are not sent, and stay in the app
  def notifications
    wanted = params["kinds"] ?? []
    wanted = [wanted] unless wanted.is_a?("array")
    current_user().keep_mail_prefs(wanted.filter(&{ |kind|
      NOTIFICATION_KINDS.includes?(kind)
    }))
    flash("notice", SiteText.t("app.account.mails_saved"))
    redirect(app_account_path() + "#notifications")
  end

  # POST /app/account/push — `kinds[]`, the push notifications wanted (#400)
  def push_prefs
    wanted = params["kinds"] ?? []
    wanted = [wanted] unless wanted.is_a?("array")
    current_user().keep_push_prefs(wanted.filter(&{ |kind|
      NOTIFICATION_KINDS.includes?(kind)
    }))
    flash("notice", SiteText.t("app.account.push_saved"))
    redirect(app_account_path() + "#push")
  end

  # DELETE /app/account — the password confirms it, and a code with two-step
  # sign-in on (#538), as turning that off asks
  def destroy
    @user = current_user()
    return @_refuse_tries if @user.password_tries_spent?

    unless @user.confirms_password?(params["password"], !@user.two_step?)
      @title = SiteText.t("app.account.page_title")
      @description = SiteText.t("app.account.page_description")
      @error = SiteText.t("app.account.not_your_password")
      return render("app/account/show", {}, {"status": 422})
    end
    # The code counted, and the tries started again only once it is right
    # too (User#confirms_with_code?).
    if @user.two_step?
      unless @user.second_step_counted?(params["code"])
        @title = SiteText.t("app.account.page_title")
        @description = SiteText.t("app.account.page_description")
        @error = SiteText.t("security_538.delete_wrong_code")
        return render("app/account/show", {}, {"status": 422})
      end

      @user.passed_confirmation
    end

    @user.erase_account
    session_destroy()
    session_regenerate()
    # "signed_out": the layout clears what this browser kept of the app.
    flash("signed_out", SiteText.t("app.account.account_deleted"))
    redirect(app_home_path())
  end

  # POST /app/account/export — a zip of everything in the account (?part=N
  # of a big one: AccountExport). Asked for without a part, a big one is
  # listed first, part by part, on the account page (#689).
  def download_data
    user = current_user()
    parts = nil
    if params["part"].blank?
      parts = AccountExport.parts(user)
      return @_export_parts(user, parts.length) if parts.length > 1
    end

    unless AccountExport.allowed?(user)
      @export_error = SiteText.t("app.account.exports_too_many", {"n": EXPORTS_PER_WINDOW})
      return @_refuse(user, "", 429)
    end

    parts ||= AccountExport.parts(user)
    number = params["part"].blank? ? 1 : params["part"].to_s.to_i
    halt(404, SiteText.t("app.account.export_no_part")) if number < 1 || number > parts.length

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
      wait = SiteText.t("app.account.email_changes_too_many", {"n": EMAIL_CHANGES_PER_HOUR})
      return @_refuse(user, wait, 429)
    end

    error = user.email_change_error(params["email"], params["password"], params["code"])
    return @_refuse(user, error, 422) unless error.nil?
    unless User.account_email_allowed?(params["email"], client_ip(req))
      return @_refuse(user, SiteText.t("app.account.emails_refused"), 429)
    end

    token = user.start_email_change(params["email"])
    sent = MailDelivery.attempt("email change", fn() { AuthMailer.confirm_new_email(user, token) })
    unless sent
      user.forget_email_change()
      user.update()
      return @_refuse(user, SiteText.t("app.account.email_not_sent", {"email": params["email"].to_s.trim}), 503)
    end

    MailDelivery.attempt("email change notice", fn() { AuthMailer.email_change_requested(user) })
    flash("notice", SiteText.t(
      "app.account.email_link_sent",
      {"new_email": user.email_change_to, "email": user.email}
    ))
    redirect(app_account_path())
  end

  # POST /app/account/email/cancel — the change under way dropped: its link stops working
  def cancel_email_change
    user = current_user()
    user.forget_email_change()
    user.update()
    flash("notice", SiteText.t("app.account.email_change_cancelled"))
    redirect(app_account_path())
  end

  # The account page again, saying why the change of address or the export
  # was refused.
  def _refuse(user, message, status)
    @user = user
    @title = SiteText.t("app.account.page_title")
    @description = SiteText.t("app.account.page_description")
    @error = ""
    @email_error = message
    @typed_email = params["email"].to_s.trim
    render("app/account/show", {}, {"status": status})
  end

  # The account page again, its export in `count` parts, each to download.
  def _export_parts(user, count)
    @user = user
    @title = SiteText.t("app.account.page_title")
    @description = SiteText.t("app.account.page_description")
    @error = ""
    @tokens = AccessToken.of(user)
    @mcp_url = auth_base_url() + "/mcp"
    @export_parts = count
    render("app/account/show")
  end

  # The account page again, when the wrong passwords typed lately leave no
  # try (#539): nothing is checked, the right password included.
  def _refuse_tries
    @title = SiteText.t("app.account.page_title")
    @description = SiteText.t("app.account.page_description")
    @error = @_tries_spent_message
    render("app/account/show", {}, {"status": 429})
  end

  # The account page again, saying why two-step sign-in was not turned on
  # (#538): next to its form.
  def _refuse_two_step(message, status)
    @title = SiteText.t("app.account.page_title")
    @description = SiteText.t("app.account.page_description")
    @error = ""
    @two_step_error = message
    render("app/account/show", {}, {"status": status})
  end

  def _tries_spent_message
    SiteText.t("security_539.tries_spent", {"minutes": ACCOUNT_PASSWORD_WINDOW / 60})
  end

  # The page that sets an authenticator app up: the QR code and the secret.
  def _show_enrolment(secret, error, status = nil)
    @secret = secret
    @uri = @user.two_step_uri(secret)
    @error = error
    @title = SiteText.t("app.account.enrol_title")
    @description = SiteText.t("app.account.enrol_description")
    render("app/account/two_step", {}, {"status": status ?? (error.blank? ? 200 : 422)})
  end
end
