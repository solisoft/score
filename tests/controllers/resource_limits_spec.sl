# What one signed-in account may fill and ask for (#684): a refused save
# is kept as a version only within the bounds a save has, and so many an
# hour; every write that has the engraver read a score — a save, a new
# score, a copy, a restore, a section or a photo kept as a score — counts
# against the account's engravings of the minute, in the database; a
# version's page, the gallery's PDFs too; an account keeps so many scores;
# a photo is refused for the day's or the minute's count, or its size,
# before it is opened.

const RESOURCE_PASSWORD = "correct horse battery"
const RESOURCE_SOURCE = "\\header { title = \"Small tune\" }\n{ c'4 d' e' f' }\n"
# A PNG of 40 by 20 pixels.
const RESOURCE_PNG = "iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAAAAADaLSBnAAAAFUlEQVR42mP4TyRgGFU4qnBUIQgAAIy4"
+ "HQ6Y693OAAAAAElFTkSuQmCC"

def resource_user
  user = User.new()
  user.email = "resource-#{uuid_v4}@example.com"
  user.name = "Resource"
  user.set_password(RESOURCE_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

def resource_sign_in(user)
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": RESOURCE_PASSWORD}
  )
end

# A source no one engraved before.
def resource_fresh(label = "")
  RESOURCE_SOURCE + "% #{label} #{uuid_v4}\n"
end

# `user`'s engravings of `kind` this minute spent, as so many made.
def resource_spend(user, kind)
  (0 .. ENGRAVINGS_PER_MINUTE[kind]).each do |_|
    RateCount.take("engrave-#{kind}:user:#{user._key}", 1000000, 60)
  end
end

def resource_versions(score)
  ScoreVersion.where({"score_id": score._key}).count
end

def resource_scores(user)
  Score.where({"user_id": user._key}).count
end

