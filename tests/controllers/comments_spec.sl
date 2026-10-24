# Comments on a score over HTTP (#385): the owner and everyone it is
# shared with — to change it or only to read it — list, start, reply,
# resolve and reopen threads; each message is changed or deleted by its
# author only; strangers and guests are refused everything, and nothing
# they send is written.

const TALK_PASSWORD = "correct horse battery"

def talk_user(name = nil)
  user = User.new()
  user.email = "talk-#{uuid_v4}@example.com"
  user.name = name unless name.nil?
  user.set_password(TALK_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

def talk_sign_in(user)
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": TALK_PASSWORD}
  )
end

# A score of its owner's, shared with an editor and a reader: {"score",
# "owner", "editor", "reader", "stranger"}.
def talk_room
  owner = talk_user("Olga")
  editor = talk_user("Eddie")
  reader = talk_user("Rita")
  score = Score.start(owner, Score.blank_source("Discussed"))
  ScoreShare.invite(score, editor.email, "write")
  ScoreShare.invite(score, reader.email, "read")
  {
    "score": score,
    "owner": owner,
    "editor": editor,
    "reader": reader,
    "stranger": talk_user()
  }
end

def talk_path(score, rest = "")
  "/app/scores/#{score._key}/comments#{rest}"
end

def talk_start(score, body = "Louder here?")
  post(
    talk_path(score),
    {
      "lane": 0,
      "bars": [1, 2],
      "label": "Bars 2–3, Piano",
      "body": body
    }
  )
end

def talk_threads(score)
  ScoreThread.where({"score_id": score._key}).count
end

