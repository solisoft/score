# What public/ serves (#544): the site's scripts, and not the notes kept
# for whoever writes them — those moved to docs/app/public-js.md.

describe("public/") do
  test("the agents' notes on the scripts are not served; the scripts are") do
    assert_eq(res_status(get("/js/CLAUDE.md")), 404)
    assert_not(File.exists("public/js/CLAUDE.md"))
    assert(File.exists("docs/app/public-js.md"))
    assert_contains(File.read("docs/app/public-js.md"), "soli:load")
    script = get("/js/score.js")
    assert_eq(res_status(script), 200)
    assert_contains(res_header(script, "Content-Type"), "javascript")
  end
end
