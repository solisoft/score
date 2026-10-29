describe("PagesController") do
  describe("GET /guide") do
    test("engraves its examples, the marked one in its colours") do
      response = get("/guide")
      assert_eq(res_status(response), 200)
      body = res_body(response)
      assert_contains(body, "EUI's score viewer")
      assert_contains(body, "fill=\"#8b2b2c\"")
      assert_contains(body, "fill=\"#a7843d\"")
      assert_not(body.contains("score-sheet-refused"))
    end
  end

  describe("GET /syntax") do
    test("engraves every snippet, none refused") do
      response = get("/syntax")
      assert_eq(res_status(response), 200)
      body = res_body(response)
      assert_not(body.contains("score-sheet-refused"))
      assert_contains(body, "?source=syntax/notes")
      assert_contains(body, "?source=syntax/nested-groups")
      # Every snippet but the two the home page shows is on this page.
      names = ScoreLibrary.snippets.keys.filter do |name|
        !["home", "hello"].includes?(name)
      end
      names.each do |name|
        assert_contains(body, "?source=syntax/#{name}\"")
      end
    end
  end

  describe("GET /limits") do
    test("prints the engraver's own refusal for each case") do
      response = get("/limits")
      assert_eq(res_status(response), 200)
      refusals = assigns()["refusals"]
      assert_eq(refusals.length, ScoreLibrary.refusals.length)
      refusals.each do |refusal|
        assert_not_null(refusal["message"], refusal["what"])
      end
      assert_contains(res_body(response), "\\shiver is not a command this reads")
      # Since #408 the engraver reads a \\time inside a bar: no longer a refusal on the page.
      assert_not(refusals.any?(&{ |refusal|
        refusal["what"] == "A change of metre inside a bar"
      }))
    end

    test("lists no longer what real files write, and says since when") do
      body = res_body(get("/limits"))
      assert_contains(body, "Since Soli 2.28.5, real LilyPond files open.")
      assert_not(body.contains("Layout tweaks"))
      assert_not(body.contains("A forced accidental"))
    end
  end

  describe("GET /embed") do
    test("explains the embed and runs it on the page") do
      response = get("/embed")
      assert_eq(res_status(response), 200)
      body = res_body(response)
      assert_contains(body, "https://score.solisoft.net/eui-score.js")
      assert_contains(body, "https://score.solisoft.net/eui-score-editor.js")
      assert_contains(body, "<eui-score src=\"/examples/ensembles/string-quartet/source.ly\"></eui-score>")
      assert_contains(body, "<script type=\"text/x-lilypond\">")
      assert_contains(body, "await import(\"/eui-score/eui-score.js?v=#{ScoreAssets.version}\")")
      assert_contains(body, "<eui-score-editor id=\"embed-editor\">")
    end
  end

  describe("GET /changelog") do
    test("lists every day newest first, each change tagged with where it lives") do
      response = get("/changelog")
      assert_eq(res_status(response), 200)
      body = res_body(response)
      # Read from the page: the days outgrow what assigns() carries back.
      dates = body.split("<section class=\"changelog-day\" id=\"").slice(1, 1000).map do |part|
        part.substring(0, 10)
      end
      assert_eq(dates.length, Changelog.days.length)
      assert_eq(dates, dates.sort().reverse())
      assert_contains(body, "Monday, October 19, 2026")
      assert_contains(body, "change-tag-engine\">Engraver")
      assert_contains(body, "change-tag-site\">Site &amp; editor")
      assert_contains(body, "A note too long for its bar is cut into tied notes")
      # The day's latest, the app's among them.
      assert_contains(body, "Record live from a MIDI keyboard")
      assert_contains(body, "The MIDI view: every track at a glance")
      assert_contains(body, "Notes dragged and resized on the MIDI view")
      # Soli 2.28.5's engine.
      assert_contains(body, "Saturday, October 24, 2026")
      assert_contains(body, "Real LilyPond files open")
    end

    test("links a change to the page that shows it, and no further") do
      body = res_body(get("/changelog"))
      entries = Changelog.shown(AppSetup.ready?).map do |day|
        day["entries"]
      end.flatten
      linked = entries.filter do |entry|
        !entry["link"].nil?
      end
      assert(linked.length > 0)
      # One "Try it" per linked change, none for the others.
      assert_eq(body.split("class=\"changelog-try\"").length - 1, linked.length)
      assert_contains(body, "href=\"/playground\">Try it")
    end

    test("draws a sample score under an engraver change that names one, in the browser's engraver") do
      response = get("/changelog")
      body = res_body(response)
      with_sample = fn(entry) { entry.merge({"sample": Changelog.sample(entry["sample"])}) }
      entries = Changelog.shown(AppSetup.ready?).map do |day|
        day["entries"]
      end.flatten.map(with_sample)
      four_voices = entries.filter do |entry|
        entry["title"].starts_with?("Four voices on a staff")
      end[0]
      assert_contains(four_voices["sample"], "\\voiceFour")
      assert_contains(body, "<eui-score staff-space=\"6\"><script type=\"text/x-lilypond\">\\new PianoStaff")
      assert_contains(body, "<script type=\"module\" src=\"/eui-score/eui-score.js")
      named = Changelog.days.map do |day|
        day["entries"]
      end.flatten.filter do |entry|
        !entry["sample"].nil?
      end
      assert_eq(body.split("<eui-score ").length - 1, named.length)
      # An entry with no sample draws none.
      linked = entries.filter do |entry|
        entry["title"] == "The score and its text, linked"
      end[0]
      assert_null(linked["sample"])
    end

    test("reads a sample only by a plain name of scores/changelog/") do
      assert_contains(Changelog.sample("verses"), "\\addlyrics")
      assert_null(Changelog.sample("no-such-sample"))
      assert_null(Changelog.sample("../syntax/home"))
      assert_null(Changelog.sample(""))
      assert_null(Changelog.sample(nil))
    end

    test("is in the site's navigation") do
      assert_contains(res_body(get("/guide")), "href=\"/changelog\"")
    end
  end

  describe("the changelog and the app") do
    # A visitor's pages: a session left by an earlier spec in this worker shows "Open the app".
    before_each() do
      logout()
      clear_cookies()
    end

    test("shows the app's news only where the app is open") do
      all_titles = Changelog.shown(true).map do |day|
        day["entries"]
      end.flatten.map do |entry|
        entry["title"]
      end
      closed_titles = Changelog.shown(false).map do |day|
        day["entries"]
      end.flatten.map do |entry|
        entry["title"]
      end
      assert_contains(all_titles, "The app: your scores, kept in your account")
      assert_not(closed_titles.includes?("The app: your scores, kept in your account"))
      assert_contains(closed_titles, "Menus in the editor, and a palette over the note")
      assert(Changelog.shown(false).all?(&{ |day|
        day["entries"].length > 0
      }))
    end

    test("the site sends to the app, and the playground offers to save there, where it is open") do
      body = res_body(get("/playground"))
      assert_contains(body, "<a href=\"/app\">App</a>")
      assert_contains(body, "<a class=\"nav-cta\" href=\"/signup\">Start free</a>")
      assert_contains(body, "playground-banner")
      assert_contains(res_body(get("/changelog")), "href=\"/app\">Try it")
    end
  end

  describe("the site's header") do
    before_each() do
      logout()
      clear_cookies()
    end

    # On a phone the links wrap below the brand and Sign in / Start free stay
    # beside it: that needs them after the nav, not among its links.
    test("puts Sign in and Start free after the links; the engraver's pages in the footer") do
      body = res_body(get("/guide"))
      nav_start = body.index_of("<nav class=\"site-nav\"")
      nav_end = body.index_of("</nav>")
      signin_at = body.index_of("<a class=\"nav-signin\" href=\"/login\">Sign in</a>")
      start_at = body.index_of("<a class=\"nav-cta\" href=\"/signup\">Start free</a>")
      assert_gt(nav_start, -1, "the site's nav")
      assert_gt(signin_at, nav_end, "Sign in after the nav")
      assert_gt(start_at, signin_at, "Start free after Sign in")
      links = body.substring(nav_start, nav_end)
      ["/app", "/pricing", "/guide", "/changelog"].each do |path|
        assert_contains(links, "href=\"#{path}\"")
      end
      ["/syntax", "/examples", "/embed", "/limits", "/playground"].each do |path|
        assert_not(links.includes?("href=\"#{path}\""), "#{path} is in the footer, not the header")
      end
      assert_not(links.includes?("nav-cta"), "no button among the links")
      footer = body.substring(body.index_of("<nav class=\"footer-nav\""), body.length)
      every_page = [
        "/app",
        "/playground",
        "/pricing",
        "/changelog",
        "/guide",
        "/syntax",
        "/examples",
        "/embed",
        "/limits"
      ]
      every_page.each do |path|
        assert_contains(footer, "href=\"#{path}\"")
      end
    end

    test("marks Guide as the page for the guide, the syntax, embedding and the limits, and nothing else") do
      ["/guide", "/syntax", "/embed", "/limits"].each do |path|
        assert_contains(res_body(get(path)), "<a href=\"/guide\" aria-current=\"page\">Guide</a>")
      end
      examples = res_body(get("/examples"))
      assert_not(examples.contains("aria-current=\"page\">Guide"), "the examples are not the guide")
      assert_contains(res_body(get("/changelog")), "<a href=\"/changelog\" aria-current=\"page\">Changelog</a>")
    end

    test("someone signed in is offered the app, not a sign-in") do
      user = User.new()
      user.email = "header-#{uuid_v4}@example.com"
      user.set_password("correct horse battery")
      user.confirmed_at = DateTime.utc.to_unix
      user.save
      post(
        "/login",
        {"email": user.email, "password": "correct horse battery"}
      )
      body = res_body(get("/"))
      assert_contains(body, "<a class=\"nav-cta\" href=\"/app\">Open the app</a>")
      assert_not(body.contains("class=\"nav-signin\""), "no Sign in")
      assert_not(body.contains("<a class=\"nav-cta\" href=\"/signup\">"), "no Start free in the header")
    end
  end
end
