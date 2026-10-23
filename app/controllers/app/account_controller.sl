# The signed-in person's account: who they are, a new password, two-step
# sign-in, an AI key for reading photos, leaving. Behind `require_login`.
class AppAccountController < AppBaseController
  # GET /app/account
  def show
    @user = current_user()
    @title = "Account"
    @description = "Your EUI Score account."
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
      @description = "Your EUI Score account."
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
      @description = "Your EUI Score account."
      @error = ""
      return render("app/account/show", {}, {"status": 422})
    end

    flash("notice", "Photos are now read with your #{ScoreReader.provider_name(this.user.ai_provider)} key.")
    redirect(app_account_path())
  end

  # POST /app/account/ai/remove — back to the site's own AI, if it has one
  def forget_ai_key
    current_user().forget_ai_key()
    flash("notice", "Your AI key is removed.")
    redirect(app_account_path())
  end

  # DELETE /app/account — the password confirms it
  def destroy
    @user = current_user()
    unless @user.authenticate(params["password"].to_s)
      @title = "Account"
      @error = "That is not your password: the account is still here."
      return render("app/account/show", {}, {"status": 422})
    end

    Score.delete_all_of(@user)
    @user.delete
    session_destroy()
    flash("notice", "Your account is deleted.")
    redirect(app_home_path())
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
