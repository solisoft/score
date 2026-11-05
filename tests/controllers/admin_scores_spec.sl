# A customer's scores in the admin section (#626): the list on the
# customer's page — owned scores only, with their visibility, people,
# versions and trash, without N+1 — and each score read only, engraved with
# its LilyPond and versions. Each read is kept as an AdminAction, shown on
# the owner's page and in Activity. Only an admin who signed in in two steps
# reaches it; a score is read only under its own owner's address; nothing
# on these pages changes a score.

const ADMIN_626_PASSWORD = "correct horse battery"

# An account; an admin has two-step sign-in on unless `two_step` is false.
def admin_626_user(role = "member", two_step = true)
  user = User.new()
  user.email = "admin-626-#{uuid_v4}@example.com"
  user.name = "Customer #{uuid_v4.substring(0, 6)}"
  user.role = role
  user.set_password(ADMIN_626_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  if role == "admin" && two_step
    secret = User.find(user._key).start_two_step
    User.find(user._key).confirm_two_step(Crypto.totp_generate(secret, DateTime.utc.to_unix, 30))
  end
  User.find(user._key)
end

# Signed in as `user`: the password, then the code when two-step is on.
def admin_626_sign_in(user)
  clear_cookies()
  response = post(
    "/login",
    {"email": user.email, "password": ADMIN_626_PASSWORD}
  )
  account = User.find(user._key)
  return response unless account.two_step?

  secret = Crypto.decrypt(account.totp_secret, getenv("SOLI_ENCRYPTION_KEY"))
  post("/login/code", {"code": Crypto.totp_generate(secret, DateTime.utc.to_unix + 30, 30)})
end

# A score of `user`'s, titled `title`.
def admin_626_score(user, title)
  Score.start(user, "\\header { title = \"#{title}\" composer = \"Clara\" }\n{ c'4 d' e' f' }")
end

describe("A customer's scores, for an admin") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  describe("the list on the customer's page") do
    test("lists their own scores, with visibility, people, versions and trash, without N+1") do
      admin = admin_626_user("admin")
      customer = admin_626_user()
      other = admin_626_user()
      kept = admin_626_score(customer, "Morning Etude")
      kept.make_visible("link")
      ScoreShare.invite(kept, "friend-626-#{uuid_v4}@example.com", "read")
      ScoreShare.invite(kept, "friend-626-#{uuid_v4}@example.com", "write")
      ScoreVersion.keep(kept, kept.source, "manual")
      trashed = admin_626_score(customer, "Old Sketch")
      trashed.move_to_trash
      theirs = admin_626_score(other, "Someone Else's Waltz")
      ScoreShare.invite(theirs, customer.email, "read")
      # The kept one changed an hour before the trashed one: newest first.
      Score.where("doc._key == @key", {"key": kept._key}).update_all({"updated_at": DateTime.utc.to_unix - 3600})
      admin_626_sign_in(admin)

      response = get("/admin/customers/#{customer._key}")
      assert_eq(res_status(response), 200)
      assert_no_n_plus_one(response)
      page = res_body(response)
      assert_contains(page, "data-customer-score=\"#{kept._key}\"")
      assert_contains(page, "data-customer-score=\"#{trashed._key}\"")
      assert_contains(page, "href=\"/admin/customers/#{customer._key}/scores/#{kept._key}\"")
      assert_contains(page, "data-visibility=\"link\"")
      assert_contains(page, "Anyone with the link")
      assert_contains(page, "data-trashed")
      # Owned only: the score shared with them is in its own list, under its owner.
      assert_not(page.contains("data-customer-score=\"#{theirs._key}\""))
      assert_contains(page, "data-shared-with-customer")
      assert_contains(page, "href=\"/admin/customers/#{other._key}/scores/#{theirs._key}\"")

      listed = assigns()["scores"]
      assert_eq(listed["scores"].map(&:_key), [trashed._key, kept._key])
      assert_eq(listed["shares"][kept._key], 2)
      assert_eq(listed["versions"][kept._key], 1)
      assert_eq(listed["more"], false)
    end

    test("pages past 50 scores, and says so when there are none") do
      admin = admin_626_user("admin")
      customer = admin_626_user()
      empty = admin_626_user()
      (0 .. 51).each do |i|
        admin_626_score(customer, "Piece #{i}")
      end
      admin_626_sign_in(admin)
      first = get("/admin/customers/#{customer._key}")
      assert_no_n_plus_one(first)
      assert_eq(assigns()["scores"]["scores"].length, 50)
      assert(assigns()["scores"]["more"])
      assert_contains(res_body(first), "data-more-scores")
      second = get("/admin/customers/#{customer._key}?scores_page=2")
      assert_eq(assigns()["scores"]["scores"].length, 1)
      assert_not(assigns()["scores"]["more"])
      assert_not(res_body(second).contains("data-more-scores"))
      assert_contains(res_body(get("/admin/customers/#{empty._key}")), "No score.")
    end
  end

  describe("GET /admin/customers/:id/scores/:score_id") do
    test("shows the score engraved, its LilyPond and versions, read only, and keeps the read") do
      admin = admin_626_user("admin")
      customer = admin_626_user()
      score = admin_626_score(customer, "Evening Song")
      score.make_visible("public")
      version = ScoreVersion.keep(score, score.source, "manual")
      revision = Score.find(score._key).revision
      admin_626_sign_in(admin)

      response = get("/admin/customers/#{customer._key}/scores/#{score._key}")
      assert_eq(res_status(response), 200)
      page = res_body(response)
      assert_contains(page, "Evening Song")
      assert_contains(page, "<div class=\"score-sheet\"><svg")
      assert_contains(page, "data-admin-source")
      assert_contains(page, "ly-command")
      assert_contains(page, "data-admin-visibility=\"public\"")
      assert_contains(page, "href=\"/s/#{Score.find(score._key).share_token}\"")
      assert_contains(page, "/admin/customers/#{customer._key}/scores/#{score._key}/versions/#{version._key}")
      assert_not(page.contains("data-admin-trashed"))
      # Nothing to change: no form, no editor.
      assert_not(page.contains("<form"))
      assert_not(page.contains("/app/scores/#{score._key}"))

      kept = AdminAction.where({
        "action": "view_score",
        "target_id": score._key
      }).all
      assert_eq(kept.length, 1)
      assert_eq(kept[0].admin_id, admin._key)
      assert_eq(kept[0].target_type, "score")
      assert_eq(kept[0].details["owner"], customer._key)
      assert_eq(kept[0].summary, "Read the score “Evening Song”")
      # The score itself is as it was.
      assert_eq(Score.find(score._key).revision, revision)
    end

    test("the read shows on the owner's page and in Activity") do
      admin = admin_626_user("admin")
      customer = admin_626_user()
      score = admin_626_score(customer, "Traced Tune")
      admin_626_sign_in(admin)
      get("/admin/customers/#{customer._key}/scores/#{score._key}")

      page = res_body(get("/admin/customers/#{customer._key}"))
      assert_contains(page, "data-admin-action=\"view_score\"")
      assert_contains(page, "Read the score “Traced Tune”")
      activity = res_body(get("/admin/actions"))
      assert_contains(activity, "data-admin-action=\"view_score\"")
      assert_contains(activity, "href=\"/admin/customers/#{customer._key}/scores/#{score._key}\" data-viewed-score")
      assert_contains(activity, customer.display_name)
    end

    test("a trashed score is shown, marked, with no read page") do
      admin = admin_626_user("admin")
      customer = admin_626_user()
      score = admin_626_score(customer, "Binned Bourrée")
      score.make_visible("link")
      score.move_to_trash
      admin_626_sign_in(admin)
      response = get("/admin/customers/#{customer._key}/scores/#{score._key}")
      assert_eq(res_status(response), 200)
      assert_contains(res_body(response), "data-admin-trashed")
      assert_not(res_body(response).contains("data-admin-read-page"))
      assert_not_null(Score.find(score._key).trashed_at)
    end

    test("a score the engraver refuses shows the refusal instead of a figure") do
      admin = admin_626_user("admin")
      customer = admin_626_user()
      score = admin_626_score(customer, "Broken")
      score.source = "{ c'4 d' e' f'"
      score.save
      admin_626_sign_in(admin)
      response = get("/admin/customers/#{customer._key}/scores/#{score._key}")
      assert_eq(res_status(response), 200)
      assert_contains(res_body(response), "score-sheet-refused")
      assert_not(res_body(response).contains("<div class=\"score-sheet\"><svg"))
    end

    test("another customer's score under this customer's address is 404, and not kept") do
      admin = admin_626_user("admin")
      customer = admin_626_user()
      other = admin_626_user()
      theirs = admin_626_score(other, "Not Theirs")
      version = ScoreVersion.keep(theirs, theirs.source, "manual")
      mine = admin_626_score(customer, "Theirs")
      admin_626_sign_in(admin)
      assert_eq(res_status(get("/admin/customers/#{customer._key}/scores/#{theirs._key}")), 404)
      assert_eq(res_status(get("/admin/customers/#{customer._key}/scores/no-such-score")), 404)
      assert_eq(res_status(get("/admin/customers/no-such-user/scores/#{theirs._key}")), 404)
      # A version of another score under this one's address.
      assert_eq(
        res_status(get("/admin/customers/#{customer._key}/scores/#{mine._key}/versions/#{version._key}")),
        404
      )
      assert_eq(res_status(get("/admin/customers/#{other._key}/scores/#{theirs._key}/versions/no-such")), 404)
      assert_eq(AdminAction.where({"action": "view_score"}).all.filter(&{ |action|
        [theirs._key, mine._key].includes?(action.target_id)
      }).length, 0)
    end

    test("a member gets 404, an admin without the second step is sent away, and nothing is kept") do
      customer = admin_626_user()
      score = admin_626_score(customer, "Private Matter")
      version = ScoreVersion.keep(score, score.source, "manual")
      paths = [
        "/admin/customers/#{customer._key}/scores/#{score._key}",
        "/admin/customers/#{customer._key}/scores/#{score._key}/versions/#{version._key}"
      ]
      admin_626_sign_in(admin_626_user())
      paths.each do |path|
        assert_eq(res_status(get(path)), 404, path)
      end
      # The owner too: the admin pages are not theirs.
      admin_626_sign_in(customer)
      assert_eq(res_status(get(paths[0])), 404)
      admin_626_sign_in(admin_626_user("admin", false))
      paths.each do |path|
        assert_eq(res_location(get(path)), "/admin/two-step", path)
      end
      as_guest()
      clear_cookies()
      assert_contains(res_location(get(paths[0])), "/login")
      assert_eq(AdminAction.where({"target_id": score._key}).count, 0)
    end
  end

  describe("GET /admin/customers/:id/scores/:score_id/versions/:version_id") do
    test("shows the version engraved with its source, read only, and keeps the read") do
      admin = admin_626_user("admin")
      customer = admin_626_user()
      score = admin_626_score(customer, "Versioned")
      older = "\\header { title = \"Versioned draft\" }\n{ g'2 a' }"
      version = ScoreVersion.keep(score, older, "auto")
      admin_626_sign_in(admin)
      response = get("/admin/customers/#{customer._key}/scores/#{score._key}/versions/#{version._key}")
      assert_eq(res_status(response), 200)
      page = res_body(response)
      assert_contains(page, "Versioned draft")
      assert_contains(page, "<div class=\"score-sheet\"><svg")
      assert_contains(page, "data-admin-back-to-score")
      assert_not(page.contains("<form"))
      kept = AdminAction.where({
        "action": "view_score",
        "target_id": score._key
      }).first
      assert_eq(kept.details["version"], version._key)
      assert_eq(kept.summary, "Read a version of the score “Versioned”")
    end
  end

  describe("in French") do
    test("the list and the read follow the language chosen on the site") do
      admin = admin_626_user("admin")
      customer = admin_626_user()
      score = admin_626_score(customer, "Chanson")
      admin_626_sign_in(admin)
      set_request_cookie("locale", "fr")
      assert_contains(res_body(get("/admin/customers/#{customer._key}")), "Partitions")
      page = res_body(get("/admin/customers/#{customer._key}/scores/#{score._key}"))
      assert_contains(page, "Lecture seule")
      assert_eq(AdminAction.about(customer._key)[0].summary, "Read the score “Chanson”")
    end
  end
end
