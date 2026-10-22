# The library's screens: each score its owner's.

const LIBRARY_PASSWORD = "correct horse battery"

def library_user
  user = User.new()
  user.email = "lib-#{uuid_v4}@example.com"
  user.set_password(LIBRARY_PASSWORD)
  user.save
  user
end

def library_sign_in(user)
  post(
    "/login",
    {"email": user.email, "password": LIBRARY_PASSWORD}
  )
end

describe("AppScoresController") do
  before_each() do
    as_guest()
    clear_cookies()
  end

  test("sends a guest to sign in") do
    assert_eq(res_location(get("/app/scores")), "/login?return_to=%2Fapp%2Fscores")
    assert_eq(res_status(post("/app/scores", {})), 302)
  end

  test("the app's first screen is the library, once signed in") do
    library_sign_in(library_user())
    assert_eq(res_location(get("/app")), "/app/scores")
  end

  test("lists the signed-in person's scores, with a card each, and searches them") do
    owner = library_user()
    Score.start(owner, Score.blank_source("Minuet"))
    Score.start(owner, Score.blank_source("Polonaise"))
    Score.start(library_user(), Score.blank_source("Not mine"))
    library_sign_in(owner)
    body = res_body(get("/app/scores"))
    assert_contains(body, "Minuet")
    assert_contains(body, "Polonaise")
    assert_not(body.contains("Not mine"))
    assert_eq(assigns()["scores"].length, 2)
    get("/app/scores?q=polo&sort=title")
    assert_eq(assigns()["scores"].map(&{ |score|
      score.title
    }), ["Polonaise"])
    assert_eq(assigns()["sort"], "title")
    get("/app/scores?sort=nonsense")
    assert_eq(assigns()["sort"], "updated")
    assert_contains(res_body(get("/app/scores?q=zzz")), "No title has")
  end

  test("says what to do with an empty library") do
    library_sign_in(library_user())
    assert_contains(res_body(get("/app/scores")), "No score yet")
  end

  test("New score makes one and opens it in the editor") do
    owner = library_user()
    library_sign_in(owner)
    response = post("/app/scores", {})
    assert_eq(res_status(response), 302)
    created = Score.library(owner, "", "updated")
    assert_eq(created.length, 1)
    assert_eq(res_location(response), "/app/scores/#{created[0]._key}")
    page = res_body(get(res_location(response)))
    assert_contains(page, "id=\"studio\"")
    assert_contains(page, "startStudio(root")
    assert_contains(page, SCORE_UNTITLED)
  end

  test("renames, copies, trashes, restores, then deletes for good") do
    owner = library_user()
    score = Score.start(owner, Score.blank_source("Prelude"))
    library_sign_in(owner)
    post("/app/scores/#{score._key}/rename", {"title": "Prelude in C"})
    assert_eq(Score.find(score._key).title, "Prelude in C")
    post("/app/scores/#{score._key}/duplicate", {})
    assert_eq(Score.library(owner, "", "title").map(&{ |kept|
      kept.title
    }), ["Prelude in C", "Prelude in C (copy)"])
    refused = request("DELETE", "/app/scores/#{score._key}", {}, {})
    assert_eq(res_status(refused), 422)
    post("/app/scores/#{score._key}/trash", {})
    assert(Score.find(score._key).trashed?)
    assert_eq(res_location(get("/app/scores/#{score._key}")), "/app/trash")
    assert_contains(res_body(get("/app/trash")), "Prelude in C")
    post("/app/scores/#{score._key}/restore", {})
    assert_not(Score.find(score._key).trashed?)
    post("/app/scores/#{score._key}/trash", {})
    response = request("DELETE", "/app/scores/#{score._key}", {}, {})
    assert_eq(res_location(response), "/app/trash")
    assert_null(Score.find_by("_key", score._key))
  end

  test("draws a card's preview as an SVG") do
    owner = library_user()
    score = Score.start(owner, Score.blank_source("Etude"))
    library_sign_in(owner)
    response = get("/app/scores/#{score._key}/preview.svg")
    assert_eq(res_status(response), 200)
    assert_contains(res_header(response, "Content-Type"), "image/svg+xml")
    assert_contains(res_body(response), "<svg")
  end

  test("refuses someone else's score at every door, and changes nothing") do
    owner = library_user()
    score = Score.start(owner, Score.blank_source("Private"))
    library_sign_in(library_user())
    assert_eq(res_status(get("/app/scores/#{score._key}")), 403)
    assert_eq(res_status(get("/app/scores/#{score._key}/preview.svg")), 403)
    assert_eq(res_status(post("/app/scores/#{score._key}/rename", {"title": "Taken"})), 403)
    assert_eq(res_status(post("/app/scores/#{score._key}/duplicate", {})), 403)
    assert_eq(res_status(post("/app/scores/#{score._key}/trash", {})), 403)
    stored = Score.find(score._key)
    assert_eq(stored.title, "Private")
    assert_not(stored.trashed?)
    assert_eq(Score.library(owner, "", "updated").length, 1)
  end

  test("answers 404 for a score that does not exist") do
    library_sign_in(library_user())
    assert_eq(res_status(get("/app/scores/no-such-score")), 404)
  end

  test("deleting the account deletes its scores") do
    owner = library_user()
    Score.start(owner, Score.blank_source("Gone"))
    library_sign_in(owner)
    request("DELETE", "/app/account", {"password": LIBRARY_PASSWORD}, {})
    assert_eq(Score.where("doc.user_id == @user", {"user": owner._key}).all.length, 0)
  end
end
