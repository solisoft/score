# The site is free (#699, Plan.free?): no page of the site or of the app,
# in either language, offers a plan, a price or a way to pay, and no
# message sends anyone to Pricing. The words looked for are those the plans
# put on the pages (#393); the changelog keeps its history and is left out.

const FREE_PASSWORD = "correct horse battery"

# What a page that offers a plan says, in English and in French.
const FREE_OFFERS = [
  "href=\"/pricing\"",
  "href=\"/fr/pricing\"",
  "/app/billing/",
  ">Pricing<",
  ">Tarifs<",
  "Upgrade",
  "Passer à Pro",
  "Compare the plans",
  "Comparer les offres",
  "with Pro",
  "avec Pro",
  "See Pro",
  "Voir Pro",
  "the Free plan",
  "l'offre Gratuit",
  "Manage billing",
  "Gérer la facturation",
  "€"
]

def free_user
  user = User.new()
  user.email = "free-#{uuid_v4}@example.com"
  user.set_password(FREE_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  User.find(user._key)
end

def free_sign_in(user)
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": FREE_PASSWORD}
  )
end

# The offers `path` answers with: [] when it offers none. A word such as
# "Pro" alone is looked for apart from the others: as a word, not inside
# "Process" or "gemini-2.5-pro".
def free_offers_on(path)
  response = get(path)
  assert_eq(res_status(response), 200, path)
  page = res_body(response)
  found = FREE_OFFERS.filter do |offer|
    page.contains(offer)
  end
  found.push("the word Pro") if Regex.matches("[^A-Za-z0-9_./-]Pro[^A-Za-z0-9_-]", page)
  found.map do |offer|
    "#{path}: #{offer}"
  end
end

describe("A free site (#699)") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  test("no page of the site offers a plan, in English or in French") do
    paths = [
      "/",
      "/fr",
      "/guide",
      "/fr/guide",
      "/syntax",
      "/embed",
      "/limits",
      "/fr/limits",
      "/claude",
      "/examples",
      "/sections",
      "/playground",
      "/login",
      "/signup",
      "/fr/signup"
    ]
    offers = paths.map do |path|
      free_offers_on(path)
    end.flatten()
    assert_eq(offers, [])
  end

  test("no page of the app offers one either: the start page, the editor, sharing, the account") do
    user = free_user()
    score = Score.start(user, Score.blank_source("Free for all"))
    free_sign_in(user)
    paths = ["/app", "/app/account", "/app/scores/#{score._key}", "/app/scores/#{score._key}/share"]
    offers = paths.map do |path|
      free_offers_on(path)
    end.flatten()
    assert_eq(offers, [])
    set_request_cookie("locale", "fr")
    french = ["/app", "/app/account"].map do |path|
      free_offers_on(path)
    end.flatten()
    assert_eq(french, [])
  end

  test("the check finds an offer where there is one") do
    # The account page with its plans back on (as before #699) would be caught.
    old_account = "<a href=\"/pricing\">Compare the plans</a> <button>Upgrade: 6 € a month</button> (Pro)"
    caught = FREE_OFFERS.filter do |offer|
      old_account.contains(offer)
    end
    assert_eq(caught, [
      "href=\"/pricing\"",
      "Upgrade",
      "Compare the plans",
      "€"
    ])
    assert(Regex.matches("[^A-Za-z0-9_./-]Pro[^A-Za-z0-9_-]", old_account))
    assert_not(Regex.matches("[^A-Za-z0-9_./-]Pro[^A-Za-z0-9_-]", "Process google/gemini-2.5-pro ProMIDI"))
  end

  test("the editor is told every track records, and given no way to Pricing") do
    user = free_user()
    score = Score.start(user, Score.blank_source("Tracks"))
    free_sign_in(user)
    listed = res_json(get("/app/scores/#{score._key}/takes"))
    assert_eq(listed["tracks_allowed"], SCORE_TAKE_TRACKS)
    assert_eq(listed["tracks_allowed"], listed["tracks"])
    assert_null(listed["pricing"])
  end

  test("the scores an account keeps are Pro's 10,000, not Free's 1,000") do
    user = free_user()
    assert_eq(Plan.limits(user)["scores"], 10000)
    assert_eq(Plan.limits(user)["scores"], Plan.pro_limits["scores"])
    assert_ne(Plan.limits(user)["scores"], Plan.free_limits["scores"])
  end
end
