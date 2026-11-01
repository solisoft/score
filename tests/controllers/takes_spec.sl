# The audio tracks of a score over HTTP (#390): its owner and the people it
# is shared with to change it record a take onto a track (a new one replaces
# the track's last) and delete one; those it is shared with to read list
# the takes and listen; strangers and guests are refused everything. A take
# too big, not a WAV, or with details out of range is refused, and nothing
# is written.

const TAKE_PASSWORD = "correct horse battery"
# A WAV as far as the app looks: "RIFF", a size, "WAVE", then the sound.
const TAKE_WAV = "RIFF....WAVEfmt data of a short take"

def take_user(name = nil)
  user = User.new()
  user.email = "take-#{uuid_v4}@example.com"
  user.name = name unless name.nil?
  user.set_password(TAKE_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

def take_sign_in(user)
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": TAKE_PASSWORD}
  )
end

# `user` on Pro, whose limits do not depend on payments being open.
def take_pro(user)
  user.plan = "pro"
  user.plan_status = "active"
  user.current_period_end = DateTime.utc.to_unix + 30 * 86400
  user.save
  User.find(user._key)
end

# A take of `owner`'s on `score`'s track 2 leaving `room_left` bytes of
# Pro's room for takes.
def take_fill(score, owner, room_left)
  ScoreTake.create({
    "score_id": score._key,
    "user_id": owner._key,
    "track": 2,
    "name": "Long",
    "size": Plan.pro_limits["take_bytes"] - room_left,
    "created_at": DateTime.utc.to_unix
  })
end

# A score of its owner's, shared with an editor and a reader.
def take_room
  owner = take_user("Olga")
  editor = take_user("Eddie")
  reader = take_user("Rita")
  score = Score.start(owner, Score.blank_source("Sung"))
  ScoreShare.invite(score, editor.email, "write")
  ScoreShare.invite(score, reader.email, "read")
  {
    "score": score,
    "owner": owner,
    "editor": editor,
    "reader": reader,
    "stranger": take_user()
  }
end

def take_path(score, rest = "")
  "/app/scores/#{score._key}/takes#{rest}"
end

# A multipart POST of `body` as the take's `audio`, declared `content_type`,
# with the details in `fields` over the usual ones.
def take_upload(score, body = TAKE_WAV, content_type = "audio/wav", fields = {})
  details = {
    "track": "1",
    "name": "Voice",
    "offset": "2.5",
    "rate": "1",
    "duration": "3.25"
  }.merge(fields)
  boundary = "----soli-take-spec"
  payload = ""
  details.keys.each do |key|
    payload = payload + "--#{boundary}\r\nContent-Disposition: form-data; name=\"#{key}\"\r\n\r\n#{details[key]}\r\n"
  end
  payload = payload + "--#{boundary}\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"take.wav\"\r\n"
  + "Content-Type: #{content_type}\r\n\r\n#{body}\r\n--#{boundary}--\r\n"
  set_header("Content-Type", "multipart/form-data; boundary=#{boundary}")
  answer = post(take_path(score), payload)
  clear_headers()
  answer
end

def take_count(score)
  ScoreTake.where({"score_id": score._key}).count
end

