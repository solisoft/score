# The app's language (#505). The app (/app/…) has no /fr twin: it speaks
# the language last chosen on the site (the `locale` cookie that
# set_site_locale keeps), and the account remembers it, so a new browser
# opens the app in the account's language. See AppLocale.

# order: 6
# global_only: true

def set_app_locale(req)
  path = req["path"].to_s
  return req unless AppLocale.app_path?(path)

  user = req["current_user"]
  chosen = cookies["locale"] rescue nil
  locale = AppLocale.pick(chosen, user&.locale)
  I18n.set_locale(locale)
  AppLocale.remember(user, locale) unless user.nil?
  req
end
