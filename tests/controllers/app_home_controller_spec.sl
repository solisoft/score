describe("AppHomeController") do
  before_each() do
    as_guest()
    clear_cookies()
  end

  describe("GET /app") do
    test("opens the app in its own layout, with its share tags") do
      response = get("/app")
      assert_eq(res_status(response), 200)
      body = res_body(response)
      assert_contains(body, "class=\"app-header\"")
      assert_not(body.contains("class=\"site-footer\""))
      assert_contains(body, "<meta property=\"og:title\" content=\"Write music, keep it · EUI Score\">")
      assert_contains(body, "<link rel=\"canonical\" href=\"")
    end
  end

  describe("GET /app/setup") do
    test("says the app is not open yet, as a 503 a proxy will not cache") do
      response = get("/app/setup")
      assert_eq(res_status(response), 503)
      assert_contains(res_body(response), "The app is not open on this server yet")
      assert_contains(res_body(response), "href=\"/playground\"")
    end
  end

  describe("installing the app, and opening it offline") do
    test("its pages name the manifest and register the service worker") do
      body = res_body(get("/app"))
      assert_contains(body, "<link rel=\"manifest\" href=\"/manifest.webmanifest\">")
      assert_contains(body, "navigator.serviceWorker.register(\"/sw.js\", { scope: \"/\" })")
    end

    test("the manifest opens the app, with its icons") do
      manifest = JSON.parse(File.read("public/manifest.webmanifest"))
      assert_eq(manifest["start_url"], "/app")
      assert_eq(manifest["display"], "standalone")
      manifest["icons"].each do |icon|
        assert(File.exists("public" + icon["src"]), icon["src"])
      end
    end

    test("the service worker answers only for the app's pages, and keeps versioned files") do
      worker = File.read("public/sw.js")
      assert_contains(worker, "isAppPage(url)")
      assert_contains(worker, "url.search.includes(\"v=\")")
      assert_contains(worker, "You are offline")
    end
  end
end
