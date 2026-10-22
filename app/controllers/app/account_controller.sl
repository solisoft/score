# The signed-in person's account: who they are, a new password, leaving.
# Behind `require_login`.
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
end
