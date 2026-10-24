# The library's screens: each score its owner's.

const LIBRARY_PASSWORD = "correct horse battery"

def library_user
  user = User.new()
  user.email = "lib-#{uuid_v4}@example.com"
  user.set_password(LIBRARY_PASSWORD)
  # Confirmed: an address must be, to sign in.
  user.confirmed_at = DateTime.utc.to_unix
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
    # A browser's form post (urlencoded, wanting HTML); the test client's hash
    # body is sent as JSON, which is the editor's kind of call (401 JSON).
    set_header("Content-Type", "application/x-www-form-urlencoded")
    set_header("Accept", "text/html")
    form_post = post("/app/scores", "source=")
    clear_headers()
    assert_eq(res_status(form_post), 302)
    assert_eq(res_location(form_post), "/login?return_to=%2Fapp%2Fscores")
    assert_eq(res_status(post("/app/scores", {})), 401)
  end

  describe("the start screen") do
    test("offers a guest the way in") do
      body = res_body(get("/app"))
      assert_contains(body, "Create an account")
      assert_contains(body, "href=\"/playground\"")
      assert_not(body.contains("id=\"start-form\""))
    end

    test("offers the signed-in person to start, and their six latest scores") do
      owner = library_user()
      (0 .. 8).each do |i|
        Score.start(owner, Score.blank_source("Piece #{i}"))
      end
      Score.start(owner, Score.blank_source("Thrown away")).move_to_trash
      Score.start(library_user(), Score.blank_source("Someone else's"))
      library_sign_in(owner)
      body = res_body(get("/app"))
      assert_eq(res_status(get("/app")), 200)
      assert_contains(body, "id=\"start-form\"")
      assert_contains(body, "Create the score")
      assert_contains(body, "data-import")
      recent = assigns()["recent"]
      assert_eq(recent.length, 6)
      assert(recent.all?(&{ |score|
        score.user_id == owner._key && !score.trashed?
      }))
    end

    test("starts a score from the LilyPond posted, titled after the file when it has no title") do
      owner = library_user()
      library_sign_in(owner)
      post(
        "/app/scores",
        {"source": "\\relative c' { c4 d e f }", "title": "my-tune"}
      )
      created = Score.library(owner, "", "updated")[0]
      assert_eq(created.title, "my-tune")
      assert_contains(Score.find(created._key).source, "c4 d e f")
      post(
        "/app/scores",
        {"source": "\\header { title = \"Its own\" }\n{ c'1 }", "title": "file-name"}
      )
      assert_eq(Score.library(owner, "", "title").map(&{ |score|
        score.title
      }), ["Its own", "my-tune"])
    end

    test("refuses a source too long to keep, and keeps nothing") do
      owner = library_user()
      library_sign_in(owner)
      response = post("/app/scores", {"source": "c" * 1000001})
      assert_eq(res_status(response), 422)
      assert_eq(Score.library(owner, "", "updated").length, 0)
    end
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
    assert_contains(res_body(get("/app/scores?q=zzz")), "No title or composer has")
  end

  test("reads a library of many scores, shares and a trash in a few queries, however many there are") do
    owner = library_user()
    sharer = library_user()
    (0 .. 12).each do |i|
      Score.start(owner, Score.blank_source("Own #{i}"))
    end
    (0 .. 3).each do |i|
      Score.start(owner, Score.blank_source("Thrown #{i}")).move_to_trash
    end
    shared = (0 .. 5).map do |i|
      Score.start(sharer, Score.blank_source("Lent #{i}"))
    end
    shared.each do |score|
      ScoreShare.invite(score, owner.email, "read")
    end
    # Trashed by its owner: no longer listed for the one it was shared with.
    shared[0].move_to_trash
    library_sign_in(owner)
    response = get("/app/scores")
    assert_eq(res_status(response), 200)
    assert_no_n_plus_one(response)
    assert_max_queries(response, 6)
    assert_eq(assigns()["scores"].length, 12)
    assert_eq(assigns()["trash_count"], 3)
    assert_eq(assigns()["shared"].map(&{ |entry|
      entry["score"]["title"]
    }).sort(), ["Lent 1", "Lent 2", "Lent 3", "Lent 4"])
    assert_contains(res_body(response), "Trash (3)")
    assert_contains(res_body(response), "/app/scores/#{shared[1]._key}/preview.svg?r=")
    assert_not(res_body(response).contains("Lent 0"))
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
    # A pickup is chosen in Score properties and in New score.
    assert_contains(page, "data-field=\"pickup\"")
    assert_contains(page, "name=\"pickup\"")
    assert_contains(page, "<option value=\"4.\">A dotted quarter</option>")
    # The editor and the Start page offer the same keys, minor ones too.
    assert_contains(page, "<option value=\"-3\">E♭ major / C minor</option>")
    start = res_body(get("/app"))
    assert_contains(start, "<option value=\"-3\">E♭ major / C minor</option>")
    assert_contains(start, "<option value=\"0\" selected>C major / A minor</option>")
    assert_not(start.contains(">E♭ major</option>"), "no key without its minor")
  end

  test("a score's headers, footers and systems a page open in its editor; a stranger sees none of it") do
    owner = library_user()
    footer = "\\markup \\fill-line { \"Practice copy\" \\fromproperty #'page:page-number-string }"
    paper = "\\paper { systems-per-page = 3 oddFooterMarkup = #{footer} }"
    header = "\\header { title = \"Paged\" piece = \"Allegro\" opus = \"Op. 3\" copyright = \"(c) 2026 Me\" }"
    score = Score.start(owner, "#{paper}\n#{header}\n{ c'1 | d'1 }")
    library_sign_in(owner)
    response = get("/app/scores/#{score._key}")
    assert_eq(res_status(response), 200)
    page = res_body(response)
    # Score properties: the header's piece, opus and copyright, the systems a page, the four lines.
    for field in [
      "piece",
      "opus",
      "copyright",
      "systems-per-page",
      "page-oddHeader",
      "page-evenHeader",
      "page-oddFooter",
      "page-evenFooter"
    ]
      assert_contains(page, "data-field=\"#{field}\"")
    end
    # The engraving the editor opens on is drawn, the page settings passed over or printed.
    assert_null(assigns()["figure"]["error"])
    assert_contains(Score.find(score._key).source, "oddFooterMarkup")
    stranger = library_user()
    library_sign_in(stranger)
    refused = get("/app/scores/#{score._key}")
    assert_eq(res_status(refused), 403)
    assert_not(res_body(refused).contains("Practice copy"))
    assert_not(res_body(refused).contains("data-field=\"page-oddFooter\""))
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

  describe("saving and the history") do
    test("the editor's save writes the source, and a stale one is answered 409 with the score as it stands") do
      owner = library_user()
      score = Score.start(owner, Score.blank_source("Bolero"))
      library_sign_in(owner)
      saved = put(
        "/app/scores/#{score._key}",
        {"source": "\\header { title = \"Bolero\" }\n{ c'1 }", "revision": score.revision}
      )
      assert_eq(res_status(saved), 200)
      assert_eq(res_json(saved)["revision"], Score.find(score._key).revision)
      stale = put(
        "/app/scores/#{score._key}",
        {"source": "{ d'1 }", "revision": score.revision}
      )
      assert_eq(res_status(stale), 409)
      assert_contains(res_json(stale)["source"], "c'1")
      assert_contains(Score.find(score._key).source, "c'1")
    end

    test("of two saves over the same revision, one answers 200, the other 409, its text kept") do
      owner = library_user()
      score = Score.start(owner, Score.blank_source("Canon"))
      library_sign_in(owner)
      answers = ["e'1", "f'1"].map do |notes|
        res_status(put(
          "/app/scores/#{score._key}",
          {"source": "\\header { title = \"Canon\" }\n{ #{notes} }", "revision": score.revision}
        ))
      end
      assert_eq(answers, [200, 409])
      stored = Score.find(score._key)
      assert_eq(stored.revision, score.revision + 1)
      assert_contains(stored.source, "e'1")
      conflicts = ScoreVersion.history(score).filter do |version|
        version.reason == "conflict"
      end
      assert_eq(conflicts.length, 1)
      assert_contains(ScoreVersion.find(conflicts[0]._key).source, "f'1")
    end

    test("a signed-out save that wants JSON is answered 401 JSON, and writes nothing") do
      owner = library_user()
      score = Score.start(owner, Score.blank_source("Nocturne"))
      set_header("Accept", "application/json")
      set_header("Content-Type", "application/json")
      answer = put("/app/scores/#{score._key}", {
        "source": "{ g'1 }",
        "revision": score.revision
      }.to_json)
      clear_headers()
      assert_eq(res_status(answer), 401)
      assert_eq(res_json(answer)["error"], "signed out")
      stored = Score.find(score._key)
      assert_eq(stored.revision, score.revision)
      assert_contains(stored.source, "r1")
      assert_eq(ScoreVersion.history(score).length, 0)
    end

    test("the editor's other JSON calls get 401 JSON too, and a page still goes to sign in") do
      owner = library_user()
      score = Score.start(owner, Score.blank_source("Etude"))
      set_header("Accept", "application/json")
      kept = post("/app/scores/#{score._key}/versions", {})
      clear_headers()
      assert_eq(res_status(kept), 401)
      assert_eq(res_json(kept)["error"], "signed out")
      assert_eq(ScoreVersion.history(score).length, 0)
      page = get("/app/scores/#{score._key}")
      assert_eq(res_status(page), 302)
      assert_eq(res_location(page), "/login?return_to=%2Fapp%2Fscores%2F#{score._key}")
    end

    test("a save on a score this person may no longer change is answered 403 JSON") do
      owner = library_user()
      score = Score.start(owner, Score.blank_source("Fugue"))
      library_sign_in(library_user())
      set_header("Accept", "application/json")
      refused = put(
        "/app/scores/#{score._key}",
        {"source": "{ a'1 }", "revision": score.revision}
      )
      kept = post("/app/scores/#{score._key}/versions", {})
      clear_headers()
      assert_eq(res_status(refused), 403)
      assert_eq(res_json(refused)["error"], "you may no longer change this score")
      assert_eq(res_status(kept), 403)
      assert_eq(res_json(kept)["error"], "you may no longer change this score")
      assert_eq(Score.find(score._key).revision, score.revision)
      assert_eq(ScoreVersion.history(score).length, 0)
    end

    test("File ▸ Print as PDF names the score's own paper, not A4 when it is not") do
      owner = library_user()
      letter = Score.start(
        owner,
        "\\header { title = \"Wide\" }\n\\paper { #(set-paper-size \"a3landscape\") }\n{ c'1 }"
      )
      plain = Score.start(owner, Score.blank_source("Plain"))
      library_sign_in(owner)
      wide_page = res_body(get("/app/scores/#{letter._key}"))
      assert_contains(wide_page, "Print as PDF <kbd data-pdf-paper>A3 landscape</kbd>")
      assert_not(wide_page.contains("data-pdf-paper>A4<"))
      assert_contains(res_body(get("/app/scores/#{plain._key}")), "Print as PDF <kbd data-pdf-paper>A4</kbd>")
    end

    test("the editor page opens with what the save needs") do
      owner = library_user()
      score = Score.start(owner, Score.blank_source("Habanera"))
      library_sign_in(owner)
      page = res_body(get("/app/scores/#{score._key}"))
      assert_contains(page, "data-save-state")
      # A refused save's three ways out, the copy posted as a new score.
      assert_contains(page, "data-conflict-mine")
      assert_contains(page, "data-conflict-theirs")
      assert_contains(page, "data-conflict-copy")
      assert_contains(page, "action=\"/app/scores\" method=\"POST\" data-open-form")
      assert_contains(page, "let revision = #{score.revision};")
      assert_contains(page, "shareUrl: \"/app/scores/#{score._key}/share\"")
      # The owner shares from the sharing page: File says so.
      assert_contains(page, "data-act=\"share\">Share… <kbd>who may open it</kbd>")
      assert_not(page.contains("Copy a link to this score"))
      assert_contains(page, "data-act=\"properties\"")
      assert_contains(page, "/ws/scores?ticket=")
      assert_contains(page, "fetch(\"/app/scores/#{score._key}/room_ticket\"")
      assert_contains(page, "data-room")
      assert_contains(page, "href=\"/app/scores/#{score._key}/versions\"")
      # File › Open a photo…, read on the account's AI.
      assert_contains(page, "Open a photo… <kbd>read by AI</kbd>")
      assert_contains(page, "data-photo-open")
      # New, Open and the examples make a new score, never over this one.
      assert_contains(page, "data-open-form")
      assert_contains(page, "onOpen: openAsNew")
      # View › MIDI view, and its button.
      assert_contains(page, "data-act=\"midi-view\" data-midi-label")
      assert_contains(page, "data-midi-button")
      assert_contains(page, "data-act=\"insert-copied\"")
      assert_contains(page, "data-quantize")
    end

    test("keeps a version on request, lists it, shows it, and restores it") do
      owner = library_user()
      score = Score.start(owner, Score.blank_source("Gymnopedie"))
      library_sign_in(owner)
      kept = post("/app/scores/#{score._key}/versions", {})
      assert_eq(res_status(kept), 201)
      version_key = res_json(kept)["version"]
      put(
        "/app/scores/#{score._key}",
        {"source": "\\header { title = \"Gymnopedie\" }\n{ b'1 }", "revision": score.revision}
      )
      listing = res_body(get("/app/scores/#{score._key}/versions"))
      assert_contains(listing, "kept on request")
      assert_contains(listing, "href=\"/app/scores/#{score._key}/versions/#{version_key}\"")
      shown = get("/app/scores/#{score._key}/versions/#{version_key}")
      assert_eq(res_status(shown), 200)
      assert_contains(res_body(shown), "Restore this version")
      assert_contains(res_body(shown), "action=\"/app/scores/#{score._key}/versions/#{version_key}/restore\"")
      restored = post("/app/scores/#{score._key}/versions/#{version_key}/restore", {})
      assert_eq(res_location(restored), "/app/scores/#{score._key}")
      assert_contains(Score.find(score._key).source, "r1")
    end

    test("an empty history says so") do
      owner = library_user()
      score = Score.start(owner, Score.blank_source("Pavane"))
      library_sign_in(owner)
      assert_contains(res_body(get("/app/scores/#{score._key}/versions")), "No version kept yet")
    end

    test("refuses to save, keep, list or restore someone else's score") do
      owner = library_user()
      score = Score.start(owner, Score.blank_source("Mine"))
      version = ScoreVersion.keep(score, score.source, "manual")
      library_sign_in(library_user())
      assert_eq(res_status(put(
        "/app/scores/#{score._key}",
        {"source": "{ c'1 }", "revision": score.revision}
      )), 403)
      assert_eq(res_status(post("/app/scores/#{score._key}/versions", {})), 403)
      assert_eq(res_status(get("/app/scores/#{score._key}/versions")), 403)
      assert_eq(res_status(post("/app/scores/#{score._key}/versions/#{version._key}/restore", {})), 403)
      assert_contains(Score.find(score._key).source, "r1")
      assert_eq(ScoreVersion.history(score).length, 1)
    end

    test("a version of another score is not found through this one") do
      owner = library_user()
      score = Score.start(owner, Score.blank_source("One"))
      other = Score.start(owner, Score.blank_source("Two"))
      version = ScoreVersion.keep(other, other.source, "manual")
      library_sign_in(owner)
      assert_eq(res_status(get("/app/scores/#{score._key}/versions/#{version._key}")), 404)
      assert_eq(res_status(post("/app/scores/#{score._key}/versions/#{version._key}/restore", {})), 404)
    end

    test("deleting a score for good takes its history with it") do
      owner = library_user()
      score = Score.start(owner, Score.blank_source("Ephemeral"))
      ScoreVersion.keep(score, score.source, "manual")
      library_sign_in(owner)
      post("/app/scores/#{score._key}/trash", {})
      request("DELETE", "/app/scores/#{score._key}", {}, {})
      assert_eq(ScoreVersion.history(score).length, 0)
    end

    test("the history names who saved each version, older ones nobody, in a few queries") do
      owner = library_user()
      friend = library_user()
      score = Score.start(owner, Score.blank_source("Duet"))
      ScoreShare.invite(score, friend.email, "write")
      [owner, friend, owner, friend].each do |author|
        ScoreVersion.keep(score, score.source, "manual", author._key)
      end
      ScoreVersion.keep(score, score.source, "auto")
      library_sign_in(owner)
      response = get("/app/scores/#{score._key}/versions")
      assert_eq(res_status(response), 200)
      assert_no_n_plus_one(response)
      body = res_body(response)
      assert_contains(body, "by #{owner.email}")
      assert_contains(body, "by #{friend.email}")
      assert_eq(body.split("data-version-author").length - 1, 4)
      assert_eq(assigns()["authors"][friend._key], friend.email)
    end

    test("a stranger sees neither the history nor its authors, and cannot copy a version") do
      owner = library_user()
      score = Score.start(owner, Score.blank_source("Private"))
      version = ScoreVersion.keep(score, score.source, "manual", owner._key)
      stranger = library_user()
      library_sign_in(stranger)
      listing = get("/app/scores/#{score._key}/versions")
      assert_eq(res_status(listing), 403)
      assert_not(res_body(listing).contains(owner.email))
      assert_eq(res_status(get("/app/scores/#{score._key}/versions/#{version._key}")), 403)
      copied = post("/app/scores/#{score._key}/versions/#{version._key}/copy", {})
      assert_eq(res_status(copied), 403)
      assert_eq(Score.where("doc.user_id == @user", {"user": stranger._key}).count, 0)
    end

    test("a version plays and copies: the copy is a new score, opened in the editor, the original untouched") do
      owner = library_user()
      score = Score.start(owner, Score.blank_source("Sarabande"))
      version = ScoreVersion.keep(score, Score.with_title("{ e'1 }", "Sarabande"), "manual", owner._key)
      library_sign_in(owner)
      page = res_body(get("/app/scores/#{score._key}/versions/#{version._key}"))
      assert_contains(page, "data-score-play")
      assert_contains(page, "/js/score.js")
      assert_contains(page, "action=\"/app/scores/#{score._key}/versions/#{version._key}/copy\"")
      assert_contains(page, "Restore this version")
      copied = post("/app/scores/#{score._key}/versions/#{version._key}/copy", {})
      assert_eq(res_status(copied), 302)
      copies = Score.library(owner, "Sarabande (copy)", "title")
      assert_eq(copies.length, 1)
      assert_eq(res_location(copied), "/app/scores/#{copies[0]._key}")
      copy = Score.find(copies[0]._key)
      assert_contains(copy.source, "e'1")
      assert_eq(copy.saved_by, owner._key)
      stored = Score.find(score._key)
      assert_eq(stored.revision, score.revision)
      assert_contains(stored.source, "r1")
      unknown = post("/app/scores/#{score._key}/versions/no-such-version/copy", {})
      assert_eq(res_status(unknown), 404)
    end

    test("someone it is shared with to read copies a version into their own library, but cannot restore it") do
      owner = library_user()
      reader = library_user()
      score = Score.start(owner, Score.blank_source("Chaconne"))
      ScoreShare.invite(score, reader.email, "read")
      version = ScoreVersion.keep(score, score.source, "manual", owner._key)
      library_sign_in(reader)
      page = res_body(get("/app/scores/#{score._key}/versions/#{version._key}"))
      assert_not(page.contains("Restore this version"))
      post("/app/scores/#{score._key}/versions/#{version._key}/copy", {})
      assert_eq(Score.library(reader, "Chaconne", "title").map(&:title), ["Chaconne (copy)"])
      assert_eq(Score.library(owner, "", "title").map(&:title), ["Chaconne"])
    end

    test("a save refused because someone else saved names them; the editor shows it") do
      owner = library_user()
      friend = library_user()
      score = Score.start(owner, Score.blank_source("Canon"))
      ScoreShare.invite(score, friend.email, "write")
      opened_at = score.revision
      library_sign_in(friend)
      friend_save = put(
        "/app/scores/#{score._key}",
        {"source": "\\header { title = \"Canon\" }\n{ e'1 }", "revision": opened_at}
      )
      assert_eq(res_status(friend_save), 200)
      assert_eq(Score.find(score._key).saved_by, friend._key)
      clear_cookies()
      library_sign_in(owner)
      stale = put(
        "/app/scores/#{score._key}",
        {"source": "\\header { title = \"Canon\" }\n{ f'1 }", "revision": opened_at}
      )
      assert_eq(res_status(stale), 409)
      assert_eq(res_json(stale)["saved_by"], friend.email)
      # The owner's own window, again over the old revision: nobody named.
      again = put(
        "/app/scores/#{score._key}",
        {"source": "\\header { title = \"Canon\" }\n{ g'1 }", "revision": Score.find(score._key).revision}
      )
      assert_eq(res_status(again), 200)
      mine = put(
        "/app/scores/#{score._key}",
        {"source": "\\header { title = \"Canon\" }\n{ a'1 }", "revision": opened_at}
      )
      assert_eq(res_status(mine), 409)
      assert_null(res_json(mine)["saved_by"])
      page = res_body(get("/app/scores/#{score._key}"))
      assert_contains(page, "data-conflict-who")
      assert_contains(page, "theirs?.saved_by")
    end
  end

  describe("the trash and copies") do
    test("Make a copy opens the copy in the editor") do
      owner = library_user()
      score = Score.start(owner, Score.blank_source("Aria"))
      library_sign_in(owner)
      response = post("/app/scores/#{score._key}/duplicate", {})
      copies = Score.library(owner, "Aria (copy)", "title")
      assert_eq(copies.length, 1)
      assert_eq(res_location(response), "/app/scores/#{copies[0]._key}")
    end

    test("deleting for good and emptying the trash ask first") do
      owner = library_user()
      Score.start(owner, Score.blank_source("Gone")).move_to_trash
      library_sign_in(owner)
      page = res_body(get("/app/trash"))
      assert_contains(page, "Delete “Gone” for good?")
      assert_contains(page, "Empty the trash")
      assert_contains(page, "Delete every score in the trash for good?")
      assert_contains(page, "action=\"/app/trash/empty\"")
    end

    test("an empty trash offers nothing to empty") do
      library_sign_in(library_user())
      page = res_body(get("/app/trash"))
      assert_contains(page, "The trash is empty")
      assert_not(page.contains("action=\"/app/trash/empty\""))
    end

    test("emptying the trash erases this person's trashed scores only") do
      owner = library_user()
      other = library_user()
      kept = Score.start(owner, Score.blank_source("Kept"))
      thrown = (0 .. 2).map do |i|
        Score.start(owner, Score.blank_source("Thrown #{i}"))
      end
      thrown.each do |score|
        score.move_to_trash
      end
      theirs = Score.start(other, Score.blank_source("Theirs"))
      theirs.move_to_trash
      library_sign_in(owner)
      response = post("/app/trash/empty", {})
      assert_eq(res_location(response), "/app/trash")
      thrown.each do |score|
        assert_null(Score.find_by("_key", score._key))
      end
      assert_not_null(Score.find_by("_key", kept._key))
      assert(Score.find(theirs._key).trashed?)
      assert_contains(res_body(get("/app/trash")), "The trash is empty")
    end

    test("a guest cannot empty a trash") do
      owner = library_user()
      score = Score.start(owner, Score.blank_source("Safe"))
      score.move_to_trash
      set_header("Accept", "application/json")
      response = post("/app/trash/empty", {})
      clear_headers()
      assert_eq(res_status(response), 401)
      assert(Score.find(score._key).trashed?)
    end
  end

  describe("pages of the library") do
    test("60 a page, a next page for the rest, and a page past the end says so") do
      owner = library_user()
      (0 .. SCORE_PAGE_SIZE + 2).each do |i|
        Score.start(owner, Score.blank_source("Piece #{1000 + i}"))
      end
      library_sign_in(owner)
      first = get("/app/scores?sort=title")
      assert_no_n_plus_one(first)
      assert_eq(assigns()["scores"].length, SCORE_PAGE_SIZE)
      assert(assigns()["more"])
      assert_contains(res_body(first), "href=\"/app/scores?q=&amp;sort=title&amp;page=2\"")
      assert_not(res_body(first).contains("rel=\"prev\""))
      second = get("/app/scores?sort=title&page=2")
      # 62 scores: (0 .. 62) stops before 62.
      assert_eq(assigns()["scores"].map(&:title), ["Piece 1060", "Piece 1061"])
      assert_not(assigns()["more"])
      assert_contains(res_body(second), "href=\"/app/scores?q=&amp;sort=title&amp;page=1\"")
      assert_not(res_body(second).contains("rel=\"next\""))
      past = res_body(get("/app/scores?page=9"))
      assert_contains(past, "No score on this page")
      get("/app/scores?page=nonsense")
      assert_eq(assigns()["page"], 1)
      assert_eq(assigns()["scores"].length, SCORE_PAGE_SIZE)
    end

    test("one page shows no page links") do
      owner = library_user()
      Score.start(owner, Score.blank_source("Alone"))
      library_sign_in(owner)
      assert_not(res_body(get("/app/scores")).contains("data-library-pages"))
    end

    test("the search finds composers, and its pages keep it") do
      owner = library_user()
      Score.start(owner, "\\header { title = \"Ode to Joy\" composer = \"Beethoven\" }\n{ c'1 }")
      Score.start(owner, Score.blank_source("Minuet"))
      library_sign_in(owner)
      body = res_body(get("/app/scores?q=beethoven"))
      assert_eq(assigns()["scores"].map(&:title), ["Ode to Joy"])
      assert_contains(body, "Beethoven")
      assert_eq(assigns()["page_path"], "/app/scores?q=beethoven&sort=updated&page=")
    end
  end
end
