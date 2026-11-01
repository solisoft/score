# The language of a request (#471): the URL's — /fr/… French, else English
# — whatever the browser says; Soli's own guess (cookie, Accept-Language)
# only decides where a first visit in English is sent. See SiteLocale.

# order: 1
# global_only: true

def set_site_locale(req)
  path = req["path"].to_s
  # Soli's resolution, before the URL overrides it: the cookie, else the browser.
  preferred = I18n.locale()
  chosen = cookies["locale"] rescue nil
  locale = SiteLocale.of_path(path)
  I18n.set_locale(locale)
  first = SiteLocale.first_visit(req["method"].to_s, path, chosen, preferred)
  return redirect(first) unless first.nil?

  set_cookie("locale", locale) if req["method"] == "GET" && SiteLocale.localized?(SiteLocale.english(path))
  req
end
