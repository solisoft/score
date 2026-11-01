# The site's two languages (#471): English at /…, French at /fr/…. The URL
# says which; a visitor's first page in English, with a browser that prefers
# French and no choice made yet, is sent to its French address, and the
# language of each page read is remembered in the `locale` cookie, which
# Soli's own locale resolution reads too.
#
# The views' twin of `path` is `lp` (app/helpers/locale_helper.sl): helpers
# are not seen from controllers, nor services from views — fix both.
const SITE_LOCALES = ["en", "fr"]
# The paths that exist in both languages: these, and what is under them.
const SITE_LOCALIZED = [
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
]

class SiteLocale
  # "fr" for /fr and what is under it, else "en".
  static def of_path(path)
    path == "/fr" || path.starts_with?("/fr/") ? "fr" : "en"
  end

  # `path` without its /fr.
  static def english(path)
    return "/" if path == "/fr" || path == "/fr/"
    return path.substring(3, path.length) if path.starts_with?("/fr/")

    path
  end

  # `path`, an English path, in `locale`: /fr in front of it in French.
  static def localize(path, locale)
    english = SiteLocale.english(path)
    return english unless locale == "fr" && SiteLocale.localized?(english)
    return "/fr" if english == "/"

    "/fr" + english
  end

  # `path` in the language of the request: what a controller redirects to.
  static def path(path)
    SiteLocale.localize(path, I18n.locale())
  end

  # Whether `path` (English) has a French twin.
  static def localized?(path)
    clean = path.split("?")[0]
    return true if clean == "/"

    SITE_LOCALIZED.any? do |prefix|
      clean == prefix || clean.starts_with?(prefix + "/")
    end
  end

  # The site's language a browser asks for first, from its Accept-Language
  # header: the named language of highest weight among English and French,
  # or nil when it names neither. `*` names none: a client that takes
  # anything (a crawler, a script) stays in English.
  static def preferred(header)
    best = nil
    best_weight = 0.0
    for part in header.to_s.split(",")
      pieces = part.trim.split(";")
      language = pieces[0].trim.downcase.split("-")[0]
      next unless SITE_LOCALES.includes?(language)

      weight = 1.0
      for param in pieces.slice(1, pieces.length)
        kv = param.trim.split("=")
        weight = kv[1].to_f if kv.length == 2 && kv[0].trim == "q"
      end
      if weight > best_weight
        best = language
        best_weight = weight
      end
    end
    best
  end

  # Where a request is sent first, or nil: an English page read with a
  # browser preferring `preferred`, by someone who has not chosen yet.
  static def first_visit(method, path, chosen, preferred)
    return nil unless method == "GET" && chosen.blank? && preferred == "fr"
    return nil unless SiteLocale.of_path(path) == "en" && SiteLocale.localized?(path)

    SiteLocale.localize(path, "fr")
  end
end
