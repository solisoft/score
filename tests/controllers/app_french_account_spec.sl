# The account pages in French (#505): the `locale` cookie set to "fr", the
# account page, its refusals and its notices are in French; without it,
# they stay in English, word for word.

const FR_ACCOUNT_PASSWORD = "correct horse battery"

def fr_account_user
  user = User.new()
  user.email = "fr-account-#{uuid_v4}@example.com"
  user.set_password(FR_ACCOUNT_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

def fr_account_sign_in(user, locale)
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": FR_ACCOUNT_PASSWORD}
  )
  set_request_cookie("locale", locale) unless locale.nil?
end

describe("The account in French") do
  before_each() do
    as_guest()
    clear_headers()
    clear_cookies()
  end

  test("the account page is in French with the cookie") do
    fr_account_sign_in(fr_account_user(), "fr")
    response = get("/app/account")
    assert_eq(res_status(response), 200)
    page = res_body(response)
    assert_contains(page, "<h1>Votre compte</h1>")
    assert_contains(page, "Se déconnecter")
    assert_contains(page, "Connexion et sécurité")
    # The site is free (#699): no plan, and nothing to buy.
    assert_not(page.includes?("Vous êtes sur l'offre"), "no plan named")
    assert_not(page.includes?("Passer à Pro"), "no upgrade")
    assert_contains(page, "Activer la connexion en deux étapes")
    assert_contains(page, "Exporter toutes vos données")
    assert_contains(page, "Télécharger mes données (.zip)")
    assert_contains(page, "Supprimer mon compte")
    assert_contains(page, "Créer un jeton")
    assert_eq(assigns()["title"], "Compte")
    assert_not(page.includes?("<h1>Your account</h1>"), "no English heading left")
    assert_not(page.includes?("Sign out"), "no English button left")
    assert_not(page.includes?("Export all your data"), "no English section left")
  end

  test("the same page stays in English without the cookie") do
    fr_account_sign_in(fr_account_user(), nil)
    page = res_body(get("/app/account"))
    assert_contains(page, "<h1>Your account</h1>")
    assert_contains(page, "Sign out")
    assert_not(page.includes?("You are on <strong>"), "no plan named")
    assert_not(page.includes?("Upgrade:"), "no upgrade")
    assert_contains(page, "Export all your data")
    assert_eq(assigns()["title"], "Account")
    assert_not(page.includes?("Votre compte"), "no French heading")
  end

  test("a refused deletion says why in French, and the account stays") do
    user = fr_account_user()
    fr_account_sign_in(user, "fr")
    refused = request("DELETE", "/app/account", {"password": "not the password"}, {})
    assert_eq(res_status(refused), 422)
    assert_contains(res_body(refused), "pas votre mot de passe : le compte est toujours là.")
    assert_not_null(User.find_by("email", user.email))
  end

  test("a refused deletion still says it in English without the cookie") do
    user = fr_account_user()
    fr_account_sign_in(user, nil)
    refused = request("DELETE", "/app/account", {"password": "not the password"}, {})
    assert_eq(res_status(refused), 422)
    assert_contains(res_body(refused), "That is not your password: the account is still here.")
    assert_not_null(User.find_by("email", user.email))
  end

  test("a refused token and a refused AI key are in French, and nothing is kept") do
    user = fr_account_user()
    fr_account_sign_in(user, "fr")
    token = post(
      "/app/account/tokens",
      {"name": "", "password": FR_ACCOUNT_PASSWORD}
    )
    assert_eq(res_status(token), 422)
    assert_contains(res_body(token), "Donnez un nom au jeton")
    assert_eq(AccessToken.of(user).length, 0)
    key = post(
      "/app/account/ai",
      {
        "provider": "nobody",
        "model": "m",
        "key": "sk-123456789"
      }
    )
    assert_eq(res_status(key), 422)
    assert_contains(res_body(key), "Choisissez un fournisseur.")
    assert_not(User.find(user._key).own_ai?())
  end

  test("a notice after a saved setting is in French") do
    user = fr_account_user()
    fr_account_sign_in(user, "fr")
    saved = post("/app/account/push", {"kinds": ["none", "reply"]})
    assert_eq(res_status(saved), 302)
    assert_contains(res_body(get("/app/account")), "Vos réglages de notifications push sont enregistrés.")
    assert(User.find(user._key).pushes?("reply"))
    assert_not(User.find(user._key).pushes?("shared"))
  end
end

describe("User.plan_date") do
  after_each() do
    I18n.set_locale("en")
  end

  test("writes the date as each language does, the 1st included") do
    first = DateTime.parse("2026-11-01T12:00:00Z").to_unix
    later = DateTime.parse("2026-11-12T12:00:00Z").to_unix
    I18n.set_locale("en")
    assert_eq(User.plan_date(first), "November 1, 2026")
    assert_eq(User.plan_date(later), "November 12, 2026")
    I18n.set_locale("fr")
    assert_eq(User.plan_date(first), "1er novembre 2026")
    assert_eq(User.plan_date(later), "12 novembre 2026")
  end
end
