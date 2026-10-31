# The part of the home page's body between `start` and the next `stop` after it.
def home_part(body, start, stop)
  start_at = body.index_of(start)
  assert_gt(start_at, -1, "the page has #{start}")
  rest = body.substring(start_at, body.length)
  rest.substring(0, rest.index_of(stop))
end

# Each of a feature's `lines` is an item of its list.
def home_has_lines(section, lines)
  lines.each do |line|
    assert_contains(section, "<li>#{h(line)}</li>")
  end
end

const HOME_FEATURE_IDS = [
  "editor",
  "midi",
  "together",
  "sound",
  "practice",
  "ai",
  "files",
  "sharing"
]

describe("HomeController") do
  before_each() do
    as_guest()
  end

  describe("GET /") do
    test("leads with the app: its hero, sign-up first, the playground second") do
      response = get("/")
      assert_eq(res_status(response), 200)
      body = res_body(response)
      hero = home_part(body, "<section class=\"hero hero-app\">", "</section>")
      assert_contains(hero, "Write, play and share scores, <em>together</em>, in the browser.")
      start_at = hero.index_of("<a class=\"btn btn-primary\" href=\"/signup\" data-home-start>Start for free</a>")
      playground_at = hero.index_of("<a class=\"btn btn-ghost\" href=\"/playground\">Open the playground</a>")
      assert_gt(start_at, -1, "Start for free, to sign up")
      assert_gt(playground_at, start_at, "the playground after it")
      assert_contains(hero, "href=\"/pricing\">Pro</a>")
      # The hero's screenshot comes at once; the others wait to be scrolled to.
      assert_contains(hero, "images/home/hero-editor.jpg")
      assert_not(hero.contains("loading=\"lazy\""), "the hero's image is not lazy")
      # The old engraver-first page is gone.
      assert_not(body.contains("Scores engraved"))
      assert_not(body.contains("From text to paths, in four steps"))
    end

    test("has every feature section, in order, each with its lines, its screenshot and its link") do
      body = res_body(get("/"))
      features = assigns()["features"]
      assert_eq(features.map(&:id), HOME_FEATURE_IDS)
      last_at = -1
      features.each do |feature|
        section = home_part(body, "id=\"#{feature["id"]}\" data-feature=\"#{feature["id"]}\"", "</section>")
        at = body.index_of("id=\"#{feature["id"]}\" data-feature=")
        assert_gt(at, last_at, "#{feature["id"]} after the one before")
        last_at = at
        assert_contains(section, "<h2>#{h(feature["title"])}</h2>")
        assert(feature["lines"].length >= 1 && feature["lines"].length <= 3, "#{feature["id"]}: 1 to 3 lines")
        home_has_lines(section, feature["lines"])
        assert_contains(section, "images/home/#{feature["image"]}")
        assert_contains(section, "width=\"1600\" height=\"1010\"")
        assert_contains(section, "alt=\"#{h(feature["alt"])}\"")
        assert_contains(section, "loading=\"lazy\"")
        assert_contains(section, "<a class=\"feature-link\" href=\"#{feature["href"]}\">")
        # And the index at the top jumps to it.
        assert_contains(body, "<a href=\"##{feature["id"]}\">#{h(feature["eyebrow"])}</a>")
      end
      assert_eq(body.split("<section class=\"feature").length - 1, HOME_FEATURE_IDS.length)
    end

    test("sends each feature's link where it says: sign-up, the playground or pricing") do
      get("/")
      links = {}
      assigns()["features"].each do |feature|
        links[feature["id"]] = feature["href"]
      end
      assert_eq(links["together"], "/signup")
      assert_eq(links["sharing"], "/signup")
      assert_eq(links["practice"], "/signup")
      assert_eq(links["ai"], "/pricing")
      assert_eq(links["editor"], "/playground")
      assert_eq(links["midi"], "/signup")
      HOME_FEATURE_IDS.each do |id|
        assert(["/signup", "/playground", "/pricing"].includes?(links[id]), "#{id}: #{links[id]}")
      end
    end

    test("every screenshot is on disk, web-sized, and the alt texts name no real address") do
      get("/")
      images = ["hero-editor.jpg"] + assigns()["features"].map(&:image)
      assert_eq(images.length, 9)
      images.each do |image|
        path = "public/images/home/#{image}"
        assert(File.exists(path), path)
        size = File.size(path)
        assert(size > 20000 && size < 400000, "#{path}: #{size} bytes")
      end
      assigns()["features"].each do |feature|
        assert_not(feature["alt"].contains("@"), feature["alt"])
      end
    end

    test("keeps the engraver for developers, with the guide, the syntax and embedding") do
      body = res_body(get("/"))
      developers = home_part(body, "<section class=\"section dev\" id=\"developers\">", "</section>")
      assert_contains(developers, "For developers")
      assert_contains(developers, "href=\"/guide\"")
      assert_contains(developers, "href=\"/syntax\"")
      assert_contains(developers, "href=\"/embed\"")
      assert_contains(developers, "href=\"/examples\">The #{ScoreLibrary.examples.length} examples")
      assert_contains(developers, "&lt;eui-score src=")
      # One piece engraved on the server, none refused.
      assert_eq(developers.split("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox").length - 1, 1)
      assert_not(body.contains("score-sheet-refused"))
      assert_eq(assigns()["example_count"], ScoreLibrary.examples.length)
    end

    test("teases the plans with Pro's price from Plan, and links to /pricing") do
      body = res_body(get("/"))
      plans = home_part(body, "<section class=\"section\" id=\"plans\">", "</section>")
      assert_contains(plans, "<h3>Free</h3>")
      assert_contains(plans, "<h3>Pro</h3>")
      price = Plan.price("monthly")
      assert_contains(plans, "#{h(price["label"])} <small>a #{price["per"]}</small>")
      assert_contains(plans, "<a class=\"btn btn-ghost\" href=\"/pricing\" data-home-pricing>Compare the plans</a>")
      band = home_part(body, "<section class=\"cta-band\">", "</section>")
      assert_contains(band, "href=\"/signup\">Start for free</a>")
      assert_contains(band, "href=\"/pricing\">See pricing</a>")
    end

    test("the changelog says the home page shows the app") do
      body = res_body(get("/changelog"))
      assert_contains(body, "The home page shows the app: the editor, playing together, practice, sharing")
    end

    test("has no script of its own: the layout's only, so instant navigation keeps working") do
      body = res_body(get("/"))
      main = home_part(body, "<main>", "</main>")
      assert_not(main.contains("<script"), "no script in the page")
    end

    test("hands the page the player, served here, and credits its sounds") do
      body = res_body(get("/"))
      assert_contains(body, "data-player=\"/eui-score/player.js?v=")
      assert_contains(body, "href=\"/soundfonts/MuseScore_General_License.txt\"")
      assert_not(body.contains("html-midi-player"))
    end

    test("names the site once in its title, and carries its share tags") do
      body = res_body(get("/"))
      title = "Write, play and share scores, together · Score"
      assert_contains(body, "<title>#{title}</title>")
      assert_eq(body.split("<title>")[1].split("</title>")[0].split("Score").length - 1, 1)
      assert_contains(body, "<meta property=\"og:title\" content=\"#{title}\">")
      description = h(assigns()["description"])
      assert_contains(description, "score editor in the browser")
      assert_contains(body, "<meta name=\"description\" content=\"#{description}\">")
      assert_contains(body, "<meta property=\"og:description\" content=\"#{description}\">")
      assert_contains(body, "<meta property=\"og:type\" content=\"website\">")
      assert_contains(body, "<meta property=\"og:url\" content=\"")
      assert_contains(body, "<link rel=\"canonical\" href=\"")
      assert_contains(body, "<meta name=\"twitter:card\" content=\"summary_large_image\">")
      assert_contains(body, "og.png")
      assert_not(body.contains("name=\"robots\""), "the home page may be indexed")
    end

    test("its header shows the app: App, Pricing, Guide, Changelog, then Sign in and Start free") do
      body = res_body(get("/"))
      nav = home_part(body, "<nav class=\"site-nav\"", "</nav>")
      labels = ["App", "Pricing", "Guide", "Changelog"]
      paths = ["/app", "/pricing", "/guide", "/changelog"]
      last_at = -1
      [0, 1, 2, 3].each do |index|
        at = nav.index_of("<a href=\"#{paths[index]}\">#{labels[index]}</a>")
        assert_gt(at, last_at, labels[index])
        last_at = at
      end
      account = home_part(body, "<div class=\"nav-account\">", "</div>")
      assert_contains(account, "<a class=\"nav-signin\" href=\"/login\">Sign in</a>")
      assert_contains(account, "<a class=\"nav-cta\" href=\"/signup\">Start free</a>")
      assert_not(account.contains("Open the app"))
    end
  end

  describe("GET /health") do
    test("answers ok") do
      response = get("/health")
      assert_eq(res_status(response), 200)
      assert_eq(res_json(response)["status"], "ok")
    end
  end

  describe("GET /health/deep") do
    # Jobs other specs queued wait unclaimed (`soli test` runs no worker).
    before_each() do
      Job.list().each do |job|
        Job.cancel(job["_key"]) rescue nil
      end
    end

    test("answers 200 where the database answers and no job is late") do
      response = get("/health/deep")
      assert_eq(res_status(response), 200)
      assert_eq(res_json(response)["status"], "ok")
      assert_eq(res_json(response)["problems"], [])
      assert_eq(res_header(response, "Cache-Control"), "no-store")
    end

    test("a job left far past its time is a reason not to be ready") do
      # Due in 2099: no worker claims it, and the clock is put past it.
      job_id = Job.enqueue_at("DataCleanupJob", "2099-01-01T00:00:00Z", {})
      later = DateTime.parse("2099-01-01T01:00:00Z").to_unix
      problem = Readiness.jobs_problem(later)
      Job.cancel(job_id) rescue nil
      assert_eq(problem, "1 job(s) waiting past their time: no worker claims them")
      assert_eq(
        Readiness.verdict([problem]),
        {"ready": false, "problems": [problem]}
      )
      # Not yet late at its own time.
      assert_null(Readiness.jobs_problem(DateTime.parse("2099-01-01T00:10:00Z").to_unix))
    end

    test("no reason means ready, and liveness stays green") do
      assert_eq(
        Readiness.verdict([]),
        {"ready": true, "problems": []}
      )
      assert_eq(res_status(get("/health")), 200)
    end
  end
end
