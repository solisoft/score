# What this browser keeps of an account once the account is gone from it
# (#688), in a real browser (soli test --browser): signing out takes the
# undo histories of the account's scores (IndexedDB), the app's pages kept
# for offline use and the unsent text, and leaves the playground's own
# history; a session ended elsewhere takes the kept pages at the next
# sign-in page.

const SIGN_OUT_PASSWORD = "correct horse battery"
const SIGN_OUT_PAGES = "eui-score-pages-v3"

def sign_out_user
  user = User.new()
  user.email = "sign-out-#{uuid_v4}@example.com"
  user.set_password(SIGN_OUT_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  User.find_by("email", user.email)
end

# Signs out as a person does, from the account page's own button.
def sign_out_by_button
  visit("/app/account")
  evaluate("document.querySelector('form[action=\"/logout\"] button').click()")
  assert_page_path("/login")
  # The page's script clears what is kept: let it finish.
  sleep(1)
end

# The keys of `store` in the histories' database, or "none" without one.
def sign_out_history_keys(store)
  evaluate("(async () => { const named = (d) => d.name === 'eui-score-history';"
  + " if (!(await indexedDB.databases()).some(named)) return 'none';"
  + " const db = await new Promise((done, fail) => { const r = indexedDB.open('eui-score-history');"
  + " r.onsuccess = () => done(r.result); r.onerror = () => fail(r.error); });"
  + " const keys = await new Promise((done) => {"
  + " const r = db.transaction('#{store}').objectStore('#{store}').getAllKeys();"
  + " r.onsuccess = () => done(r.result); }); db.close(); return JSON.stringify(keys.sort()); })()")
end

# The URLs (path and query) kept in the app's pages' cache, or "none" without it.
def sign_out_kept_pages
  evaluate("(async () => { if (!(await caches.keys()).includes('#{SIGN_OUT_PAGES}')) return 'none';"
  + " const kept = await (await caches.open('#{SIGN_OUT_PAGES}')).keys();"
  + " return JSON.stringify(kept.map((r) => new URL(r.url).pathname).sort()); })()")
end

# Waits, five seconds at most, for `check` (a function) to answer `wanted`.
def sign_out_wait_for(wanted, check)
  answer = check()
  tries = 0
  while tries < 50 && answer != wanted
    sleep(0.1)
    answer = check()
    tries = tries + 1
  end
  answer
end

# Waits for the service worker to answer this page's requests.
def sign_out_controlled
  evaluate("navigator.serviceWorker.ready.then(() => true)")
  tries = 0
  while tries < 50 && !evaluate("Boolean(navigator.serviceWorker.controller)")
    sleep(0.1)
    tries = tries + 1
  end
  assert_eq(evaluate("Boolean(navigator.serviceWorker.controller)"), true, "the service worker controls the page")
end

describe("What the browser keeps, once signed out (#688)") do
  before_each() do
    logout()
    visit("/limits")
    evaluate("(async () => { indexedDB.deleteDatabase('eui-score-history');"
    + " for (const name of await caches.keys()) await caches.delete(name); return true; })()")
  end

  test("signing out takes the account's undo histories, kept pages and unsent text; the playground's stays") do
    user = sign_out_user()
    login(user.email, SIGN_OUT_PASSWORD)
    visit("/app")
    wait_for("#new-score")
    # The keys the editors keep their histories under: the app's per person
    # and score, the playground's of its own.
    assert_contains(File.read("app/views/app/scores/show.html.slv"), "history: `score:${page.me}:${page.key}`")
    assert_contains(File.read("public/eui-score/studio-history.js"), "`playground:${draftKey}`")
    mine = "score:#{user._key}:k1"
    playground = "playground:eui-score-studio-draft"
    kept = evaluate("(async () => { const db = await new Promise((done) => {"
    + " const r = indexedDB.open('eui-score-history', 1);"
    + " r.onupgradeneeded = () => { r.result.createObjectStore('histories'); r.result.createObjectStore('used'); };"
    + " r.onsuccess = () => done(r.result); });"
    + " const tx = db.transaction(['histories', 'used'], 'readwrite');"
    + " const keys = "
    + [mine, "score:someone-else:k2", playground].to_json
    + ";"
    + " for (const key of keys) {"
    + " tx.objectStore('histories').put({ end: 'the score text' }, key); tx.objectStore('used').put(1, key); }"
    + " await new Promise((done) => (tx.oncomplete = done)); db.close();"
    + " await (await caches.open('#{SIGN_OUT_PAGES}')).put('/app/scores/k1', new Response('a kept page'));"
    + " localStorage.setItem('eui-score-pending:k1', 'unsent'); return true; })()")
    assert_eq(kept, true)
    assert_eq(sign_out_history_keys("histories"), [
      mine,
      playground,
      "score:someone-else:k2"
    ].sort().to_json)

    sign_out_by_button()
    only_playground = [playground].to_json
    assert_eq(sign_out_wait_for(only_playground, fn() { sign_out_history_keys("histories") }), only_playground)
    assert_eq(sign_out_history_keys("used"), only_playground)
    assert_eq(sign_out_wait_for("none", fn() { sign_out_kept_pages() }), "none")
    assert_null(evaluate("localStorage.getItem('eui-score-pending:k1')"))
    assert_no_page_errors()
  end

  test("with no history kept, signing out makes no database of them") do
    user = sign_out_user()
    login(user.email, SIGN_OUT_PASSWORD)
    visit("/app")
    wait_for("#new-score")
    assert_eq(sign_out_history_keys("histories"), "none")
    sign_out_by_button()
    assert_eq(sign_out_history_keys("histories"), "none")
    assert_no_page_errors()
  end

  test("a session ended elsewhere: the next page is the sign-in, and the pages kept here go") do
    user = sign_out_user()
    login(user.email, SIGN_OUT_PASSWORD)
    visit("/app")
    wait_for("#new-score")
    sign_out_controlled()
    # Opened again under the worker: kept, as the offline copy. The account's page is not.
    visit("/app/account")
    visit("/app/notifications")
    noted = sign_out_wait_for(true, fn() { sign_out_kept_pages().contains("\"/app/notifications\"") })
    assert_eq(noted, true, "the notifications page is kept")
    assert_not(sign_out_kept_pages().contains("/app/account"), "the account's page is not")
    # Signed out everywhere (a password changed on another device): every session of the account ends.
    User.find_by("email", user.email).change_password("another horse battery staple")
    visit("/app/notifications")
    assert_page_path("/login")
    assert_eq(sign_out_wait_for("none", fn() { sign_out_kept_pages() }), "none")
    assert_no_page_errors()
  end
end
