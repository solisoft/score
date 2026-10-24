# Comments that follow their bars, the score's people for @, and the read
# page's way into the room (#392), over HTTP: who may, who may not, and
# what each leaves stored.

const FOLLOW_PASSWORD = "correct horse battery"

def follow_user(name = nil)
  user = User.new()
  user.email = "follow-#{uuid_v4}@example.com"
  user.name = name unless name.nil?
  user.set_password(FOLLOW_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

def follow_sign_in(user)
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": FOLLOW_PASSWORD}
  )
end

# A score of six bars, its owner's, shared with an editor and a reader:
# {"score", "owner", "editor", "reader", "stranger"}.
def follow_room
  owner = follow_user("Olga Owner")
  editor = follow_user("Eddie Editor")
  reader = follow_user()
  score = Score.start(owner, "\\header { title = \"Moving\" }\n{ c'1 | d'1 | e'1 | f'1 | g'1 | a'1 }")
  ScoreShare.invite(score, editor.email, "write")
  ScoreShare.invite(score, reader.email, "read")
  {
    "score": score,
    "owner": owner,
    "editor": editor,
    "reader": reader,
    "stranger": follow_user("Sam Stranger")
  }
end

# A thread of `user`'s on `score`, on lane 0 and bars [first, last].
def follow_thread(score, user, first, last)
  ScoreThread.start(score, user, 0, [first, last], "", "Here")["thread"]
end

# The editor's save of `score`, with `anchors`.
def follow_save(
  score,
  anchors,
  source = "\\header { title = \"Moving\" }\n{ c'1 | b'1 | d'1 | e'1 | f'1 | g'1 | a'1 }"
)
  put(
    "/app/scores/#{score._key}",
    {
      "source": source,
      "revision": Score.find(score._key).revision,
      "origin": "editor-x",
      "anchors": anchors
    }
  )
end

# A bar put in as bar 2 (index 1): six bars become seven.
const FOLLOW_INSERTED = {
  "from": 6,
  "to": 7,
  "bars": [[0, 0, 1], [
    1,
    2,
    5
  ]],
  "lanes": [0]
}

describe("Comments follow their bars (#392)") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  test("a save that puts a bar in moves the threads after it, answers them, and leaves those before") do
    room = follow_room()
    score = room["score"]
    before = follow_thread(score, room["owner"], 0, 0)
    after = follow_thread(score, room["reader"], 2, 3)
    follow_sign_in(room["editor"])
    saved = follow_save(score, FOLLOW_INSERTED)
    assert_eq(res_status(saved), 200)
    assert_eq(ScoreThread.find(before._key).bars, [0, 0])
    moved = ScoreThread.find(after._key)
    assert_eq(moved.bars, [3, 4])
    assert_eq(moved.label, "Bars 4–5, staff 1", "the label says the new bars")
    answered = res_json(saved)["threads"]
    assert_eq(answered.length, 1)
    assert_eq(answered[0]["id"], after._key)
    assert_eq(answered[0]["bars"], [3, 4])
  end

  test("a thread whose bars were all taken away is kept, marked detached, on the bars it had") do
    room = follow_room()
    score = room["score"]
    gone = follow_thread(score, room["owner"], 1, 2)
    follow_sign_in(room["owner"])
    removed = {
      "from": 6,
      "to": 4,
      "bars": [[0, 0, 1], [
        3,
        1,
        3
      ]],
      "lanes": [0]
    }
    saved = follow_save(score, removed, "\\header { title = \"Moving\" }\n{ c'1 | f'1 | g'1 | a'1 }")
    assert_eq(res_status(saved), 200)
    kept = ScoreThread.find(gone._key)
    assert_eq(kept.detached, "bars")
    assert_eq(kept.bars, [1, 2])
    assert_eq(res_json(saved)["threads"][0]["detached"], "bars")
    assert_eq(ScoreComment.where({"thread_id": gone._key}).count, 1, "its messages stay")
  end

  test("a save without anchors, or with ones that do not read, moves nothing") do
    room = follow_room()
    score = room["score"]
    thread = follow_thread(score, room["owner"], 2, 2)
    follow_sign_in(room["owner"])
    plain = follow_save(score, nil)
    assert_eq(res_status(plain), 200)
    assert_null(res_json(plain)["threads"])
    garbage = follow_save(
      score,
      {
        "from": 6,
        "to": 7,
        "bars": [[0, 9, 99]]
      }
    )
    assert_eq(res_status(garbage), 200)
    assert_eq(ScoreThread.find(thread._key).bars, [2, 2])
  end

  test("a refused save moves nothing: stale (409), or by a reader or a stranger (403)") do
    room = follow_room()
    score = room["score"]
    thread = follow_thread(score, room["owner"], 2, 2)
    follow_sign_in(room["owner"])
    stale = put(
      "/app/scores/#{score._key}",
      {
        "source": "{ c'1 }",
        "revision": score.revision - 1,
        "anchors": FOLLOW_INSERTED
      }
    )
    assert_eq(res_status(stale), 409)
    ["reader", "stranger"].each do |role|
      follow_sign_in(room[role])
      assert_eq(res_status(follow_save(score, FOLLOW_INSERTED)), 403, role)
    end
    assert_eq(ScoreThread.find(thread._key).bars, [2, 2])
    assert_null(ScoreThread.find(thread._key).detached)
  end

  test("only the saved score's threads move, never another's") do
    room = follow_room()
    other = follow_room()
    theirs = follow_thread(other["score"], other["owner"], 3, 3)
    follow_sign_in(room["owner"])
    assert_eq(res_status(follow_save(room["score"], FOLLOW_INSERTED)), 200)
    assert_eq(ScoreThread.find(theirs._key).bars, [3, 3])
  end
