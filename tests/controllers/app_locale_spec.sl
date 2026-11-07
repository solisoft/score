# The app's language (#505): the app has no /fr twin, so it speaks the
# language last chosen on the site (the `locale` cookie), and the account
# keeps it for a browser that has not chosen; the account page sets it.

const LANG_PASSWORD = "correct horse battery"

def lang_user(locale = nil)
  user = User.new()
  user.email = "lang-#{uuid_v4}@example.com"
  user.set_password(LANG_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.locale = locale unless locale.nil?
  user.save
  user
end

def lang_sign_in(user)
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": LANG_PASSWORD}
  )
end

describe("The app's language") do
  before_each() do
    as_guest()
    clear_headers()
    clear_cookies()
  end

  test("comes from the site's choice, and the account keeps it") do
    user = lang_user()
    lang_sign_in(user)
    set_request_cookie("locale", "fr")
    page = res_body(get("/app/account"))
    assert_contains(page, "<h3>Langue</h3>")
    assert_contains(page, "value=\"fr\" lang=\"fr\" class=\"btn btn-primary\"")
    assert_eq(User.find(user._key).locale, "fr")
  end

  test("is English with no choice made and none kept") do
    user = lang_user()
    lang_sign_in(user)
    page = res_body(get("/app/account"))
    assert_contains(page, "<h3>Language</h3>")
    assert_contains(page, "value=\"en\" lang=\"en\" class=\"btn btn-primary\"")
    assert_eq(User.find(user._key).locale, "en")
  end

  test("a new browser takes the account's language") do
    user = lang_user("fr")
    lang_sign_in(user)
    assert_contains(res_body(get("/app/account")), "<h3>Langue</h3>")
  end

  test("the account page sets it, for this browser and the account") do
    user = lang_user("en")
    lang_sign_in(user)
    response = post("/app/account/language", {"locale": "fr"})
    assert_eq(res_status(response), 302)
    assert_eq(res_location(response), "/app/account#language")
    assert_eq(User.find(user._key).locale, "fr")
    # `set-cookie` is an Array, one line per cookie (Soli 2.30.2, #659).
    assert_contains(res_header(response, "Set-Cookie").join("\n"), "locale=fr")
  end

  test("refuses a language it does not speak, and changes nothing") do
    user = lang_user("en")
    lang_sign_in(user)
    response = post("/app/account/language", {"locale": "de"})
    assert_eq(res_status(response), 302)
    assert_eq(res_location(response), "/app/account")
    assert_eq(User.find(user._key).locale, "en")
  end

  test("refuses a guest") do
    response = post("/app/account/language", {"locale": "fr"})
    assert_eq(res_status(response), 401)
    assert_not((res_header(response, "Set-Cookie") ?? []).join("\n").includes?("locale=fr"))
  end

  test("its pages vary on the cookie, so a copy prefetched in one language is not shown in the other") do
    assert_contains(res_header(get("/app"), "Vary").to_s, "Cookie")
    user = lang_user()
    lang_sign_in(user)
    assert_contains(res_header(get("/app/account"), "Vary").to_s, "Cookie")
    set_header("Purpose", "prefetch")
    prefetched = get("/app/scores")
    clear_headers()
    assert_contains(res_header(prefetched, "Cache-Control").to_s, "max-age")
    assert_contains(res_header(prefetched, "Vary").to_s, "Cookie")
  end

  test("the site's pages keep the language of their address") do
    set_request_cookie("locale", "fr")
    assert_contains(res_body(get("/guide")), "<html lang=\"en\">")
  end
end

describe("AppLocale") do
  test("pick: the browser's choice, else the account's, else English") do
    assert_eq(AppLocale.pick("fr", "en"), "fr")
    assert_eq(AppLocale.pick(nil, "fr"), "fr")
    assert_eq(AppLocale.pick("de", "fr"), "fr")
    assert_eq(AppLocale.pick(nil, nil), "en")
    assert_eq(AppLocale.pick("", "xx"), "en")
  end

  test("app_path? is /app, /admin and what is under them") do
    assert(AppLocale.app_path?("/app"))
    assert(AppLocale.app_path?("/app/account"))
    assert(AppLocale.app_path?("/admin"))
    assert(AppLocale.app_path?("/admin/customers"))
    assert_not(AppLocale.app_path?("/administration"))
    assert_not(AppLocale.app_path?("/apple"))
    assert_not(AppLocale.app_path?("/fr/pricing"))
  end
end
