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

  # Under script-src 'self', a library the site serves is one markup slipped
  # into a page could load and drive (#688): htmx would run hx-* attributes.
  # Neither was used by any page.
  test("serves no htmx nor Alpine: no page used them, markup slipped in could") do
    ["htmx.min.js", "alpine.min.js"].each do |library|
      assert_not(File.exists("public/js/#{library}"), library)
      assert_eq(res_status(get("/js/#{library}")), 404, library)
    end
    ContentPolicy.view_files("app/views").each do |path|
      text = File.read(path).downcase
      assert_not(text.contains("htmx") || text.contains("alpine"), path)
    end
  end
end

describe("the deploy") do
  # Since #681 each deploy uploads into a release of its own (deploy/upload.sh)
  # and deploy/release.sh switches the site to it.
  test("never sends the notes, and takes any copy out of a release before it goes live") do
    workflow = File.read(".github/workflows/deploy.yml")
    assert_contains(workflow, "run: deploy/upload.sh \"$RELEASE\"")
    assert_contains(File.read("deploy/upload.sh"), "--exclude='/public/js/CLAUDE.md'")
    release = File.read("deploy/release.sh")
    removal = release.index_of("run rm -f \"$release/public/js/CLAUDE.md\"")
    switch = release.index_of("point_site_at \"$release\" ||")
    assert(removal > 0, "the notes removed from the release")
    assert(switch > removal, "before the site is switched to it")
  end

  test("the csrf action checks the session cookie's new name, and keeps the first .env it replaced") do
    workflow = File.read(".github/workflows/prod-db.yml")
    assert_contains(workflow, "__Host-session_id")
    assert_contains(workflow, "[ -f .env.before-csrf ] || cp -p .env .env.before-csrf")
    assert_not(workflow.contains("everyone signs\n#             in once more"))
    assert_not(File.read("deploy/README.md").contains("everyone signed in signs in once more"))
  end
end
