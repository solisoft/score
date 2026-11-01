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

describe("the deploy") do
  test("takes off the server a copy of the notes an older deploy left there, and never sends one") do
    workflow = File.read(".github/workflows/deploy.yml")
    assert_contains(workflow, "--exclude='/public/js/CLAUDE.md'")
    sync = workflow.index_of("- name: Sync the files")
    removal = workflow.index_of("rm -f '$SITES_DIR/$DOMAIN/public/js/CLAUDE.md'")
    assert(sync > 0, "the sync step")
    assert(removal > sync, "the notes removed after the sync")
  end

  test("the csrf action checks the session cookie's new name, and keeps the first .env it replaced") do
    workflow = File.read(".github/workflows/prod-db.yml")
    assert_contains(workflow, "__Host-session_id")
    assert_contains(workflow, "[ -f .env.before-csrf ] || cp -p .env .env.before-csrf")
    assert_not(workflow.contains("everyone signs\n#             in once more"))
    assert_not(File.read("deploy/README.md").contains("everyone signed in signs in once more"))
  end
end
