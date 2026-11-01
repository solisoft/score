# The app's layout, Start page, set-up page and notifications in French
# (#505): with the `locale` cookie set to "fr", their words come from
# config/locales/fr.yml; without it, they stay the English they were.

const FR_HOME_PASSWORD = "correct horse battery"

def fr_home_user
  user = User.new()
  user.email = "fr-home-#{uuid_v4}@example.com"
  user.set_password(FR_HOME_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

def fr_home_sign_in(user)
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": FR_HOME_PASSWORD}
  )
end

# `reader` told of a mention by `owner`, and of a change by two people.
def fr_home_notified(owner, reader, other)
  score = Score.start(owner, Score.blank_source("Rondo"))
  ScoreShare.invite(score, reader.email, "read")
  UserNotification.tell(reader._key, "mention", score, owner, {
    "thread_id": "t1",
    "label": "Bar 1"
  })
  changed = UserNotification.tell(reader._key, "changed", score, owner)
  changed.joined_by(other)
  score
end

describe("The app in French") do
  before_each() do
    as_guest()
    clear_headers()
    clear_cookies()
  end

  test("the Start page and the layout speak French with the cookie") do
    fr_home_sign_in(fr_home_user())
    set_request_cookie("locale", "fr")
    response = get("/app")
    assert_eq(res_status(response), 200)
    page = res_body(response)
    assert_contains(page, "<html lang=\"fr\">")
    assert_contains(page, "<title>Commencer · Score</title>")
    assert_contains(page, "<h1>Commencer</h1>")
    assert_contains(page, "<h2>Nouvelle partition</h2>")
    assert_contains(page, "<h2>Importer</h2>")
    assert_contains(page, "placeholder=\"Sans titre\"")
    assert_contains(page, ">Créer la partition</button>")
    assert_contains(page, "Vos partitions seront ici.")
    assert_contains(page, ">Vos partitions</a>")
    assert_contains(page, ">Compte</a>")
    assert_contains(page, "aria-label=\"App Score, accueil\"")
    assert_contains(page, "\"one\":\"Notifications, {count} non lue\"")
    # The templates' names, handed to the page's script.
    assert_contains(page, "\"string-quartet\":{\"name\":\"Quatuor à cordes\"")
    assert_contains(page, "\"untitled\":\"Sans titre\"")
    assert_not(page.contains("Create the score"))
    assert_not(page.contains("Your scores"))
  end

  test("the Start page and the layout stay English without it") do
    fr_home_sign_in(fr_home_user())
    page = res_body(get("/app"))
    assert_contains(page, "<html lang=\"en\">")
    assert_contains(page, "<h1>Start</h1>")
    assert_contains(page, "<h2>New score</h2>")
    assert_contains(page, ">Create the score</button>")
    assert_contains(page, ">Your scores</a>")
    assert_contains(page, "aria-label=\"Score app, home\"")
    assert_contains(page, "\"other\":\"Notifications, {count} unread\"")
    # The score model's own names, untouched.
    assert_contains(page, "\"templates\":{}")
    assert_not(page.contains("Nouvelle partition"))
  end

  test("a guest's Start page and the set-up page, in each language") do
    set_request_cookie("locale", "fr")
    guest = res_body(get("/app"))
    assert_contains(guest, "<h1>Écrire de la musique, la garder</h1>")
    assert_contains(guest, "<a href=\"/playground\">bac à sable</a>")
    setup = get("/app/setup")
    assert_eq(res_status(setup), 503)
    assert_contains(res_body(setup), "L&#x27;app n&#x27;est pas encore ouverte sur ce serveur")
    clear_cookies()
    assert_contains(res_body(get("/app")), "<h1>Write music, keep it</h1>")
    assert_contains(res_body(get("/app/setup")), "<h1>The app is not open on this server yet</h1>")
  end

  test("the notifications page and its sentences speak French with the cookie") do
    owner = fr_home_user()
    other = fr_home_user()
    reader = fr_home_user()
    fr_home_notified(owner, reader, other)
    fr_home_sign_in(reader)
    set_request_cookie("locale", "fr")
    page = res_body(get("/app/notifications"))
    assert_contains(page, "<h1>Notifications</h1>")
    assert_contains(page, ">Tout marquer comme lu</button>")
    assert_contains(page, ">Marquer comme lue</button>")
    assert_contains(page, "#{owner.email} vous a mentionné sur « Rondo », Bar 1")
    assert_contains(page, "#{owner.email} et #{other.email} ont modifié « Rondo »")
    assert_contains(page, "réglages des e-mails</a>")
    assert_not(page.contains("Mark all read"))
    response = post("/app/notifications/read-all", {})
    assert_eq(res_status(response), 302)
    assert_contains(res_body(get("/app/notifications")), "Tout est marqué comme lu.")
    assert_eq(UserNotification.unread_count(reader), 0)
  end

  test("the notifications page stays English without it; e-mails and pushes are English either way") do
    owner = fr_home_user()
    other = fr_home_user()
    reader = fr_home_user()
    fr_home_notified(owner, reader, other)
    fr_home_sign_in(reader)
    page = res_body(get("/app/notifications"))
    assert_contains(page, ">Mark all read</button>")
    assert_contains(page, "#{owner.email} mentioned you on “Rondo”, Bar 1")
    assert_contains(page, "#{owner.email} and #{other.email} changed “Rondo”")
    told = UserNotification.recent(reader).filter do |notification|
      notification.kind == "changed"
    end[0]
    assert_eq(told.sentence("fr"), "#{owner.email} et #{other.email} ont modifié « Rondo »")
    assert_contains(told.sentence, "changed “Rondo”")
    assert_eq(UserNotification.new().actors_said("fr"), "Quelqu'un")
    assert_eq(UserNotification.new().actors_said, "Someone")
  end

  test("a notification that is not one's own is a 404, in French too") do
    owner = fr_home_user()
    reader = fr_home_user()
    fr_home_notified(owner, reader, fr_home_user())
    fr_home_sign_in(owner)
    set_request_cookie("locale", "fr")
    told = UserNotification.recent(reader)[0]
    response = post("/app/notifications/#{told._key}/read", {})
    assert_eq(res_status(response), 404)
    assert_eq(UserNotification.find(told._key).read?, false)
  end
end
