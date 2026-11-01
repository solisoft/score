# The site's languages in views (#471): see SiteLocale, which controllers
# use — a view cannot see a service, so `lp` repeats SiteLocale.localize's
# rule; change both together.

# The paths that exist in French too (SITE_LOCALIZED in SiteLocale).
def _localized_path?(path)
  clean = path.split("?")[0]
  return true if clean == "/"

  [
    "/guide",
    "/syntax",
    "/embed",
    "/limits",
    "/claude",
    "/changelog",
    "/pricing",
    "/examples",
    "/login",
    "/signup",
    "/password",
    "/confirm_email",
    "/confirmation",
    "/account/email"
  ].any? do |prefix|
    clean == prefix || clean.starts_with?(prefix + "/")
  end
end

# `path` (English) in the page's language: /fr in front of it in French.
def lp(path)
  return path unless I18n.locale() == "fr" && _localized_path?(path)
  return "/fr" if path == "/"

  "/fr" + path
end

# The page's address in the other language, for the switcher: nil when it has none.
def other_language_path(path)
  english = path == "/fr" || path == "/fr/" ? "/" : path.starts_with?("/fr/") ? path.substring(3, path.length) : path
  return nil unless _localized_path?(english)
  return english if I18n.locale() == "fr"
  return "/fr" if english == "/"

  "/fr" + english
end
