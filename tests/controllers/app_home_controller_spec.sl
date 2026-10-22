describe("AppHomeController") do
  describe("GET /app") do
    test("opens the app in its own layout, with its share tags") do
      response = get("/app")
      assert_eq(res_status(response), 200)
      body = res_body(response)
      assert_contains(body, "class=\"app-header\"")
      assert_not(body.contains("class=\"site-footer\""))
      assert_contains(body, "<meta property=\"og:title\" content=\"Your scores · EUI Score\">")
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
end
