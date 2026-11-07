# The app's language (#505): the middleware set_app_locale reads it for
# every page under /app. English or French; the choice made on this browser
# (the `locale` cookie) first, else the one the account keeps, else English.
class AppLocale
  # Whether `path` is a page of the app — the admin section (/admin) among
  # them: it speaks the app's language too (#626).
  static def app_path?(path)
    ["/app", "/admin"].any? do |prefix|
      path == prefix || path.starts_with?(prefix + "/")
    end
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
    user.save_changes
  end
end
