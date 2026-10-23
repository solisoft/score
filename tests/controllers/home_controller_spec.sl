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

    test("carries its share tags") do
      body = res_body(get("/"))
      assert_contains(body, "<meta property=\"og:title\"")
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

  describe("GET /health/ready") do
    # Jobs other specs queued wait unclaimed (`soli test` runs no worker).
    before_each() do
      Job.list().each do |job|
        Job.cancel(job["_key"]) rescue nil
      end
    end

    test("answers 200 where the database answers and no job is late") do
      response = get("/health/ready")
      assert_eq(res_status(response), 200)
      assert_eq(res_json(response)["status"], "ok")
      assert_eq(res_json(response)["problems"], [])
      assert_eq(res_header(response, "Cache-Control"), "no-store")
    end

    test("answers 503 with a short reason when a job is left far past its time") do
      job_id = Job.enqueue_at("DataCleanupJob", "2020-01-01T00:00:00Z", {})
      response = get("/health/ready")
      Job.cancel(job_id)
      assert_eq(res_status(response), 503)
      assert_eq(res_json(response)["status"], "not ready")
      assert_eq(res_json(response)["problems"], ["1 job(s) waiting past their time: no worker claims them"])
      assert_not(res_body(response).contains("6745"))
      # Liveness stays green: the process runs.
      assert_eq(res_status(get("/health")), 200)
    end
  end
end
