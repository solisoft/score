describe("HomeController") do
  describe("GET /") do
    test("engraves the hero and the one-line example") do
      response = get("/")
      assert_eq(res_status(response), 200)
      body = res_body(response)
      assert_contains(body, "Scores engraved")
      assert_gt(body.split("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox").length - 1, 1)
      assert_not(body.contains("score-sheet-refused"))
      assert_contains(body, "<span class=\"ly-command\">\\header</span>")
      assert_eq(assigns()["example_count"], ScoreLibrary.examples.length)
    end

    test("counts the pieces of each family") do
      get("/")
      piano = assigns()["categories"].find do |cat|
        cat["slug"] == "piano"
      end
      assert_eq(piano["count"], ScoreLibrary.examples_in("piano").length)
    end

    test("hands the page the player, served here, and credits its sounds") do
      body = res_body(get("/"))
      assert_contains(body, "data-player=\"/eui-score/player.js?v=")
      assert_contains(body, "href=\"/soundfonts/MuseScore_General_License.txt\"")
      assert_not(body.contains("html-midi-player"))
    end

    test("names the site once in its title, and carries its share tags") do
      body = res_body(get("/"))
      assert_contains(body, "<title>LilyPond engraving, native · EUI Score</title>")
      assert_eq(body.split("<title>")[1].split("</title>")[0].split("EUI Score").length - 1, 1)
      assert_contains(body, "<meta property=\"og:title\" content=\"LilyPond engraving, native · EUI Score\">")
      assert_contains(body, "og.png")
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