describe("AppTakesController") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  describe("recording a take") do
    test("the owner records one: kept with its details, and its sound played back") do
      room = take_room()
      score = room["score"]
      take_sign_in(room["owner"])
      answer = take_upload(score)
      assert_eq(res_status(answer), 201)
      shown = res_json(answer)["take"]
      assert_eq(shown["track"], 1)
      assert_eq(shown["name"], "Voice")
      assert_eq(shown["offset"], 2.5)
      assert_eq(shown["duration"], 3.25)
      stored = ScoreTake.find(shown["id"])
      assert_eq(stored.score_id, score._key)
      assert_eq(stored.user_id, room["owner"]._key)
      assert_not_null(stored.audio_blob_id)
      sound = get(take_path(score, "/#{shown["id"]}/audio"))
      assert_eq(res_status(sound), 200)
      assert_eq(res_header(sound, "Content-Type"), "audio/wav")
      assert_contains(res_body(sound), "WAVE")
    end

    test("the editor records onto a track: the track's last take is replaced, the others kept") do
      room = take_room()
      score = room["score"]
      take_sign_in(room["owner"])
      first = res_json(take_upload(score))["take"]
      second_track = res_json(take_upload(score, TAKE_WAV, "audio/wav", {
        "track": "2",
        "name": ""
      }))["take"]
      assert_eq(second_track["name"], "Audio 2")
      take_sign_in(room["editor"])
      again = take_upload(score, TAKE_WAV + " sung again", "audio/x-wav", {"name": "Second try"})
      assert_eq(res_status(again), 201)
      assert_eq(take_count(score), 2)
      assert_null(ScoreTake.find_by("_key", first["id"]))
      listed = res_json(get(take_path(score)))
      assert_eq(listed["takes"].map(&{ |take|
        take["name"]
      }), ["Second try", "Audio 2"])
      assert_eq(listed["tracks"], SCORE_TAKE_TRACKS)
      assert_eq(listed["max_bytes"], SCORE_TAKE_MAX_BYTES)
      assert(listed["writable"])
    end

    test("refuses a file that is not a WAV, whatever it is declared as, and writes nothing") do
      room = take_room()
      score = room["score"]
      take_sign_in(room["owner"])
      typed = take_upload(score, TAKE_WAV, "image/png")
      assert_eq(res_status(typed), 422)
      assert_contains(res_json(typed)["error"], "WAV")
      disguised = take_upload(score, "<script>alert(1)</script>", "audio/wav")
      assert_eq(res_status(disguised), 422)
      assert_eq(take_count(score), 0)
    end

    test("refuses a take over the size limit, and keeps the track's last one") do
      room = take_room()
      score = room["score"]
      take_sign_in(room["owner"])
      kept = res_json(take_upload(score))["take"]
      big = TAKE_WAV + "x" * (SCORE_TAKE_MAX_BYTES - TAKE_WAV.length + 1)
      answer = take_upload(score, big)
      assert_eq(res_status(answer), 422)
      assert_contains(res_json(answer)["error"], "8 MB")
      assert_eq(take_count(score), 1)
      assert_not_null(ScoreTake.find_by("_key", kept["id"]))
    end

    test("takes a file exactly at the size limit") do
      room = take_room()
      score = room["score"]
      take_sign_in(room["owner"])
      full = TAKE_WAV + "x" * (SCORE_TAKE_MAX_BYTES - TAKE_WAV.length)
      assert_eq(res_status(take_upload(score, full)), 201)
      assert_eq(ScoreTake.where({"score_id": score._key}).first.size, SCORE_TAKE_MAX_BYTES)
    end

    test("refuses a take past the room an account keeps, and stores nothing (#543)") do
      room = take_room()
      score = room["score"]
      owner = take_pro(room["owner"])
      take_fill(score, owner, TAKE_WAV.length - 1)
      take_sign_in(owner)
      answer = take_upload(score)
      assert_eq(res_status(answer), 422)
      assert_eq(res_json(answer)["error"], "Your takes would pass the 2 GB your plan keeps: delete some first.")
      assert_eq(take_count(score), 1)
      assert_eq(ScoreTake.where({
        "score_id": score._key,
        "track": 1
      }).count, 0)

      room_left = Plan.pro_limits["take_bytes"] - TAKE_WAV.length
      ScoreTake.where({"score_id": score._key, "track": 2}).first.update({"size": room_left})
      assert_eq(res_status(take_upload(score)), 201, "at the limit")
      assert_eq(ScoreTake.where({
        "score_id": score._key,
        "track": 1
      }).count, 1)
    end

    test("says the room is full in French with the cookie (#543)") do
      room = take_room()
      score = room["score"]
      owner = take_pro(room["owner"])
      take_fill(score, owner, TAKE_WAV.length - 1)
      take_sign_in(owner)
      set_request_cookie("locale", "fr")
      answer = take_upload(score)
      assert_eq(res_status(answer), 422)
      assert_eq(
        res_json(answer)["error"],
        "Vos prises dépasseraient les 2 GB que garde votre offre : supprimez-en d'abord."
      )
      assert_eq(take_count(score), 1)
    end

    test("refuses details out of range, or no sound, and writes nothing") do
      room = take_room()
      score = room["score"]
      take_sign_in(room["owner"])
      [
        [{"track": "0"}, "track"],
        [{"track": "5"}, "track"],
        [{"offset": "-100"}, "start"],
        [{"rate": "9"}, "speed"],
        [{"duration": "0"}, "empty"]
      ].each do |pair|
        answer = take_upload(score, TAKE_WAV, "audio/wav", pair[0])
        assert_eq(res_status(answer), 422, pair[1])
        assert_contains(res_json(answer)["error"], pair[1])
      end
      bare = post(
        take_path(score),
        {
          "track": "1",
          "offset": "0",
          "rate": "1",
          "duration": "2"
        }
      )
      assert_eq(res_status(bare), 422)
      assert_contains(res_json(bare)["error"], "WAV")
      assert_eq(take_count(score), 0)
    end
  end

  describe("who may do what") do
    test("the reader lists and listens, but may neither record nor delete") do
      room = take_room()
      score = room["score"]
      take_sign_in(room["owner"])
      take = res_json(take_upload(score))["take"]
      take_sign_in(room["reader"])
      listed = get(take_path(score))
      assert_eq(res_status(listed), 200)
      assert_eq(res_json(listed)["takes"].length, 1)
      assert_not(res_json(listed)["writable"])
      assert_eq(res_status(get(take_path(score, "/#{take["id"]}/audio"))), 200)
      assert_eq(res_status(take_upload(score, TAKE_WAV, "audio/wav", {"track": "2"})), 403)
      assert_eq(res_status(request("DELETE", take_path(score, "/#{take["id"]}"), {}, {})), 403)
      assert_eq(take_count(score), 1)
    end

    test("a stranger is refused everything, and nothing changes") do
      room = take_room()
      score = room["score"]
      take_sign_in(room["owner"])
      take = res_json(take_upload(score))["take"]
      take_sign_in(room["stranger"])
      assert_eq(res_status(get(take_path(score))), 403)
      assert_eq(res_status(get(take_path(score, "/#{take["id"]}/audio"))), 403)
      assert_eq(res_status(take_upload(score)), 403)
      assert_eq(res_status(request("DELETE", take_path(score, "/#{take["id"]}"), {}, {})), 403)
      assert_eq(take_count(score), 1)
      assert_eq(ScoreTake.find(take["id"]).name, "Voice")
    end

    test("a guest is refused (401 JSON), and nothing is written") do
      room = take_room()
      score = room["score"]
      set_header("Accept", "application/json")
      assert_eq(res_status(get(take_path(score))), 401)
      clear_headers()
      set_header("Accept", "application/json")
      assert_eq(res_status(post(take_path(score), {"track": "1"})), 401)
      clear_headers()
      assert_eq(take_count(score), 0)
    end

    test("someone whose share is removed is refused from then on") do
      room = take_room()
      score = room["score"]
      take_sign_in(room["editor"])
      assert_eq(res_status(take_upload(score)), 201)
      ScoreShare.leave(score, room["editor"])
      assert_eq(res_status(take_upload(score, TAKE_WAV, "audio/wav", {"track": "2"})), 403)
      assert_eq(take_count(score), 1)
    end
  end

  describe("the read page") do
    test("lets the reader listen to each take; a visitor by the link gets no audio") do
      room = take_room()
      score = room["score"]
      take_sign_in(room["owner"])
      take = res_json(take_upload(score))["take"]
      score.make_visible("link")
      take_sign_in(room["reader"])
      page = res_body(get("/s/#{score.share_token}"))
      assert_contains(page, "Recorded audio")
      assert_contains(page, "src=\"/app/scores/#{score._key}/takes/#{take["id"]}/audio\"")
      clear_cookies()
      as_guest()
      visitor = get("/s/#{score.share_token}")
      assert_eq(res_status(visitor), 200)
      assert_not(res_body(visitor).contains("Recorded audio"))
    end
  end

  describe("the owner's data export") do
    test("holds each take's WAV in its score's folder, and lists it; an editor's export does not") do
      room = take_room()
      score = room["score"]
      take_sign_in(room["editor"])
      take_upload(score, TAKE_WAV + " by the editor")
      take_sign_in(room["owner"])
      body = res_body(post("/app/account/export", {}))
      assert_contains(body, "scores/sung-#{score._key}/takes/track-1.wav")
      assert_contains(body, "WAVEfmt data of a short take by the editor")
      assert_contains(body, "\"starts_at_second\":2.5")
      take_sign_in(room["editor"])
      theirs = res_body(post("/app/account/export", {}))
      assert_not(theirs.contains("takes/track-1.wav"))
    end
  end

  describe("deleting a take") do
    test("the editor deletes one: gone, its sound with it") do
      room = take_room()
      score = room["score"]
      take_sign_in(room["owner"])
      take = res_json(take_upload(score))["take"]
      take_sign_in(room["editor"])
      answer = request("DELETE", take_path(score, "/#{take["id"]}"), {}, {})
      assert_eq(res_status(answer), 200)
      assert_eq(res_json(answer)["gone"], take["id"])
      assert_eq(take_count(score), 0)
      assert_eq(res_status(get(take_path(score, "/#{take["id"]}/audio"))), 404)
    end

    test("an unknown take, or another score's, is 404 and nothing is deleted") do
      room = take_room()
      score = room["score"]
      take_sign_in(room["owner"])
      take = res_json(take_upload(score))["take"]
      other = Score.start(room["owner"], Score.blank_source("Other"))
      assert_eq(res_status(request("DELETE", take_path(other, "/#{take["id"]}"), {}, {})), 404)
      assert_eq(res_status(get(take_path(other, "/#{take["id"]}/audio"))), 404)
      assert_eq(res_status(request("DELETE", take_path(score, "/no-such-take"), {}, {})), 404)
      assert_eq(take_count(score), 1)
    end

    test("a score in the trash answers 404; erased, its takes go with it") do
      room = take_room()
      score = room["score"]
      take_sign_in(room["owner"])
      take_upload(score)
      score.move_to_trash
      assert_eq(res_status(get(take_path(score))), 404)
      Score.find(score._key).erase
      assert_eq(take_count(score), 0)
    end
  end
end
