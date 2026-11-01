# The app's language (#505): the middleware set_app_locale reads it for
# every page under /app. English or French; the choice made on this browser
# (the `locale` cookie) first, else the one the account keeps, else English.
class AppLocale
  # Whether `path` is a page of the app.
  static def app_path?(path)
    path == "/app" || path.starts_with?("/app/")
  end

  # The language of the app for a browser that chose `chosen` (nil when it
  # has not) and an account that keeps `kept` (nil for a guest or none yet).
  static def pick(chosen, kept)
    return chosen if SITE_LOCALES.includes?(chosen)
    return kept if SITE_LOCALES.includes?(kept)

    "en"
  end

  # The account keeps `locale`, written only when it changes.
  static def remember(user, locale)
    return false if user.locale == locale

    user.locale = locale
    user.save
  end
end
