# The account page's change of address in a real browser (soli test
# --browser), without JavaScript of its own: the form, the notice, the link
# from the mail and its button, and the account under its new address.

const MOVE_PASSWORD = "correct horse battery"

def move_user
  user = User.new()
  user.email = "move-#{uuid_v4}@example.com"
  user.set_password(MOVE_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

# Sends the form whose action is `action`, as its button does. (The form is
# low on the account page: a click by position lands mid-scroll.)
def send_form(action)
  evaluate("document.querySelector('form[action=\"#{action}\"] button[type=submit]').click()")
end

describe("Changing one's email address") do
  test("asked on the account page, confirmed from the link, signed in still") do
    user = move_user()
    new_email = "moved-#{uuid_v4}@example.com"
    visit("/login")
    login(user.email, MOVE_PASSWORD)
    visit("/app/account")
    wait_for_text("Change your email address")
    assert_text("Export all your data")
    fill_in("#new_email", new_email)
    fill_in("#email_password", MOVE_PASSWORD)
    send_form("/app/account/email")
    wait_for_text("A link is on its way to #{new_email}")
    assert_text("Waiting for #{new_email}")
    # The mail's link: its token is only in the mail, so a fresh one is made
    # here for the same change.
    token = User.find(user._key).start_email_change(new_email)
    visit("/account/email?token=#{token}")
    wait_for_text("Use #{new_email}")
    send_form("/account/email")
    wait_for_text("Your account now uses #{new_email}")
    assert_text("You are still signed in here")
    assert_eq(User.find(user._key).email, new_email)
  end

  test("a wrong password leaves the address as it was, and says so") do
    user = move_user()
    visit("/login")
    login(user.email, MOVE_PASSWORD)
    visit("/app/account")
    wait_for_text("Change your email address")
    fill_in("#new_email", "other-#{uuid_v4}@example.com")
    fill_in("#email_password", "not the password")
    send_form("/app/account/email")
    wait_for_text("That is not your password")
    assert_null(User.find(user._key).email_change_to)
  end
end
