# The score editor's panels in French (#508): with the `locale` cookie set
# to "fr", its menus, toolbox, dialogs and page words come from
# config/locales/fr.yml, and the page hands its modules their dictionary
# (window.EUI_WORDS); without it they stay the English they were, and the
# playground stays English whatever the cookie says.

const FR_EDITOR_PASSWORD = "correct horse battery"

def fr_editor_user
  user = User.new()
  user.email = "fr-editor-#{uuid_v4}@example.com"
  user.set_password(FR_EDITOR_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

def fr_editor_sign_in(user)
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": FR_EDITOR_PASSWORD}
  )
end

# A signed-in person's editor page for a score of their own, its body.
def fr_editor_page(user)
  score = Score.start(user, Score.blank_source("Gavotte"))
  res_body(get("/app/scores/#{score._key}"))
end

describe("The score editor in French") do
  before_each() do
    as_guest()
    clear_headers()
    clear_cookies()
  end

  test("its menus, toolbox and dialogs are in French, its modules given their words") do
    user = fr_editor_user()
    fr_editor_sign_in(user)
    set_request_cookie("locale", "fr")
    page = fr_editor_page(user)
    assert_contains(page, "<summary class=\"studio-menu\">Fichier</summary>")
    assert_contains(page, "<summary class=\"studio-menu\">Édition</summary>")
    assert_contains(page, "<summary class=\"studio-menu\">Affichage</summary>")
    assert_contains(page, "<summary class=\"studio-menu\">Insertion</summary>")
    assert_contains(page, "<summary class=\"studio-menu\">Lecture</summary>")
    assert_contains(page, "title=\"Annuler (Ctrl+Z)\" aria-label=\"Annuler\"")
    assert_contains(page, "<summary><h3>Nuances</h3></summary>")
    assert_contains(page, "Propriétés de la partition")
    # The keys and pickups, from the helper.
    assert_contains(page, "<option value=\"-3\">Mi♭ majeur / do mineur</option>")
    assert_contains(page, "<option value=\"6\">Fa♯ majeur / ré♯ mineur</option>")
    assert_contains(page, "<option value=\"4.\">Une noire pointée</option>")
    # A raw sentence, its apostrophe as written.
    assert_contains(page, "depuis que vous l'avez ouverte")
    # The page's script words, and the modules' dictionary.
    assert_contains(page, "Vos changements s'enregistrent d'eux-mêmes.")
    assert_contains(page, "window.EUI_WORDS = {")
    assert_contains(page, "window.EUI_WORDS_LOCALE = \"fr\"")
    assert_not(page.contains(">Save the LilyPond source <kbd>"), "no English menu item left")
    assert_not(page.contains("<summary class=\"studio-menu\">File</summary>"), "no English menu")
  end

  test("stays English without a choice of language") do
    user = fr_editor_user()
    fr_editor_sign_in(user)
    page = fr_editor_page(user)
    assert_contains(page, "<summary class=\"studio-menu\">File</summary>")
    assert_contains(page, "<summary class=\"studio-menu\">Edit</summary>")
    assert_contains(page, "title=\"Undo (Ctrl+Z)\" aria-label=\"Undo\"")
    assert_contains(page, ">Save the LilyPond source <kbd>.ly</kbd>")
    assert_contains(page, "<option value=\"-3\">E♭ major / C minor</option>")
    assert_contains(
      page,
      "since you opened it. Your changes are not lost: they are kept here and in the score's history."
    )
    assert_contains(page, "{title}, {composer}, {piece}, {opus}, {copyright} and {page} are filled in.")
    assert_contains(page, "Your changes save themselves.")
    assert_contains(page, "window.EUI_WORDS = null")
    assert_not(page.contains("Fichier"), "no French menu")
  end

  test("the playground stays English with the French cookie set") do
    set_request_cookie("locale", "fr")
    page = res_body(get("/playground"))
    assert_contains(page, "<summary class=\"studio-menu\">File</summary>")
    assert_contains(page, "title=\"Undo (Ctrl+Z)\" aria-label=\"Undo\"")
    assert_contains(page, "<option value=\"-3\">E♭ major / C minor</option>")
    assert_contains(page, "window.EUI_WORDS = null")
    assert_not(page.contains("Fichier"), "no French menu")
  end

  test("the Start page hands the photo's words to its modules, in French only") do
    user = fr_editor_user()
    fr_editor_sign_in(user)
    english = res_body(get("/app"))
    assert_contains(english, "window.EUI_WORDS = null")
    set_request_cookie("locale", "fr")
    french = res_body(get("/app"))
    assert_contains(french, "window.EUI_WORDS = {")
    assert_contains(french, "En attente de l'IA… {time}")
    assert_contains(french, "<option value=\"0\" selected>Do majeur / la mineur</option>")
  end
end