# `count` scores of `user`'s written straight to the database, in one query.
def resource_fill(user, count)
  owner = user._key
  @sdbql{
    FOR i IN 1..#{count}
    INSERT { user_id: #{owner}, title: "Filler", source: "{ c'4 }", composer: "", created_at: 0, updated_at: 0 }
    INTO scores
  }
end

# The PNG header of a picture `width` by `height`, and nothing of its pixels.
def resource_png_header(width, height)
  size = [
    width / 16777216 % 256,
    width / 65536 % 256,
    width / 256 % 256,
    width % 256,
    height / 16777216 % 256,
    height / 65536 % 256,
    height / 256 % 256,
    height % 256
  ]
  bytes = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82] + size
  + [8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  Base64.encode(bytes)
end

def resource_ai_user
  user = resource_user()
  user.keep_ai_key("mistral", "pixtral-large-latest", "sk-mistral-3333")
  resource_sign_in(user)
  User.find(user._key)
end

def resource_send_picture(picture)
  set_header("Content-Type", "application/json")
  response = post("/app/readings", JSON.stringify({"picture": picture}))
  clear_headers()
  response
end

def resource_readings(user)
  ScoreReading.where({"user_id": user._key}).count
end

describe("What an account may fill and ask for (#684)") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  describe("a refused save kept as a version") do
    test("past the bounds of a save, is refused before the conflict, and nothing is kept") do
      owner = resource_user()
      score = Score.start(owner, RESOURCE_SOURCE)
      resource_sign_in(owner)
      before = resource_versions(score)
      long = "{ " + "c'4 " * 250001 + "}"
      refused = put(
        "/app/scores/#{score._key}",
        {"source": long, "revision": score.revision - 1}
      )
      assert_eq(res_status(refused), 422)
      assert_contains(res_json(refused)["error"], "a million characters at most")
      assert_eq(resource_versions(score), before, "nothing kept")
      assert_eq(Score.find(score._key).source, RESOURCE_SOURCE)
      within = put(
        "/app/scores/#{score._key}",
        {"source": resource_fresh(), "revision": score.revision - 1}
      )
      assert_eq(res_status(within), 409, "a text within them is still kept")
      assert_eq(resource_versions(score), before + 1)
    end

    test("so many an hour: past them a refused save answers 409, and is not kept") do
      owner = resource_user()
      score = Score.start(owner, RESOURCE_SOURCE)
      (0 .. SCORE_CONFLICTS_PER_HOUR - 1).each do |n|
        ScoreVersion.keep(score, resource_fresh("conflict #{n}"), "conflict", owner._key)
      end
      # One of an hour ago does not count.
      old = ScoreVersion.keep(score, resource_fresh("old"), "conflict", owner._key)
      ScoreVersion.where("doc._key == @key", {"key": old._key}).update_all({"created_at": DateTime.utc.to_unix - 3700})
      resource_sign_in(owner)
      last = put(
        "/app/scores/#{score._key}",
        {"source": resource_fresh(), "revision": score.revision - 1}
      )
      assert_eq(res_status(last), 409)
      assert_eq(resource_versions(score), SCORE_CONFLICTS_PER_HOUR + 1, "the 20th of the hour kept")
      past = put(
        "/app/scores/#{score._key}",
        {"source": resource_fresh(), "revision": score.revision - 1}
      )
      assert_eq(res_status(past), 409, "answered as before")
      assert_eq(res_json(past)["source"], RESOURCE_SOURCE, "with the score as it stands")
      assert_eq(resource_versions(score), SCORE_CONFLICTS_PER_HOUR + 1, "the 21st not kept")
      manual = ScoreVersion.keep(score, score.source, "manual", owner._key)
      assert_not_null(manual._key, "the other versions are not held")
    end

    test("a version is no longer than a score may be") do
      owner = resource_user()
      score = Score.start(owner, RESOURCE_SOURCE)
      before = resource_versions(score)
      version = ScoreVersion.keep(score, "%" * 1000001, "conflict", owner._key)
      assert_not_null(version._errors)
      assert_eq(version._errors[0]["field"], "source")
      assert_eq(resource_versions(score), before)
    end
  end

  describe("the engraver's reading of a score written, counted") do
    test("the editor's saves count: past the minute's, 429 with when to come back, and nothing written") do
      owner = resource_user()
      score = Score.start(owner, RESOURCE_SOURCE)
      resource_sign_in(owner)
      (0 .. ENGRAVINGS_PER_MINUTE["save"] - 1).each do |_|
        RateCount.take("engrave-save:user:#{owner._key}", 1000000, 60)
      end
      saved_source = resource_fresh("last")
      last = put(
        "/app/scores/#{score._key}",
        {"source": saved_source, "revision": score.revision}
      )
      assert_eq(res_status(last), 200, "the 60th of the minute")
      revision = res_json(last)["revision"]
      held = put(
        "/app/scores/#{score._key}",
        {"source": resource_fresh("held"), "revision": revision}
      )
      assert_eq(res_status(held), 429)
      assert_eq(res_json(held)["error"], SiteText.t("security_540.too_many_engravings"))
      assert_eq(res_json(held)["retry_after"], ENGRAVING_RETRY_AFTER)
      assert_eq(res_json(held)["revision"], revision)
      stored = Score.find(score._key)
      assert_eq(stored.revision, revision, "nothing written")
      assert_eq(stored.source, saved_source)
      again = put(
        "/app/scores/#{score._key}",
        {"source": saved_source, "revision": revision}
      )
      assert_eq(res_status(again), 200, "a source read before is read back, not counted")
      other = resource_user()
      other_score = Score.start(other, RESOURCE_SOURCE)
      resource_sign_in(other)
      apart = put(
        "/app/scores/#{other_score._key}",
        {"source": resource_fresh(), "revision": other_score.revision}
      )
      assert_eq(res_status(apart), 200, "another account is counted apart")
    end

    test("the editor's saves are counted in the database, by every worker") do
      owner = resource_user()
      score = Score.start(owner, RESOURCE_SOURCE)
      resource_sign_in(owner)
      saved = put(
        "/app/scores/#{score._key}",
        {"source": resource_fresh(), "revision": score.revision}
      )
      assert_eq(res_status(saved), 200)
      counted = RateCount.find_by("_key", Crypto.sha256("engrave-save:user:#{owner._key}"))
      assert_not_null(counted, "a row of the account's saves")
      assert_eq(counted.count, 1)
    end

    test("a new score: 429 past the minute's, and none created") do
      owner = resource_user()
      resource_sign_in(owner)
      resource_spend(owner, "save")
      held = post("/app/scores", {"source": resource_fresh()})
      assert_eq(res_status(held), 429)
      assert_eq(res_header(held, "Retry-After"), "60")
      assert_contains(res_body(held), "Too many engravings")
      assert_eq(resource_scores(owner), 0)
    end

    test("a copy, a version copied, a version restored: 429 past the minute's, and nothing written") do
      owner = resource_user()
      score = Score.start(owner, resource_fresh("copied"))
      version = ScoreVersion.keep(score, resource_fresh("version"), "manual", owner._key)
      resource_sign_in(owner)
      resource_spend(owner, "save")
      versions = resource_versions(score)
      assert_eq(res_status(post("/app/scores/#{score._key}/duplicate", {})), 429)
      assert_eq(res_status(post("/app/scores/#{score._key}/versions/#{version._key}/copy", {})), 429)
      assert_eq(res_status(post("/app/scores/#{score._key}/versions/#{version._key}/restore", {})), 429)
      assert_eq(resource_scores(owner), 1, "no copy")
      assert_eq(resource_versions(score), versions, "nothing kept before a restore")
      assert_eq(Score.find(score._key).source, score.source, "not restored")
    end

    test("a section added as a new score, a photo's reading kept: 429 past the minute's, none created") do
      owner = resource_user()
      section = SharedSection.create({
        "user_id": owner._key,
        "title": "Little waltz",
        "description": "",
        "instrument": "guitar",
        "style": "waltz",
        "time": "3/4",
        "key": "G major",
        "bpm": 96,
        "bars": 1,
        "tracks": 1,
        "section": {"bars": 1, "parts": []},
        "source": resource_fresh("section"),
        "rating_count": 0,
        "rating_total": 0,
        "hidden": false,
        "created_at": DateTime.utc.to_unix
      })
      reading = ScoreReading.create({
        "user_id": owner._key,
        "state": "done",
        "source": resource_fresh("reading"),
        "created_at": DateTime.utc.to_unix
      })
      resource_sign_in(owner)
      resource_spend(owner, "save")
      assert_eq(res_status(post("/app/sections/#{section._key}/import", {"score_id": "new"})), 429)
      assert_eq(res_status(post("/app/imports/#{reading._key}/score", {})), 429)
      assert_eq(resource_scores(owner), 0)
    end

    test("within the minute's, each is written as before") do
      owner = resource_user()
      score = Score.start(owner, resource_fresh("within"))
      version = ScoreVersion.keep(score, resource_fresh("version"), "manual", owner._key)
      resource_sign_in(owner)
      assert_eq(res_status(post("/app/scores", {"source": resource_fresh()})), 302)
      assert_eq(res_status(post("/app/scores/#{score._key}/duplicate", {})), 302)
      assert_eq(res_status(post("/app/scores/#{score._key}/versions/#{version._key}/copy", {})), 302)
      assert_eq(res_status(post("/app/scores/#{score._key}/versions/#{version._key}/restore", {})), 302)
      assert_eq(resource_scores(owner), 4)
      assert_eq(Score.find(score._key).source, version.source)
    end

    test("a version's page is engraved for its reader, counted: 429 past the minute's") do
      owner = resource_user()
      score = Score.start(owner, RESOURCE_SOURCE)
      version = ScoreVersion.keep(score, resource_fresh("page"), "manual", owner._key)
      resource_sign_in(owner)
      path = "/app/scores/#{score._key}/versions/#{version._key}"
      assert_eq(res_status(get(path)), 200)
      held_version = ScoreVersion.keep(score, resource_fresh("held page"), "manual", owner._key)
      resource_spend(owner, "page")
      assert_eq(res_status(get(path)), 200, "read back, not counted")
      held = get("/app/scores/#{score._key}/versions/#{held_version._key}")
      assert_eq(res_status(held), 429)
      assert_eq(res_header(held, "Retry-After"), "60")
    end
  end

  describe("the scores an account keeps") do
    test("past its plan's, a new score is refused with why, and none is created; the trash counts") do
      owner = resource_user()
      most = Plan.limits(owner)["scores"]
      assert_eq(most, 10000, "Pro's, while Pro is not on sale")
      resource_fill(owner, most - 1)
      Score.start(owner, Score.blank_source("Trashed")).move_to_trash
      assert_eq(resource_scores(owner), most)
      resource_sign_in(owner)
      refused = post("/app/scores", {"source": resource_fresh()})
      assert_eq(res_status(refused), 422)
      assert_eq(res_body(refused), SiteText.t("security_684.too_many_scores", {"n": most}))
      assert_contains(res_body(refused), "10000 scores at most")
      assert_eq(resource_scores(owner), most, "none created")
      token = AccessToken.issue(owner, "Spec client")["token"]
      set_header("Content-Type", "application/json")
      set_header("Authorization", "Bearer " + token)
      created = res_json(post("/mcp", {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": "create_score", "arguments": {"source": resource_fresh()}}
      }.to_json))["result"]
      clear_headers()
      assert(created["isError"])
      assert_contains(created["content"][0]["text"], "10000 scores at most")
      assert_eq(resource_scores(owner), most)
      Score.where({"user_id": owner._key, "title": "Filler"}).limit(1).all[0].erase
      assert_eq(res_status(post("/app/scores", {"source": resource_fresh()})), 302, "room again once one goes")
      assert_eq(resource_scores(owner), most)
    end

    test("the Free plan keeps 1,000, Pro 10,000") do
      assert_eq(Plan.free_limits["scores"], 1000)
      assert_eq(Plan.pro_limits["scores"], 10000)
      assert_eq(Plan.today_limits["scores"], 10000)
    end
  end

  describe("the gallery's PDF") do
    test("is printed once, kept, cached by browsers; made past the sender's minute, 429") do
      example = ScoreLibrary.examples[0]
      path = "/examples/#{example["category"]}/#{example["slug"]}/score.pdf"
      source = ScoreLibrary.source(example)
      digest = ScoreSvg.file_digest("pdf", example["title"], source)
      Engraving.where("doc._key == @key", {"key": digest}).delete_all
      reader = resource_user()
      resource_sign_in(reader)
      first = get(path)
      assert_eq(res_status(first), 200)
      assert(res_body(first).starts_with?("%PDF"))
      assert_eq(res_header(first, "Cache-Control"), "public, max-age=3600")
      assert_eq(Engraving.find(digest).file, res_body(first), "kept")
      resource_spend(reader, "pdf")
      assert_eq(res_status(get(path)), 200, "read back, not counted")
      Engraving.where("doc._key == @key", {"key": digest}).delete_all
      held = get(path)
      assert_eq(res_status(held), 429)
      assert_eq(res_header(held, "Retry-After"), "60")
      assert_null(Engraving.find_by("_key", digest), "nothing printed")
      assert_eq(res_status(get("/examples/#{example["category"]}/no-such-piece/score.pdf")), 404)
    end
  end

  describe("a photo sent to be read") do
    test("the day's count is read before the picture is opened") do
      user = resource_ai_user()
      rows = (0 .. SCORE_READINGS_OWN_PER_DAY).map do |_|
        {
          "user_id": user._key,
          "state": "done",
          "created_at": DateTime.utc.to_unix
        }
      end
      ScoreReading.create_many(rows)
      refused = resource_send_picture(Base64.encode("not a picture at all"))
      assert_eq(res_status(refused), 429, "used up, not 'not a picture'")
      assert_eq(res_json(refused)["error"], SiteText.t("app.readings.used_up"))
      assert_eq(resource_readings(user), SCORE_READINGS_OWN_PER_DAY)
    end

    test("so many a minute, a refused one too: past them, 429 and nothing started") do
      user = resource_ai_user()
      (0 .. SCORE_READINGS_PER_MINUTE).each do |n|
        assert_eq(res_status(resource_send_picture(RESOURCE_PNG)), 202, "photo #{n + 1}")
      end
      assert_eq(resource_readings(user), SCORE_READINGS_PER_MINUTE)
      held = resource_send_picture(RESOURCE_PNG)
      assert_eq(res_status(held), 429)
      assert_eq(res_json(held)["error"], SiteText.t("security_684.too_many_photos"))
      assert_eq(resource_readings(user), SCORE_READINGS_PER_MINUTE, "nothing started")
      other = resource_ai_user()
      assert_eq(res_status(resource_send_picture(RESOURCE_PNG)), 202, "another account is counted apart")
      assert_eq(resource_readings(other), 1)
    end

    test("past SCORE_READER_PIXELS by its header, is refused without being opened") do
      user = resource_ai_user()
      # 7 KB of PNG that open to 56 million pixels (tests/fixtures/bombs).
      bomb = File.read("tests/fixtures/bombs/pixels.png.b64").trim
      assert_eq(ScoreReader.dimensions(bomb), [8000, 7000])
      assert_null(ScoreReader.picture(bomb), "never opened")
      assert_eq(ScoreReader.dimensions(resource_png_header(20000, 20000)), [20000, 20000])
      refused = resource_send_picture(bomb)
      assert_eq(res_status(refused), 422)
      assert_contains(res_json(refused)["error"], "not a picture")
      assert_eq(resource_readings(user), 0)
    end

    test("an MCP client: the day's, then the minute's, before the picture is opened") do
      user = resource_ai_user()
      rows = (0 .. SCORE_READINGS_OWN_PER_DAY).map do |_|
        {
          "user_id": user._key,
          "state": "done",
          "created_at": DateTime.utc.to_unix
        }
      end
      ScoreReading.create_many(rows)
      used = ScoreMcp.transcribe_image(user, {"image_base64": "bm90IGEgcGljdHVyZQ=="})
      assert(used["isError"])
      assert_contains(used["content"][0]["text"], "today's photos")
      other = resource_ai_user()
      (0 .. SCORE_READINGS_PER_MINUTE).each do |_|
        RateCount.take("reading-photo:#{other._key}", 1000000, 60)
      end
      held = ScoreMcp.transcribe_image(other, {"image_base64": RESOURCE_PNG})
      assert(held["isError"])
      assert_contains(held["content"][0]["text"], "6 photos a minute at most")
      assert_eq(resource_readings(other), 0)
      fresh = resource_ai_user()
      big = ScoreMcp.transcribe_image(fresh, {"image_base64": resource_png_header(10000, 10000)})
      assert(big["isError"])
      assert_contains(big["content"][0]["text"], "50 megapixels at most")
      read = ScoreMcp.transcribe_image(fresh, {"image_base64": RESOURCE_PNG})
      assert_not(read["isError"])
      assert_eq(resource_readings(fresh), 1)
    end
  end
end

# `bytes` in little-endian order, `count` of them, for a WebP header.
def resource_le(value, count)
  (0 .. count).map do |i|
    value / [1, 256, 65536][i] % 256
  end
end

# A WebP header whose first chunk is `chunk` ("VP8 ", "VP8X"), saying
# `width` by `height` as that chunk does; nothing of its pixels.
def resource_webp_header(chunk, width, height)
  name = chunk.bytes()
  head = [82, 73, 70, 70, 100, 0, 0, 0, 87, 69, 66, 80] + name + [
    30,
    0,
    0,
    0
  ]
  if chunk == "VP8X"
    return Base64.encode(head + [
      0,
      0,
      0,
      0
    ] + resource_le(width - 1, 3) + resource_le(height - 1, 3)
    + [0, 0])
  end

  Base64.encode(head + [
    0,
    0,
    0,
    157,
    1,
    42
  ] + resource_le(width, 2) + resource_le(height, 2) + [0, 0])
end

# A JPEG with `count` APP1 segments of 65,000 bytes before its frame, as a
# camera's EXIF data puts them.
def resource_padded_jpeg(jpeg, count)
  bytes = Base64.decode(jpeg)
  padding = []
  (0 .. count).each do |_|
    padding = padding + [
      255,
      225,
      253,
      234
    ] + resource_zeros(65000)
  end
  Base64.encode(bytes.slice(0, 2) + padding + bytes.slice(2, bytes.length))
end

describe("ScoreReader.dimensions (#684)") do
  test("reads a PNG's, a JPEG's and a WebP's size from its header") do
    assert_eq(ScoreReader.dimensions(RESOURCE_PNG), [40, 20])
    image = Image.from_buffer(RESOURCE_PNG)
    jpeg = image.format("jpeg").to_buffer
    assert_eq(ScoreReader.dimensions(jpeg), [40, 20])
    assert_eq(ScoreReader.dimensions(image.resize(3000, 1500).format("jpeg").to_buffer), [3000, 1500])
    assert_eq(ScoreReader.dimensions(image.format("webp").to_buffer), [40, 20], "lossless")
    assert_eq(ScoreReader.dimensions(resource_webp_header("VP8 ", 1200, 900)), [1200, 900], "lossy")
    assert_eq(ScoreReader.dimensions(resource_webp_header("VP8X", 70000, 300)), [70000, 300], "extended")
  end

  test("walks a JPEG's segments to its frame, however far") do
    padded = resource_padded_jpeg(Image.from_buffer(RESOURCE_PNG).format("jpeg").to_buffer, 3)
    assert_gt(padded.length, 260000)
    assert_eq(ScoreReader.dimensions(padded), [40, 20])
    assert_not_null(ScoreReader.picture(padded), "and the picture is read")
  end

  test("answers nil for what it does not read, and the picture is refused") do
    gif = Base64.encode([
      71,
      73,
      70,
      56,
      57,
      97,
      40,
      0,
      20,
      0
    ] + resource_zeros(30))
    [
      Base64.encode("plain text, long enough to have thirty bytes"),
      "",
      "!!not base64 at all, but long enough to be read!!",
      gif,
      Base64.encode([255, 216] + resource_zeros(40)),
      Base64.encode([255, 216, 255, 218] + resource_zeros(40))
    ].each do |data|
      assert_null(ScoreReader.dimensions(data), data)
      assert_null(ScoreReader.picture(data), data)
    end
    assert_null(ScoreReader.picture(resource_png_header(7072, 7072)), "past 50 megapixels")
    assert_null(ScoreReader.picture(resource_png_header(7000, 7000)), "within them, but no pixels")
  end
end

describe("RateCount (#684)") do
  test("counts a name's asks in its window, and starts the next after it") do
    name = "spec-#{uuid_v4}"
    assert_eq(RateCount.count_one(name, 60, 1000), 1)
    assert_eq(RateCount.count_one(name, 60, 1030), 2)
    assert_eq(RateCount.count_one(name, 60, 1059), 3)
    assert_eq(RateCount.count_one(name, 60, 1060), 1, "a window of 60 seconds from the first")
    assert_eq(RateCount.count_one("other-#{uuid_v4}", 60, 1060), 1, "another name apart")
  end

  test("takes so many, then refuses, each ask counted") do
    name = "spec-#{uuid_v4}"
    assert(RateCount.take(name, 2, 60))
    assert(RateCount.take(name, 2, 60))
    assert_not(RateCount.take(name, 2, 60))
    assert_not(RateCount.take(name, 2, 60))
    assert_eq(RateCount.find(Crypto.sha256(name)).count, 4)
  end

  test("the nightly cleanup lets the ended windows go, and keeps the others") do
    ended = "spec-ended-#{uuid_v4}"
    going = "spec-going-#{uuid_v4}"
    RateCount.count_one(ended, 60, DateTime.utc.to_unix - 120)
    RateCount.take(going, 5, 60)
    done = DataCleanupJob.perform_now({})
    assert_gt(done["rate_counts"], 0)
    assert_null(RateCount.find_by("_key", Crypto.sha256(ended)))
    assert_not_null(RateCount.find_by("_key", Crypto.sha256(going)))
  end
end

def resource_zeros(count)
  (0 .. count).map do |_|
    0
  end
end