end

describe("The score's people, for @ (#392)") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  test("its owner, its editor and its reader each get the score's people, by name, and nobody else") do
    room = follow_room()
    score = room["score"]
    # Shared with an address that has no account yet: nobody an @ can tell.
    ScoreShare.invite(score, "nobody-yet-#{uuid_v4}@example.com", "read")
    ["owner", "editor", "reader"].each do |role|
      follow_sign_in(room[role])
      listed = get("/app/scores/#{score._key}/people")
      assert_eq(res_status(listed), 200, role)
      people = res_json(listed)["people"]
      emails = people.map do |person|
        person["email"]
      end
      assert_eq(emails.length, 3, role)
      ["owner", "editor", "reader"].each do |who|
        assert_contains(emails, room[who].email)
      end
      assert_not(emails.includes?(room["stranger"].email), "a stranger is not one of the score's people")
      assert_eq(people[0]["name"], "Eddie Editor", "listed by name")
    end
  end

  test("a stranger is refused (403), a guest too (401), a trashed score answers 404, an unknown one 404") do
    room = follow_room()
    score = room["score"]
    follow_sign_in(room["stranger"])
    assert_eq(res_status(get("/app/scores/#{score._key}/people")), 403)
    clear_cookies()
    set_header("Accept", "application/json")
    assert_eq(res_status(get("/app/scores/#{score._key}/people")), 401)
    clear_headers()
    follow_sign_in(room["owner"])
    assert_eq(res_status(get("/app/scores/no-such-score/people")), 404)
    score.move_to_trash
    assert_eq(res_status(get("/app/scores/#{score._key}/people")), 404)
  end

  test("once the reader's share is removed, they are refused the list") do
    room = follow_room()
    score = room["score"]
    follow_sign_in(room["reader"])
    assert_eq(res_status(get("/app/scores/#{score._key}/people")), 200)
    ScoreShare.where({"score_id": score._key, "email": room["reader"].email}).first.delete
    assert_eq(res_status(get("/app/scores/#{score._key}/people")), 403)
  end
end

describe("The read page's way into the room (#392)") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  test("a reader gets a listening ticket, which the room admits to listen only") do
    room = follow_room()
    score = room["score"]
    follow_sign_in(room["reader"])
    answered = get("/s/#{score.share_token}/room_ticket")
    assert_eq(res_status(answered), 200)
    ticket = res_json(answered)["ticket"]
    admitted = ScoreRoom.admit(ticket, DateTime.utc.to_unix)
    assert_eq(admitted["role"], "listen")
    assert_eq(admitted["user"], room["reader"]._key)
    joined = ScoreRoom.on_event(
      {"type": "connect", "query": {"ticket": ticket}},
      DateTime.utc.to_unix
    )
    assert_eq(joined["join"], "score:#{score._key}")
    assert_eq(joined["track"]["role"], "listen")
  end

  test("a guest with only the link of a private score gets nothing (404); of a score open by link, a lobby ticket") do
    room = follow_room()
    score = room["score"]
    assert_eq(res_status(get("/s/#{score.share_token}/room_ticket")), 404)
    score.make_visible("link")
    answered = get("/s/#{score.share_token}/room_ticket")
    assert_eq(res_status(answered), 200)
    ticket = res_json(answered)["ticket"]
    assert_eq(ScoreRoom.admit(ticket, DateTime.utc.to_unix)["user"], "")
    joined = ScoreRoom.on_event(
      {"type": "connect", "query": {"ticket": ticket}},
      DateTime.utc.to_unix
    )
    assert_eq(joined["join"], "score:#{score._key}:lobby", "saves only, away from the room's people")
    assert_eq(joined["track"]["user_id"], "guest")
  end

  test("a trashed score's read page gives no ticket, to its owner either") do
    room = follow_room()
    score = room["score"]
    score.move_to_trash
    follow_sign_in(room["owner"])
    assert_eq(res_status(get("/s/#{score.share_token}/room_ticket")), 404)
  end

  test("the read page offers the room to all its readers, and the @ list to the score's people only") do
    room = follow_room()
    score = room["score"]
    follow_sign_in(room["reader"])
    page = get("/s/#{score.share_token}")
    assert_eq(res_status(page), 200)
    assert_eq(assigns()["people_url"], "/app/scores/#{score._key}/people")
    assert_contains(res_body(page), "/s/#{score.share_token}/room_ticket")
    score.make_visible("link")
    follow_sign_in(room["stranger"])
    seen = get("/s/#{score.share_token}")
    assert_eq(res_status(seen), 200)
    assert_null(assigns()["people_url"])
    assert_not(res_body(seen).contains?("/people"), "no @ list for someone outside the score")
  end
end
