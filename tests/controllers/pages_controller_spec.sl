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
      days = assigns()["days"]
      assert_eq(days.length, Changelog.days.length)
      dates = days.map do |day|
        day["date"]
      end
      assert_eq(dates, dates.sort().reverse())
      body = res_body(response)
      assert_contains(body, "Monday, October 19, 2026")
      assert_contains(body, "change-tag-engine\">Engraver")
      assert_contains(body, "change-tag-site\">Site &amp; editor")
      assert_contains(body, "A note too long for its bar is cut into tied notes")
    end

    test("links a change to the page that shows it, and no further") do
      get("/changelog")
      entries = assigns()["days"].map do |day|
        day["entries"]
      end.flatten
      linked = entries.filter do |entry|
        !entry["link"].nil?
      end
      assert(linked.length > 0)
      linked.each do |entry|
        assert_not_null(entry["href"], entry["title"])
      end
      entries.filter do |entry|
        entry["link"].nil?
      end.each do |entry|
        assert_null(entry["href"])
      end
      assert_contains(res_body(get("/changelog")), "href=\"/playground\">Try it")
    end

    test("draws a sample score under an engraver change that names one, in the browser's engraver") do
      response = get("/changelog")
      body = res_body(response)
      entries = assigns()["days"].map do |day|
        day["entries"]
      end.flatten
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
      assert_contains(body, "<a class=\"nav-cta\" href=\"/app\">Open the app</a>")
      assert_contains(body, "playground-banner")
      assert_contains(res_body(get("/changelog")), "href=\"/app\">Try it")
    end
  end
end