describe("AppCommentsController") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  describe("who may comment") do
    test("the owner, the editor and the reader each start a thread, list them and reply") do
      room = talk_room()
      score = room["score"]
      ["owner", "editor", "reader"].each do |role|
        talk_sign_in(room[role])
        started = talk_start(score, "From the #{role}")
        assert_eq(res_status(started), 201, role)
        thread = res_json(started)["thread"]
        assert_eq(thread["bars"], [1, 2])
        assert_eq(thread["label"], "Bars 2–3, Piano")
        assert_eq(thread["messages"][0]["author_id"], room[role]._key)
        replied = post(talk_path(score, "/#{thread["id"]}/replies"), {"body": "And a reply"})
        assert_eq(res_status(replied), 201, role)
        assert_eq(res_json(replied)["thread"]["messages"].length, 2)
      end
      assert_eq(talk_threads(score), 3)
      listed = get(talk_path(score))
      assert_eq(res_status(listed), 200)
      assert_eq(res_json(listed)["threads"].length, 3)
    end

    test("a stranger is refused everything, and nothing is written") do
      room = talk_room()
      score = room["score"]
      talk_sign_in(room["owner"])
      thread = res_json(talk_start(score))["thread"]
      message = thread["messages"][0]["id"]
      talk_sign_in(room["stranger"])
      assert_eq(res_status(get(talk_path(score))), 403)
      assert_eq(res_status(talk_start(score, "Spam")), 403)
      assert_eq(res_status(post(talk_path(score, "/#{thread["id"]}/replies"), {"body": "Spam"})), 403)
      assert_eq(res_status(post(talk_path(score, "/#{thread["id"]}/resolve"), {})), 403)
      assert_eq(res_status(put(talk_path(score, "/#{thread["id"]}/messages/#{message}"), {"body": "Spam"})), 403)
      assert_eq(res_status(request("DELETE", talk_path(score, "/#{thread["id"]}/messages/#{message}"), {}, {})), 403)
      assert_eq(talk_threads(score), 1)
      stored = ScoreThread.find(thread["id"])
      assert_not(stored.resolved)
      assert_eq(ScoreComment.where({"thread_id": thread["id"]}).count, 1)
      assert_eq(ScoreComment.find(message).body, "Louder here?")
    end

    test("a guest is refused (401 JSON), and nothing is written") do
      room = talk_room()
      score = room["score"]
      set_header("Accept", "application/json")
      assert_eq(res_status(get(talk_path(score))), 401)
      assert_eq(res_status(talk_start(score)), 401)
      clear_headers()
      assert_eq(talk_threads(score), 0)
    end

    test("someone whose share is removed is refused from then on") do
      room = talk_room()
      score = room["score"]
      talk_sign_in(room["reader"])
      assert_eq(res_status(talk_start(score)), 201)
      ScoreShare.leave(score, room["reader"])
      assert_eq(res_status(talk_start(score)), 403)
      assert_eq(talk_threads(score), 1)
    end

    test("a score in the trash, or no such score, is a 404") do
      room = talk_room()
      score = room["score"]
      talk_sign_in(room["owner"])
      assert_eq(res_status(get("/app/scores/no-such-score/comments")), 404)
      score.move_to_trash
      assert_eq(res_status(talk_start(score)), 404)
      assert_eq(talk_threads(score), 0)
    end
  end

  describe("threads") do
    test("refuses a thread with no bars or nothing said (422), and writes nothing") do
      room = talk_room()
      score = room["score"]
      talk_sign_in(room["editor"])
      no_place = post(
        talk_path(score),
        {
          "lane": 0,
          "bars": nil,
          "body": "Hi"
        }
      )
      assert_eq(res_status(no_place), 422)
      assert_contains(res_json(no_place)["error"], "Select some bars")
      silent = post(
        talk_path(score),
        {
          "lane": 0,
          "bars": [0, 0],
          "body": "  "
        }
      )
      assert_eq(res_status(silent), 422)
      assert_eq(talk_threads(score), 0)
    end

    test("resolved by anyone of the score, then closed to replies, and reopened") do
      room = talk_room()
      score = room["score"]
      talk_sign_in(room["owner"])
      thread = res_json(talk_start(score))["thread"]
      talk_sign_in(room["reader"])
      resolved = post(talk_path(score, "/#{thread["id"]}/resolve"), {})
      assert_eq(res_status(resolved), 200)
      assert(res_json(resolved)["thread"]["resolved"])
      assert_eq(res_json(resolved)["thread"]["resolved_by"], "Rita")
      assert(ScoreThread.find(thread["id"]).resolved)
      closed = post(talk_path(score, "/#{thread["id"]}/replies"), {"body": "Late"})
      assert_eq(res_status(closed), 422)
      assert_eq(ScoreComment.where({"thread_id": thread["id"]}).count, 1)
      reopened = post(talk_path(score, "/#{thread["id"]}/reopen"), {})
      assert_eq(res_status(reopened), 200)
      assert_not(ScoreThread.find(thread["id"]).resolved)
    end

    test("a thread of another score is not reached through this one (404)") do
      room = talk_room()
      other = Score.start(room["owner"], Score.blank_source("Other"))
      talk_sign_in(room["owner"])
      theirs = res_json(talk_start(other))["thread"]
      talk_sign_in(room["reader"])
      answer = post(talk_path(room["score"], "/#{theirs["id"]}/replies"), {"body": "Sneaky"})
      assert_eq(res_status(answer), 404)
      assert_eq(ScoreComment.where({"thread_id": theirs["id"]}).count, 1)
    end
  end

  describe("messages") do
    test("its author changes and deletes it; the others are refused (403), nothing changed") do
      room = talk_room()
      score = room["score"]
      talk_sign_in(room["editor"])
      thread = res_json(talk_start(score, "Mine"))["thread"]
      message = thread["messages"][0]["id"]
      path = talk_path(score, "/#{thread["id"]}/messages/#{message}")
      ["owner", "reader"].each do |role|
        talk_sign_in(room[role])
        assert_eq(res_status(put(path, {"body": "Not yours"})), 403, role)
        assert_eq(res_status(request("DELETE", path, {}, {})), 403, role)
      end
      assert_eq(ScoreComment.find(message).body, "Mine")
      talk_sign_in(room["editor"])
      assert_eq(res_status(put(path, {"body": ""})), 422)
      changed = put(path, {"body": "Mine, better"})
      assert_eq(res_status(changed), 200)
      assert_eq(res_json(changed)["thread"]["messages"][0]["body"], "Mine, better")
      assert_not_null(res_json(changed)["thread"]["messages"][0]["edited_at"])
      assert_eq(ScoreComment.find(message).body, "Mine, better")
      gone = request("DELETE", path, {}, {})
      assert_eq(res_status(gone), 200)
      assert_eq(res_json(gone)["gone"], thread["id"])
      assert_eq(talk_threads(score), 0)
    end

    test("deleting a reply keeps the thread, with what is left") do
      room = talk_room()
      score = room["score"]
      talk_sign_in(room["owner"])
      thread = res_json(talk_start(score, "First"))["thread"]
      talk_sign_in(room["reader"])
      reply = res_json(post(talk_path(score, "/#{thread["id"]}/replies"), {"body": "Second"}))["thread"]["messages"][1]
      answer = request("DELETE", talk_path(score, "/#{thread["id"]}/messages/#{reply["id"]}"), {}, {})
      assert_eq(res_status(answer), 200)
      assert_eq(res_json(answer)["thread"]["messages"].length, 1)
      assert_eq(talk_threads(score), 1)
    end
  end

  describe("notifications") do
    test("a reply tells who wrote in the thread; a mention tells who it names; never the writer") do
      room = talk_room()
      score = room["score"]
      talk_sign_in(room["owner"])
      thread = res_json(talk_start(score, "What do you think, @eddie?"))["thread"]
      mention = UserNotification.where({
        "user_id": room["editor"]._key,
        "kind": "mention"
      }).all
      assert_eq(mention.length, 1)
      assert_eq(mention[0].thread_id, thread["id"])
      assert_eq(UserNotification.where({"user_id": room["owner"]._key}).count, 0)
      talk_sign_in(room["reader"])
      post(talk_path(score, "/#{thread["id"]}/replies"), {"body": "I like it"})
      assert_eq(UserNotification.where({
        "user_id": room["owner"]._key,
        "kind": "reply"
      }).count, 1)
      assert_eq(UserNotification.where({"user_id": room["reader"]._key}).count, 0)
      assert_eq(UserNotification.where({
        "user_id": room["editor"]._key,
        "kind": "reply"
      }).count, 0)
    end

    test("a save tells the others of the score, once an hour; sharing tells the invitee in the app") do
      room = talk_room()
      score = room["score"]
      talk_sign_in(room["editor"])
      saved = put(
        "/app/scores/#{score._key}",
        {"source": "\\header { title = \"Discussed\" }\n{ c'1 }", "revision": score.revision}
      )
      assert_eq(res_status(saved), 200)
      again = put(
        "/app/scores/#{score._key}",
        {"source": "\\header { title = \"Discussed\" }\n{ d'1 }", "revision": res_json(saved)["revision"]}
      )
      assert_eq(res_status(again), 200)
      assert_eq(UserNotification.where({
        "user_id": room["owner"]._key,
        "kind": "changed"
      }).count, 1)
      assert_eq(UserNotification.where({
        "user_id": room["reader"]._key,
        "kind": "changed"
      }).count, 1)
      assert_eq(UserNotification.where({
        "user_id": room["editor"]._key,
        "kind": "changed"
      }).count, 0)
      newcomer = talk_user()
      talk_sign_in(room["owner"])
      post(
        "/app/scores/#{score._key}/invitations",
        {"email": newcomer.email, "role": "read"}
      )
      told = UserNotification.where({
        "user_id": newcomer._key,
        "kind": "shared"
      }).all
      assert_eq(told.length, 1)
      assert_eq(told[0].mail, "none")
    end
  end
end
