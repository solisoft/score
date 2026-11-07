# The site in English and in French (#471): /fr/… is French, the rest
# English; a first visit with a French browser goes to the French page; the
# language read is remembered, and the page links to its twin.

describe("The site in two languages") do
  before_each() do
    as_guest()
    clear_headers()
    clear_cookies()
  end

  test("/fr pages are in French, the others in English, each naming its twin") do
    french = get("/fr/limits")
    assert_eq(res_status(french), 200)
    body = res_body(french)
    assert_contains(body, "<html lang=\"fr\">")
    assert_contains(body, "hreflang=\"en\" href=\"")
    assert_contains(body, "/limits\">")
    assert_contains(body, "<title>Limites · Score</title>")
    assert_contains(body, "href=\"/fr/guide\"")
    assert_contains(body, "class=\"nav-lang\" data-no-nav href=\"/limits\"")
    english = res_body(get("/limits"))
    assert_contains(english, "<html lang=\"en\">")
    assert_contains(english, "<title>Limits · Score</title>")
    assert_contains(english, "class=\"nav-lang\" data-no-nav href=\"/fr/limits\"")
    assert_contains(english, "hreflang=\"fr\" href=\"")
    assert_eq(res_status(get("/fr")), 200)
    assert_contains(res_body(get("/fr")), "<html lang=\"fr\">")
  end

  test("a first visit with a French browser goes to the French page; a choice made is kept") do
    set_header("Accept-Language", "fr-FR,fr;q=0.9,en;q=0.8")
    first = get("/limits")
    assert_eq(res_status(first), 302)
    assert_eq(res_location(first), "/fr/limits")
    # Chose English: kept, no redirect.
    set_request_cookie("locale", "en")
    assert_eq(res_status(get("/limits")), 200)
    # A client that takes anything, or names neither language, stays in English.
    clear_cookies()
    set_header("Accept-Language", "*")
    assert_eq(res_status(get("/limits")), 200, "* is not French")
    set_header("Accept-Language", "de-DE,de;q=0.9")
    assert_eq(res_status(get("/limits")), 200)
    # An English browser stays in English.
    clear_cookies()
    set_header("Accept-Language", "en-GB,en;q=0.9")
    assert_eq(res_status(get("/limits")), 200)
  end

  test("pages that have no French twin are never redirected") do
    set_header("Accept-Language", "fr")
    response = get("/playground")
    assert_eq(res_status(response), 200)
    assert_contains(res_body(response), "<html lang=\"en\">")
  end

  test("SiteLocale: paths in each language") do
    assert_eq(SiteLocale.of_path("/fr"), "fr")
    assert_eq(SiteLocale.of_path("/fr/guide"), "fr")
    assert_eq(SiteLocale.of_path("/french"), "en")
    assert_eq(SiteLocale.localize("/pricing", "fr"), "/fr/pricing")
    assert_eq(SiteLocale.localize("/", "fr"), "/fr")
    assert_eq(SiteLocale.localize("/fr/pricing", "en"), "/pricing")
    assert_eq(SiteLocale.localize("/app/scores", "fr"), "/app/scores", "no twin: unchanged")
    assert_eq(SiteLocale.english("/fr/"), "/")
    assert(SiteLocale.localized?("/examples/piano/waltz"))
    assert_not(SiteLocale.localized?("/examples-old"))
    assert_null(SiteLocale.first_visit("POST", "/login", "", "fr"), "a form is never redirected")
    assert_null(SiteLocale.first_visit("GET", "/fr/login", "", "fr"))
    assert_null(SiteLocale.first_visit("GET", "/login", "en", "fr"))
    assert_eq(SiteLocale.first_visit("GET", "/", "", "fr"), "/fr")
    assert_eq(SiteLocale.preferred("fr-FR,fr;q=0.9,en;q=0.8"), "fr")
    assert_eq(SiteLocale.preferred("en-US,fr;q=0.9"), "en")
    assert_eq(SiteLocale.preferred("de;q=1,fr;q=0.5,en;q=0.7"), "en", "by weight, not by order")
    assert_null(SiteLocale.preferred("*"))
    assert_null(SiteLocale.preferred("de-DE,de;q=0.9"))
    assert_null(SiteLocale.preferred(nil))
  end

  test("every reading page answers in French at /fr, with its French title and links") do
    [
      ["/fr/guide", "Guide · Score"],
      ["/fr/syntax", "Syntaxe · Score"],
      ["/fr/embed", "Intégrer · Score"],
      ["/fr/limits", "Limites · Score"],
      ["/fr/claude", "Score dans Claude · Score"],
      ["/fr/changelog", "Nouveautés · Score"],
      ["/fr/examples", "Exemples · Score"]
    ].each do |page|
      response = get(page[0])
      assert_eq(res_status(response), 200, page[0])
      body = res_body(response)
      assert_contains(body, "<title>#{page[1]}</title>")
      assert_contains(body, "<html lang=\"fr\">")
    end
    examples = res_body(get("/fr/examples"))
    assert_contains(examples, "Exemples gravés")
    assert_contains(examples, "Voix et chœur")
    assert_contains(examples, "href=\"/fr/examples/")
    assert_not(examples.includes?("href=\"/examples/solos\""), "links stay in French")
    changelog = res_body(get("/fr/changelog"))
    assert_contains(changelog, "Quoi de neuf")
    assert_contains(changelog, "octobre 2026")
    # Tarifs is gone while the site is free (#699): its address leads home.
    assert_eq(res_location(get("/fr/pricing")), "/fr")
    home = res_body(get("/fr"))
    assert_contains(home, "Micro et pratique")
    assert_not(home.includes?("href=\"/fr/pricing\""), "no link to Tarifs")
  end

  test("signing in in French: the form, its refusals and its links stay in French") do
    page = res_body(get("/fr/login"))
    assert_contains(page, "action=\"/fr/login\"")
    assert_contains(page, "Mot de passe oublié ?")
    assert_contains(page, "href=\"/fr/signup\"")
    refused = post(
      "/fr/login",
      {"email": "nobody-#{uuid_v4}@example.com", "password": "not the one"}
    )
    assert_eq(res_status(refused), 401)
    assert_contains(res_body(refused), "Adresse ou mot de passe incorrect")
    english = post(
      "/login",
      {"email": "nobody-#{uuid_v4}@example.com", "password": "not the one"}
    )
    assert_eq(res_status(english), 401)
    assert_contains(res_body(english), "Invalid email or password")
    assert_contains(res_body(get("/fr/password/reset")), "Réinitialisez votre mot de passe")
    assert_contains(res_body(get("/fr/signup")), "Créez votre compte")
  end

  test("SiteText: the words of each language, a missing one said by its key") do
    assert_eq(SiteText.t("auth.sign_in", {}, "fr"), "Se connecter")
    assert_eq(SiteText.t("auth.sign_in", {}, "en"), "Sign in")
    assert_eq(
      SiteText.t("auth.password_short", {"n": 12}, "fr"),
      "Le mot de passe doit faire au moins 12 caractères"
    )
    assert_eq(SiteText.t("no.such.key", {}, "fr"), "no.such.key")
    assert_eq(Changelog.day_heading("2026-10-31", "fr"), "samedi 31 octobre 2026")
    assert_eq(Changelog.day_heading("2026-10-31", "en"), "Saturday, October 31, 2026")
  end

  test("every key is in both languages, and no text is left empty in French") do
    english = SITE_TEXTS.keys.filter do |key|
      key.starts_with?("en.")
    end.map do |key|
      key.substring(3, key.length)
    end
    french = SITE_TEXTS.keys.filter do |key|
      key.starts_with?("fr.")
    end.map do |key|
      key.substring(3, key.length)
    end
    assert_gt(english.length, 100)
    assert_eq(english.filter(&{ |key|
      !french.includes?(key)
    }), [], "missing in fr.yml")
    assert_eq(french.filter(&{ |key|
      !english.includes?(key)
    }), [], "missing in en.yml")
    blank = french.filter do |key|
      SITE_TEXTS["fr." + key].blank?
    end
    assert_eq(blank, [], "empty in fr.yml")
  end
end
