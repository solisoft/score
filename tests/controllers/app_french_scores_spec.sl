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
    set_request_cookie("locale", "en")
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
    set_request_cookie("locale", "en")
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
    set_request_cookie("locale", "en")
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
    set_request_cookie("locale", "en")
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
    set_request_cookie("locale", "en")
    english = res_body(get("/app/scores/#{score._key}/versions"))
    assert_contains(english, "<h1>History of “Gardée”</h1>")
    assert_contains(english, "kept on request")
    assert_not(english.contains("Historique"))
    assert_contains(
      res_body(get("/app/scores/#{score._key}/versions/#{version._key}")),
      ">Restore this version</button>"
    )
  end
end
