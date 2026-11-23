# The library's screens in French (#505): the list, sharing, the trash and
# the versions speak the `locale` cookie's language, English without it.

const FRENCH_SCORES_PASSWORD = "correct horse battery"

def french_scores_user
  user = User.new()
  user.email = "fr-scores-#{uuid_v4}@example.com"
  user.set_password(FRENCH_SCORES_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

def french_scores_sign_in(user)
  post(
    "/login",
    {"email": user.email, "password": FRENCH_SCORES_PASSWORD}
  )
end

# Back to English the way a reader goes back: the site's English home sets
# the `locale` cookie in its answer, which replaces the one the client holds.
# A second set_request_cookie("locale", "en") would not: it adds a cookie of
# the same name, and since Soli 2.39.1 the first of two wins (#1033).
def french_scores_back_to_english
  home = get("/")
  assert_eq(res_status(home), 200)
end

describe("The library in French") do
  before_each() do
    as_guest()
    clear_headers()
    clear_cookies()
  end

  test("the list is in French with the cookie, in English without") do
    owner = french_scores_user()
    Score.start(owner, Score.blank_source("Prélude"))
    Score.start(owner, Score.blank_source("Jetée")).move_to_trash
    french_scores_sign_in(owner)
    set_request_cookie("locale", "fr")
    french = get("/app/scores")
    assert_eq(res_status(french), 200)
    body = res_body(french)
    assert_contains(body, "<h1>Vos partitions</h1>")
    assert_contains(body, ">Nouvelle partition</a>")
    assert_contains(body, "placeholder=\"Titre ou compositeur\"")
    assert_contains(body, ">Dernière modification</option>")
    assert_contains(body, ">Mettre à la corbeille</button>")
    assert_contains(body, ">Faire une copie</button>")
    assert_contains(body, "Modifiée ")
    assert_contains(body, ">Corbeille (1)</a>")
    assert_eq(assigns()["title"], "Vos partitions")
    assert_not(body.contains("Your scores"))
    assert_not(body.contains("Move to the trash"))
    # A search that finds nothing, in French too.
    nothing = res_body(get("/app/scores?q=zzz"))
    assert_contains(nothing, "Aucun titre ni compositeur ne contient « zzz »")
    french_scores_back_to_english()
    english = res_body(get("/app/scores"))
    assert_contains(english, "<h1>Your scores</h1>")
    assert_contains(english, ">Last changed</option>")
    assert_contains(english, ">Move to the trash</button>")
    assert_contains(english, ">Trash (1)</a>")
    assert_not(english.contains("Vos partitions"))
  end

  test("the trash, its notices and its confirmations are in French") do
    owner = french_scores_user()
    score = Score.start(owner, Score.blank_source("Jetée"))
    french_scores_sign_in(owner)
    set_request_cookie("locale", "fr")
    post("/app/scores/#{score._key}/trash", {})
    assert(Score.find(score._key).trashed?)
    trash = res_body(get("/app/trash"))
    assert_contains(trash, "<h1>Corbeille</h1>")
    assert_contains(trash, "Une partition reste ici #{SCORE_TRASH_DAYS} jours")
    assert_contains(trash, ">Restaurer</button>")
    assert_contains(trash, "Supprimer définitivement")
    assert_contains(trash, "Vider la corbeille")
    assert_contains(trash, "mise à la corbeille ")
    assert_not(trash.contains("Delete for good"))
    # The account kept French; the cookie set to English wins.
    french_scores_back_to_english()
    english = res_body(get("/app/trash"))
    assert_contains(english, "<h1>Trash</h1>")
    assert_contains(english, "Delete for good")
    assert_not(english.contains("Corbeille"))
  end

  test("a refused action answers in French, and changes nothing") do
    owner = french_scores_user()
    score = Score.start(owner, Score.blank_source("Gardée"))
    french_scores_sign_in(owner)
    set_request_cookie("locale", "fr")
    refused = delete("/app/scores/#{score._key}")
    assert_eq(res_status(refused), 422)
    assert_contains(res_body(refused), "Mettez d'abord la partition à la corbeille.")
    assert_not(Score.find(score._key).trashed?)
    odd = post("/app/scores/#{score._key}/share", {"visibility": "everyone"})
    assert_eq(res_status(odd), 422)
    assert_contains(res_body(odd), "Choisissez privée, par lien ou publique.")
    assert_eq(Score.find(score._key).visibility, "private")
    french_scores_back_to_english()
    english = delete("/app/scores/#{score._key}")
    assert_eq(res_status(english), 422)
    assert_contains(res_body(english), "Move the score to the trash first.")
    assert(Score.find(score._key).present?)
  end

  test("the share page is in French with the cookie, in English without") do
    owner = french_scores_user()
    score = Score.start(owner, Score.blank_source("Partagée"))
    french_scores_sign_in(owner)
    set_request_cookie("locale", "fr")
    french = get("/app/scores/#{score._key}/share")
    assert_eq(res_status(french), 200)
    body = res_body(french)
    assert_contains(body, "<h1>Partager « Partagée »</h1>")
    assert_contains(body, "<b>Toute personne ayant le lien</b>")
    assert_contains(body, "data-copied=\"Copié\"")
    assert_contains(body, ">Inviter</button>")
    assert_contains(body, "Personne pour l")
    assert_not(body.contains("Who may read it"))
    post("/app/scores/#{score._key}/share", {"visibility": "link"})
    shared = res_body(get("/app/scores/#{score._key}/share"))
    assert_contains(shared, "« Partagée » est maintenant ouverte à qui a son lien.")
    french_scores_back_to_english()
    english = res_body(get("/app/scores/#{score._key}/share"))
    assert_contains(english, "<h1>Share “Partagée”</h1>")
    assert_contains(english, "<b>Anyone with the link</b>")
    assert_contains(english, "data-copied=\"Copied\"")
    assert_not(english.contains("Inviter"))
  end

  test("the versions and a version are in French with the cookie, in English without") do
    owner = french_scores_user()
    score = Score.start(owner, Score.blank_source("Gardée"))
    version = ScoreVersion.keep(score, score.source, "manual", owner._key)
    french_scores_sign_in(owner)
    set_request_cookie("locale", "fr")
    history = get("/app/scores/#{score._key}/versions")
    assert_eq(res_status(history), 200)
    body = res_body(history)
    assert_contains(body, "<h1>Historique de « Gardée »</h1>")
    assert_contains(body, "gardée à la demande")
    assert_contains(body, ">Afficher</a>")
    assert_eq(assigns()["title"], "Historique de Gardée")
    one = res_body(get("/app/scores/#{score._key}/versions/#{version._key}"))
    assert_contains(one, ">Toutes les versions</a>")
    assert_contains(one, ">Restaurer cette version</button>")
    french_scores_back_to_english()
    english = res_body(get("/app/scores/#{score._key}/versions"))
    assert_contains(english, "<h1>History of “Gardée”</h1>")
    assert_contains(english, "kept on request")
    assert_not(english.contains("Historique"))
    assert_contains(
      res_body(get("/app/scores/#{score._key}/versions/#{version._key}")),
      ">Restore this version</button>"
    )
  end

  test("the editor's bar, menus, tools and first gestures are in French with the cookie, in English without (#926)") do
    owner = french_scores_user()
    score = Score.start(owner, Score.blank_source("Éditée"))
    french_scores_sign_in(owner)
    set_request_cookie("locale", "fr")
    french = get("/app/scores/#{score._key}")
    assert_eq(res_status(french), 200)
    body = res_body(french)
    # The bar: Find a command (#919), and the Format menu (#920).
    assert_contains(body, "aria-label=\"Chercher une commande\"")
    assert_contains(body, "title=\"Chercher une commande par son nom (/)\"")
    assert_contains(body, "placeholder=\"Que voulez-vous faire ?\"")
    assert_contains(body, "Rien à ce nom.")
    assert_contains(body, "<summary class=\"studio-menu\">Format</summary>")
    # The menus' groups (#920, #926).
    for head in ["Portées, voix", "Annuler", "Copier et coller", "Lignes et pages", "Arranger", "Mesures"]
      assert_contains(body, "role=\"presentation\">#{head}</div>")
    end
    # The tools: the signs set most often (#925).
    assert_contains(body, "<summary><h3>Courant</h3></summary>")
    # The first gestures (#922), and the way back to them.
    assert_contains(body, "id=\"studio-welcome-title\">Trois gestes pour commencer</h2>")
    assert_contains(body, "<strong>Cliquez sur une note</strong> pour la sélectionner.")
    assert_contains(body, "<strong>Appuyez sur N</strong>")
    assert_contains(body, "<strong>Appuyez sur Espace</strong> pour écouter")
    assert_contains(body, ">Compris</button>")
    assert_contains(body, "data-act=\"welcome\">Premiers gestes</button>")
    # What the editor says itself, from its words (#508): the hints under the score (#918), the / key (#919).
    words = EditorWords.of("fr")
    assert_eq(words["Space plays · ? shows every key"], "Espace joue · ? montre toutes les touches")
    assert_contains(
      words["↑ ↓ move it · 2–7 change its length · Delete makes a rest · N writes notes"],
      "↑ ↓ la déplacent"
    )
    assert_contains(
      words["↑ ↓ move them · Ctrl+C copies them · Delete makes rests · Esc lets go"],
      "↑ ↓ les déplacent"
    )
    assert_eq(words["find a command by its name"], "chercher une commande par son nom")
    assert_contains(body, "Espace joue · ? montre toutes les touches")
    # No key left untranslated, no English beside the French.
    for english in [
      "Find a command",
      "What do you want to do?",
      "Three gestures to start",
      "Got it",
      "Most used",
      "Getting started",
      "Copy and paste",
      "Lines and pages"
    ]
      assert_not(body.contains(english), "no “#{english}” in the French editor")
    end
    assert_not(body.contains("app.editor."), "no key shown for want of its words")
    # Without the cookie, for an account that never chose French: English.
    clear_cookies()
    other = french_scores_user()
    plain = Score.start(other, Score.blank_source("Edited"))
    french_scores_sign_in(other)
    english_body = res_body(get("/app/scores/#{plain._key}"))
    assert_contains(english_body, "aria-label=\"Find a command\"")
    assert_contains(english_body, "<summary><h3>Most used</h3></summary>")
    assert_contains(english_body, ">Three gestures to start</h2>")
    assert_not(english_body.contains("Chercher une commande"))
    assert_not(english_body.contains("app.editor."))
  end
end
