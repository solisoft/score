# The photo imports and the OAuth consent page in French (#505): the
# `locale` cookie set to "fr" turns them French, words, states and fixed
# failures; without it they stay English. What a reading keeps stays
# English, as the MCP server reads it.

const FRENCH_READING_PASSWORD = "correct horse battery"
const FRENCH_READING_PNG = "iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAAAAADaLSBnAAAAFUlEQVR42mP4TyRgGFU4qnBUIQgAAIy4"
+ "HQ6Y693OAAAAAElFTkSuQmCC"
const FRENCH_OAUTH_REDIRECT = "http://127.0.0.1:33418/callback"
const FRENCH_OAUTH_VERIFIER = "spec-verifier-0123456789-abcdefghijklmnopqrstuvwxyz"

# Someone signed in (with an AI key unless `keyless`), in `locale` when given.
def french_reading_user(locale = nil, keyless = false)
  user = User.new()
  user.email = "french-photo-#{uuid_v4}@example.com"
  user.set_password(FRENCH_READING_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user.keep_ai_key("mistral", "pixtral-large-latest", "sk-mistral-2222") unless keyless
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": FRENCH_READING_PASSWORD}
  )
  set_request_cookie("locale", locale) unless locale.nil?
  User.find(user._key)
end

# `user`'s three readings: one read, one cut off, one being thought over.
def french_readings_of(user)
  now = DateTime.utc.to_unix
  ScoreReading.create({
    "user_id": user._key,
    "state": "done",
    "source": "\\header { title = \"Read one\" }\n{ c'1 }\n",
    "created_at": now - 100,
    "finished_at": now - 90
  })
  ScoreReading.create({
    "user_id": user._key,
    "state": "failed",
    "error": "The reading was interrupted. Try again.",
    "created_at": now - 50
  })
  ScoreReading.create({
    "user_id": user._key,
    "state": "reading",
    "phase": "thinking",
    "created_at": now - 10,
    "progressed_at": now - 2
  })
end

def french_oauth_authorize_path(client_id)
  challenge = Base64.urlsafe_encode(Hex.decode(Crypto.sha256(FRENCH_OAUTH_VERIFIER)))
  "/oauth/authorize?response_type=code&client_id=" + client_id + "&redirect_uri="
  + url(FRENCH_OAUTH_REDIRECT)
  + "&code_challenge="
  + challenge
  + "&code_challenge_method=S256&state=st4te"
end

# The consent page, asked by a client named "Claude Code".
def french_consent_page
  clear_headers()
  set_header("Content-Type", "application/json")
  registered = post("/oauth/register", {
    "client_name": "Claude Code",
    "redirect_uris": [FRENCH_OAUTH_REDIRECT]
  }.to_json)
  clear_headers()
  get(french_oauth_authorize_path(res_json(registered)["client_id"]))
  get("/app/oauth/consent")
end

