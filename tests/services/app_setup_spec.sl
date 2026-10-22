describe("AppSetup") do
  test("the app runs where a database host is configured") do
    assert(AppSetup.configured?("http://127.0.0.1:6745"))
    assert(AppSetup.ready?)
  end

  test("and not where none is") do
    assert_not(AppSetup.configured?(nil))
    assert_not(AppSetup.configured?(""))
  end

  test("the middleware lets a request through where the app runs") do
    request_hash = {"path": "/app"}
    assert_eq(require_app_database(request_hash), request_hash)
  end
end
