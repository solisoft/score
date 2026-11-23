# The error pages (#1034): an address nothing answers is a page of the site
# (ErrorsController, in the layout and the language of the address); what
# the framework answers itself — a `find` miss, `forbidden()`, a failure —
# is app/views/errors/<status>.html.slv, the same card on a page of its own.

const ERROR_PAGES_PASSWORD = "correct horse battery"

def error_pages_user
  user = User.new()
  user.email = "errors-#{uuid_v4}@example.com"
  user.set_password(ERROR_PAGES_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

def error_pages_sign_in(user)
  post(
    "/login",
    {"email": user.email, "password": ERROR_PAGES_PASSWORD}
  )
end

# The page's ways on, as links.
def assert_error_links(body, home, guide, changelog)
  assert_contains(body, "class=\"error-home\" href=\"#{home}\"")
  assert_contains(body, "href=\"/sections\"")
  assert_contains(body, "href=\"#{guide}\"")
  assert_contains(body, "href=\"#{changelog}\"")
end

describe("An address nothing answers") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  test("is the 404 page in the site's layout, in English, with the ways on, not indexed") do
    response = get("/no-such-page/at-all")
    assert_eq(res_status(response), 404)
    assert_eq(view_path(), "errors/show.html")
    body = res_body(response)
    assert_contains(body, "<html lang=\"en\">")
    assert_contains(body, "<title>This page is taking a rest · Score</title>")
    assert_contains(body, "<h1 id=\"error-title\">This page is taking a rest</h1>")
    assert_contains(body, "<meta name=\"robots\" content=\"noindex\">")
    # The site's own header and footer, around the card.
    assert_contains(body, "class=\"site-header\"")
    assert_contains(body, "class=\"site-footer\"")
    assert_contains(body, "class=\"error-figure-svg\"")
    assert_error_links(body, "/", "/guide", "/changelog")
    assert_contains(body, "<form class=\"error-search\" action=\"/sections\" method=\"get\" role=\"search\">")
    # A visitor is offered to sign in, not "your scores".
    assert_contains(body, "href=\"/login\">Sign in</a>")
    assert_not(body.contains("Your scores"))
    assert_not(body.contains("Cette page fait une pause"))
  end

  test("under /fr it is the French page, with the French links") do
    response = get("/fr/pas-de-page")
    assert_eq(res_status(response), 404)
    body = res_body(response)
    assert_contains(body, "<html lang=\"fr\">")
    assert_contains(body, "<h1 id=\"error-title\">Cette page fait une pause</h1>")
    assert_contains(body, h("Une pause : le silence d'une mesure entière."))
    assert_contains(body, "<meta name=\"robots\" content=\"noindex\">")
    assert_error_links(body, "/fr", "/fr/guide", "/fr/changelog")
    assert_contains(body, "href=\"/fr/login\">Se connecter</a>")
    assert_not(body.contains("This page is taking a rest"))
  end

  test("signed in, it offers the visitor's scores; under /app too") do
    error_pages_sign_in(error_pages_user())
    response = get("/app/no-such-screen")
    assert_eq(res_status(response), 404)
    body = res_body(response)
    assert_contains(body, "This page is taking a rest")
    assert_contains(body, "href=\"/app/scores\">Your scores</a>")
    assert_not(body.contains(">Sign in</a>"))
  end

  test("leaves the routes before it and public/'s files alone") do
    assert_eq(res_status(get("/guide")), 200)
    assert_eq(res_status(get("/js/score.js")), 200)
    # A file public/ does not have is the page too, not a file.
    missing = get("/js/no-such-script.js")
    assert_eq(res_status(missing), 404)
    assert_contains(res_body(missing), "This page is taking a rest")
  end

  test("another verb at an unknown address is the framework's 404, on the page of its own") do
    response = post("/no-such-page", {})
    assert_eq(res_status(response), 404)
    body = res_body(response)
    assert_contains(body, "<title>404 · This page is taking a rest · Score</title>")
    assert_contains(body, "<meta name=\"robots\" content=\"noindex\">")
    assert_error_links(body, "/", "/guide", "/changelog")
    # No layout, no session: the neutral way into the app.
    assert_not(body.contains("Your scores"))
  end
end

describe("What the framework answers itself") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  test("a score id that does not exist is the 404 page, not a line of text") do
    error_pages_sign_in(error_pages_user())
    response = get("/app/scores/no-such-score")
    assert_eq(res_status(response), 404)
    body = res_body(response)
    assert_contains(body, "<h1 id=\"error-title\">This page is taking a rest</h1>")
    assert_contains(res_header(response, "Content-Type"), "text/html")
  end

  test("a read link that leads nowhere is the 404 page too") do
    response = get("/s/no-such-token")
    assert_eq(res_status(response), 404)
    assert_contains(res_body(response), "This page is taking a rest")
    assert_not(res_body(response).contains("No such score"))
  end

  test("an unknown example, in French under /fr") do
    response = get("/fr/examples/nope")
    assert_eq(res_status(response), 404)
    body = res_body(response)
    assert_contains(body, "<html lang=\"fr\">")
    assert_contains(body, "Cette page fait une pause")
    assert_error_links(body, "/fr", "/fr/guide", "/fr/changelog")
  end

  test("someone else's score is the 403 page, and the score is not shown") do
    owner = error_pages_user()
    score = Score.start(owner, Score.blank_source("Not yours"))
    error_pages_sign_in(error_pages_user())
    response = get("/app/scores/#{score._key}")
    assert_eq(res_status(response), 403)
    body = res_body(response)
    assert_contains(body, "<h1 id=\"error-title\">#{h("Reserved for the section's players")}</h1>")
    assert_contains(body, "Ask its owner to share it")
    assert_not(body.contains("Not yours"))
  end
end

# status => its title in English, then in French.
const ERROR_PAGE_TITLES = {
  "400": ["A note off the staff", "Une note hors de la portée"],
  "401": ["Sign in to play this part", "Connectez-vous pour jouer cette partie"],
  "403": ["Reserved for the section's players", "Réservé aux musiciens du pupitre"],
  "404": ["This page is taking a rest", "Cette page fait une pause"],
  "405": ["Not the right instrument for this part", "Pas le bon instrument pour cette partie"],
  "408": ["A missed entry", "Une entrée manquée"],
  "409": ["Two players on the same note", "Deux musiciens sur la même note"],
  "410": ["Out of the repertoire", "Sortie du répertoire"],
  "413": ["Too many bars for one page", "Trop de mesures pour une page"],
  "422": ["This phrase does not resolve", "Cette phrase ne se résout pas"],
  "429": ["A little silence between the bars", "Un peu de silence entre les mesures"],
  "418": ["Something is off in the score", "Quelque chose cloche dans la partition"],
  "500": ["A wrong note", "Une fausse note"],
  "502": ["The orchestra is tuning", "L'orchestre s'accorde"],
  "503": ["Intermission", "Entracte"],
  "504": ["The tempo got lost", "Le tempo s'est perdu"],
  "507": ["Out of tune", "Ça sonne faux"]
}

describe("The page of each status") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  test("keeps its status, says its words in English, and is not indexed") do
    ERROR_PAGE_TITLES.keys().each do |code|
      response = get("/error-pages/#{code}")
      assert_eq(res_status(response), code.to_i, code)
      body = res_body(response)
      assert_contains(body, "<h1 id=\"error-title\">#{h(ERROR_PAGE_TITLES[code][0])}</h1>")
      assert_contains(body, "<html lang=\"en\">")
      assert_contains(body, "<meta name=\"robots\" content=\"noindex\">")
      assert_contains(body, "<span class=\"error-number\">#{code}</span>")
      assert_error_links(body, "/", "/guide", "/changelog")
    end
  end

  test("says them in French under /fr, with the French links") do
    ERROR_PAGE_TITLES.keys().each do |code|
      response = get("/fr/error-pages/#{code}")
      assert_eq(res_status(response), code.to_i, code)
      body = res_body(response)
      assert_contains(body, "<html lang=\"fr\">")
      assert_contains(body, "<h1 id=\"error-title\">#{h(ERROR_PAGE_TITLES[code][1])}</h1>")
      assert_error_links(body, "/fr", "/fr/guide", "/fr/changelog")
    end
  end

  test("a 5xx shows the error ID and no search; a 4xx the search and no ID") do
    failure = res_body(get("/error-pages/500"))
    found = Regex.capture("Error ID, for support: <code>(?P<id>[0-9a-f-]{36})</code>", failure)
    assert_not_null(found)
    assert_not(failure.contains("error-search"))
    assert_contains(failure, "class=\"error-figure\"")
    refused = res_body(get("/error-pages/429"))
    assert_contains(refused, "error-search")
    assert_not(refused.contains("Error ID"))
  end

  test("each family has its own engraved figure") do
    rest = res_body(get("/error-pages/404"))
    wrong = res_body(get("/error-pages/500"))
    away = res_body(get("/error-pages/503"))
    assert_contains(rest, "g71e75a2b-0")
    assert_not(wrong.contains("g71e75a2b-0"))
    assert_not(away.contains("g71e75a2b-0"))
    assert_not(wrong == away)
  end

  test("the message of a 422 is shown; the 413 links to the limits") do
    assert_contains(res_body(get("/error-pages/422")), "<p class=\"error-message\">A sample of the 422 page</p>")
    assert_not(res_body(get("/error-pages/404")).contains("A sample of the 404 page"))
    assert_contains(res_body(get("/error-pages/413")), "href=\"/limits\">#{h("The engraver's limits")}</a>")
  end

  test("only statuses of errors are sampled") do
    assert_eq(res_status(get("/error-pages/200")), 404)
    assert_eq(res_status(get("/error-pages/600")), 404)
  end
end

describe("error_page_key and error_page_figure") do
  test("name a status's words, else its family's") do
    assert_eq(error_page_key(404), "e404")
    assert_eq(error_page_key("503"), "e503")
    assert_eq(error_page_key(418), "e4xx")
    assert_eq(error_page_key(599), "e5xx")
    assert_eq(error_page_figure(429), "rest")
    assert_eq(error_page_figure(503), "break")
    assert_eq(error_page_figure(500), "wrong")
    assert_eq(error_page_figure(501), "wrong")
  end
end