describe("Photo imports and the consent page in French (#505)") do
  before_each() do
    as_guest()
    clear_headers()
    clear_cookies()
  end

  test("the imports list: French with the cookie, English without") do
    french = french_reading_user("fr")
    french_readings_of(french)
    page = get("/app/imports")
    assert_eq(res_status(page), 200)
    body = res_body(page)
    assert_contains(body, "<html lang=\"fr\">")
    assert_contains(body, "Imports de photos")
    assert_contains(body, "Les photos sont gardées une semaine")
    assert_contains(body, "non lue : La lecture a été interrompue. Réessayez.")
    assert_contains(body, "en cours de lecture : l&#x27;IA réfléchit, commencée il y a")
    assert_contains(body, "lue il y a")
    assert_contains(body, ">En cours de lecture</span>")
    assert_contains(body, ">Non lue</span>")
    assert_contains(body, ">Lue</span>")
    assert_not(body.contains("Photo imports"), "no English left")
    assert_not(body.contains("Being read"))
    assert_not(body.contains("The reading was interrupted"))

    english = french_reading_user()
    french_readings_of(english)
    body = res_body(get("/app/imports"))
    assert_contains(body, "<html lang=\"en\">")
    assert_contains(body, "Photo imports")
    assert_contains(body, "not read: The reading was interrupted. Try again.")
    assert_contains(body, "being read: the AI is thinking, started")
    assert_contains(body, ">Being read</span>")
    assert_not(body.contains("Imports de photos"))
  end

  test("no import yet: the empty list's words, its link kept") do
    french_reading_user("fr")
    body = res_body(get("/app/imports"))
    assert_contains(body, "Aucune photo lue pour l'instant. Sur <a href=\"/app\">Démarrer</a>")
    french_reading_user("en")
    body = res_body(get("/app/imports"))
    assert_contains(body, "No photo read yet. On <a href=\"/app\">Start</a>, choose")
  end

  test("an import's page being read: its words and the live status in French; English without") do
    user = french_reading_user("fr")
    reading = ScoreReading.create({
      "user_id": user._key,
      "state": "reading",
      "phase": "thinking",
      "picture": FRENCH_READING_PNG,
      "created_at": DateTime.utc.to_unix,
      "progressed_at": DateTime.utc.to_unix
    })
    body = res_body(get("/app/imports/#{reading._key}"))
    assert_contains(body, ">Imports de photos</a>")
    assert_contains(body, "Lecture en cours…")
    assert_contains(body, "alt=\"La photo\"")
    assert_contains(body, "Photo du ", "untitled: named after its date, in French")
    assert_contains(body, "En attente de l")
    assert_contains(body, "{chars} caract")
    assert_contains(body, "\"numbers\":\"fr\"")
    assert_not(body.contains("Being read"))
    assert_not(body.contains("Photo of "))

    english = french_reading_user()
    mine = ScoreReading.create({
      "user_id": english._key,
      "state": "reading",
      "created_at": DateTime.utc.to_unix,
      "progressed_at": DateTime.utc.to_unix
    })
    body = res_body(get("/app/imports/#{mine._key}"))
    assert_contains(body, "Being read…")
    assert_contains(body, "Photo of ")
    assert_contains(body, "Waiting for the AI… {time}")
    assert_contains(body, "\"numbers\":\"en\"")
  end

  test("a read import's page: its actions in French") do
    user = french_reading_user("fr")
    reading = ScoreReading.create({
      "user_id": user._key,
      "state": "done",
      "picture": FRENCH_READING_PNG,
      "source": "\\header { title = \"Little\" }\n{ c'4 d' e' f' }\n",
      "created_at": DateTime.utc.to_unix
    })
    body = res_body(get("/app/imports/#{reading._key}"))
    assert_contains(body, "Ouvrir comme partition")
    assert_contains(body, "La relire")
    assert_contains(body, "Ce qui a été lu. Vous pouvez le corriger dans l&#x27;éditeur.")
    assert_not(body.contains("Open as a score"))
  end

  test("a reading cut off, seen in French: the page says it in French, the reading keeps it in English") do
    user = french_reading_user("fr")
    long_ago = DateTime.utc.to_unix - SCORE_READING_SILENT - 60
    reading = ScoreReading.create({
      "user_id": user._key,
      "state": "reading",
      "created_at": long_ago,
      "progressed_at": long_ago
    })
    body = res_body(get("/app/imports/#{reading._key}"))
    assert_contains(body, "La lecture a été interrompue. Réessayez.")
    kept = ScoreReading.find(reading._key)
    assert_eq(kept.state, "failed")
    assert_eq(kept.error, "The reading was interrupted. Try again.", "what the MCP server reads")
    assert_eq(res_json(get("/app/readings/#{reading._key}"))["error"], "La lecture a été interrompue. Réessayez.")
  end

  test("shown_error: the fixed sentences in the page's language, a provider's words as they came") do
    reading = ScoreReading.new()
    reading.error = "No music was found in the picture."
    I18n.set_locale("fr")
    assert_eq(reading.shown_error, "Aucune musique n'a été trouvée sur l'image.")
    reading.error = "Mistral is busy. Try again in a moment."
    assert_eq(reading.shown_error, "Mistral is busy. Try again in a moment.")
    assert_eq(ScoreReading.refusal_words("used_up"), "Vous avez lu toutes les photos du jour : réessayez demain.")
    assert_eq(ScoreReading.refusal_words("plan"), "L'IA avec votre propre clé fait partie de Pro.")
    I18n.set_locale("en")
    reading.error = "No music was found in the picture."
    assert_eq(reading.shown_error, "No music was found in the picture.")
    assert_eq(ScoreReading.refusal_words("no_key"), AI_NO_KEY)
    assert_eq(ScoreReading.refusal_words("plan"), AI_PRO_ONLY)
  end

  test("refusals in French: no photo sent, reading again without a key; nothing started") do
    user = french_reading_user("fr")
    set_header("Content-Type", "application/json")
    refused = post("/app/readings", JSON.stringify({"picture": ""}))
    clear_headers()
    assert_eq(res_status(refused), 422)
    assert_eq(res_json(refused)["error"], "Choisissez une photo de la partition.")
    assert_eq(ScoreReading.where({"user_id": user._key}).count, 0)

    keyless = french_reading_user("fr", true)
    reading = ScoreReading.create({
      "user_id": keyless._key,
      "state": "failed",
      "error": "x",
      "picture": FRENCH_READING_PNG,
      "created_at": DateTime.utc.to_unix
    })
    again = post("/app/imports/#{reading._key}/retry", {})
    assert_eq(res_location(again), "/app/imports/#{reading._key}")
    assert_eq(ScoreReading.where({"user_id": keyless._key}).count, 1, "nothing read again")
    body = res_body(get("/app/imports/#{reading._key}"))
    assert_contains(body, "Ajoutez votre propre clé")
    assert_not(body.contains("Add your own AI key"))
  end

  test("the consent page: French with the cookie, English without") do
    french_reading_user("fr")
    page = french_consent_page()
    assert_eq(res_status(page), 200)
    body = res_body(page)
    # Named by where it goes back to, the name only quoted (#541).
    assert_contains(
      body,
      "Une application de cet ordinateur veut accéder à vos partitions, en se présentant comme « Claude Code »"
    )
    assert_contains(body, "Score ne vérifie pas ce nom")
    assert_contains(body, "<strong>Claude Code</strong> demande à accéder à vos partitions")
    assert_contains(body, "<code>127.0.0.1:33418</code>")
    assert_contains(body, ">Autoriser</button>")
    assert_contains(body, ">Refuser</button>")
    assert_contains(body, "Lister et lire vos partitions")
    assert_not(body.contains(">Allow</button>"))

    french_reading_user()
    body = res_body(french_consent_page())
    assert_contains(body, "An app on this computer wants to reach your scores, calling itself “Claude Code”")
    assert_contains(body, ">Allow</button>")
    assert_contains(body, ">Deny</button>")
    assert_contains(body, "You can disconnect it any time in")
  end
end
