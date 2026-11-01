# AccountExport: what "Export all my data" puts in the zip, and only that —
# the person's own scores and versions, their shares, their account without
# a secret; the scores shared with them listed, not copied.

def export_user(label)
  user = User.new()
  user.email = "#{label}-#{uuid_v4}@example.com"
  user.set_password("correct horse battery")
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

# The export's files of part `number`, by name.
def export_files(user, number = 1)
  by_name = {}
  AccountExport.files(user, AccountExport.parts(user), number, 1792700073).each do |file|
    by_name[file["name"]] = file["text"]
  end
  by_name
end

def export_names(files)
  files.keys.sort()
end

# The characters of a part's entries, each sized in `size_of`.
def export_part_size(part, size_of)
  part.map do |key|
    size_of[key]
  end.sum
end

# Every file under `folder` in all of `parts`, by name.
def export_folder_files(user, parts, folder)
  found = {}
  (1 .. parts.length + 1).each do |number|
    AccountExport.files(user, parts, number, 1792700073).each do |file|
      found[file["name"]] = file["text"] if file["name"].starts_with?("#{folder}/")
    end
  end
  found
end

# Every file of every part of `user`'s export (parts of `limit`), each
# with its part: [{"name", "text", "part"}], a name once a part holds it.
def export_every_file(user, limit)
  parts = AccountExport.parts(user, limit)
  found = []
  (1 .. parts.length + 1).each do |number|
    AccountExport.files(user, parts, number, 1792700073).each do |file|
      found.push({
        "name": file["name"],
        "text": file["text"],
        "part": number
      })
    end
  end
  found
end

# The version files under `folder` of `every` (export_every_file), by name.
def export_version_texts(every, folder)
  texts = {}
  every.each do |file|
    texts[file["name"]] = file["text"] if file["name"].starts_with?("#{folder}/versions/")
  end
  texts
end

# `count` versions of `score`, saved a second apart from `since`.
def export_versions(score, user, count, since)
  (0 .. count).map do |i|
    version = ScoreVersion.keep(score, "{ e'#{i + 1} " + "e'4 " * 20 + "}", "auto", user._key)
    version.created_at = since + i
    version.update()
    version
  end
end

# Those of `names` that name the version whose key is `key`.
def export_names_with(names, key)
  names.filter do |name|
    name.contains(key)
  end
end

# The versions part `number` of `every` lists for the score in `folder`.
def export_listed_versions(every, number, folder)
  listing = every.find do |file|
    file["part"] == number && file["name"] == "scores.json"
  end
  entry = JSON.parse(listing["text"]).find do |row|
    row["folder"] == folder
  end
  entry["versions"] ?? []
end

# The files of `listed` (a score's versions in scores.json) whose "part"
# is not the part of `held` (export_every_file) holding them.
def export_misplaced(listed, held, folder)
  listed.filter do |version|
    version["part"] != export_part_holding(held, "#{folder}/#{version["file"]}")
  end.map(&:file)
end

# The part of `held` (export_every_file) whose file is `name`.
def export_part_holding(held, name)
  holder = held.find do |file|
    file["name"] == name
  end
  holder&.part
end

describe("AccountExport") do
  describe("files") do
    test("each score in its folder with every version, the trash flagged, and the sharing") do
      owner = export_user("owner")
      friend = export_user("friend")
      chorale = Score.start(owner, Score.blank_source("Chorale"))
      earlier = ScoreVersion.keep(chorale, "\\header { title = \"Chorale\" }\n{ c'1 }", "manual", owner._key)
      earlier.created_at = earlier.created_at - 60
      earlier.update()
      ScoreVersion.keep(chorale, "\\header { title = \"Chorale\" }\n{ d'1 }", "auto", friend._key)
      ScoreShare.invite(chorale, friend.email, "write")
      ScoreShare.invite(chorale, "reader@example.com", "read")
      old = Score.start(owner, Score.blank_source("Old étude"))
      old.move_to_trash
      files = export_files(owner)
      folder = "scores/chorale-#{chorale._key}"
      trashed = "trash/old-étude-#{old._key}"
      assert_contains(export_names(files), "#{folder}/chorale.ly")
      assert_contains(export_names(files), "#{trashed}/old-étude.ly")
      assert_eq(files["#{folder}/chorale.ly"], Score.find(chorale._key).source)
      versions = export_names(files).filter do |name|
        name.starts_with?("#{folder}/versions/")
      end
      assert_eq(versions.length, 2)
      assert_eq(files[versions[0]], "\\header { title = \"Chorale\" }\n{ c'1 }", "the oldest first")
      assert_match(versions[0], "versions/\\d{4}-\\d\\d-\\d\\dT\\d\\d-\\d\\d-\\d\\d-#{earlier._key}-manual\\.ly$")
      assert_match(versions[1], "versions/\\d{4}-.*-auto\\.ly$")
      listed = JSON.parse(files["scores.json"])
      assert_eq(listed.length, 2)
      entry = listed.find do |row|
        row["title"] == "Chorale"
      end
      assert_eq(entry["folder"], folder)
      assert_eq(entry["in_trash"], false)
      assert_eq(entry["part"], 1)
      assert_eq(entry["shared_with"].map(&:email), ["reader@example.com", friend.email].sort())
      roles = {}
      entry["shared_with"].each do |share|
        roles[share["email"]] = share["role"]
      end
      assert_eq(
        roles,
        {"reader@example.com": "read", friend.email: "write"}
      )
      assert_eq(entry["versions"].map(&:saved_by), [owner.email, friend.email])
      gone = listed.find do |row|
        row["title"] == "Old étude"
      end
      assert_eq(gone["in_trash"], true)
      assert_not_null(gone["trashed_at"])
      assert_eq(gone["folder"], trashed)
    end

    test("the account without its password, two-step secret, tokens or AI key") do
      user = export_user("secret")
      user.start_two_step
      user.start_password_reset
      user.start_remember_me
      user.keep_ai_key("anthropic", "claude-test", "sk-ant-0123456789abcdef")
      files = export_files(User.find(user._key))
      account = files["account.json"]
      parsed = JSON.parse(account)
      assert_eq(parsed["email"], user.email)
      assert_eq(parsed["own_ai"]["provider"], "anthropic")
      assert_eq(parsed["two_step_sign_in"], false)
      stored = User.find(user._key)
      [
        stored.password_digest,
        stored.totp_pending,
        stored.reset_token_digest,
        stored.remember_token_digest,
        stored.ai_key,
        "0123456789abcdef",
        stored.ai_key_hint
      ].each do |secret|
        assert_not(account.contains(secret.to_s), "account.json leaks #{secret}")
      end
      files.keys.each do |name|
        assert_not(files[name].contains(stored.password_digest), "#{name} leaks the password digest")
      end
    end

    test("a score shared with the person is listed with their role, not copied") do
      owner = export_user("lender")
      reader = export_user("borrower")
      theirs = Score.start(owner, Score.blank_source("Lent sonata"))
      ScoreShare.invite(theirs, reader.email, "read")
      files = export_files(reader)
      shared = JSON.parse(files["shared-with-me.json"])
      assert_eq(shared.length, 1)
      assert_eq(shared[0]["title"], "Lent sonata")
      assert_eq(shared[0]["role"], "read")
      assert_eq(shared[0]["owner"], owner.email)
      assert_contains(shared[0]["address"], "/app/scores/#{theirs._key}")
      assert_eq(JSON.parse(files["scores.json"]), [])
      files.keys.each do |name|
        assert_not(files[name].contains(theirs.source), "#{name} copies the lent score")
      end
    end

    test("nothing of another account's scores") do
      mine = export_user("mine")
      stranger = export_user("stranger")
      Score.start(stranger, Score.blank_source("Stranger's secret"))
      Score.start(mine, Score.blank_source("Mine"))
      files = export_files(mine)
      files.keys.each do |name|
        assert_not(files[name].contains("Stranger's secret"), name)
      end
      assert_eq(JSON.parse(files["scores.json"]).map(&:title), ["Mine"])
    end

    test("an account with no score: the readme, the account, and two empty lists") do
      files = export_files(export_user("empty"))
      assert_eq(export_names(files), [
        "README.txt",
        "account.json",
        "comments.json",
        "notifications.json",
        "scores.json",
        "shared-with-me.json"
      ])
      assert_eq(JSON.parse(files["scores.json"]), [])
      assert_eq(JSON.parse(files["comments.json"]), [])
      assert_eq(JSON.parse(files["notifications.json"]), [])
    end

    test("the threads on one's scores, one's comments anywhere, one's notifications, and no one else's") do
      owner = export_user("writer")
      friend = export_user("friend")
      stranger = export_user("stranger")
      mine = Score.start(owner, Score.blank_source("Mine"))
      theirs = Score.start(friend, Score.blank_source("Theirs"))
      ScoreShare.invite(mine, friend.email, "write")
      ScoreShare.invite(theirs, owner.email, "read")
      started = ScoreThread.start(mine, owner, 1, [2, 4], "Bars 3–5, Cello", "Softer here?")["thread"]
      # Written seconds apart, as people do: the order is the time's.
      answer = started.reply(friend, "Agreed, pp.")["comment"]
      answer.created_at = answer.created_at + 5
      answer.update()
      later = ScoreThread.start(theirs, owner, 0, [0, 0], "", "Lovely opening")["comment"]
      later.created_at = later.created_at + 10
      later.update()
      ScoreThread.start(theirs, friend, 0, [1, 1], "", "Friend's own note")
      elsewhere = Score.start(stranger, Score.blank_source("Elsewhere"))
      ScoreThread.start(elsewhere, stranger, 0, [0, 0], "", "Not for the export")
      UserNotification.tell(owner._key, "reply", mine, friend, {
        "label": "Bars 3–5, Cello",
        "excerpt": "Agreed, pp."
      })
      UserNotification.tell(stranger._key, "reply", elsewhere, owner, {"excerpt": "Someone else's notice"})
      owner.keep_mail_prefs(["reply"])
      files = export_files(User.find(owner._key))
      entry = JSON.parse(files["scores.json"]).find do |row|
        row["title"] == "Mine"
      end
      assert_eq(entry["comments"].length, 1)
      thread = entry["comments"][0]
      assert_eq(thread["on"], "Bars 3–5, Cello")
      assert_eq(thread["staff"], 2)
      assert_eq(thread["bars"], [3, 5])
      assert_eq(thread["resolved"], false)
      assert_eq(thread["messages"].map(&:text), ["Softer here?", "Agreed, pp."])
      assert_eq(thread["messages"].map(&:author), [owner.email, friend.email])
      comments = JSON.parse(files["comments.json"])
      assert_eq(comments.map(&:text), ["Softer here?", "Lovely opening"])
      assert_eq(comments.map(&:own_score), [true, false])
      assert_eq(comments[1]["score"], "Theirs")
      notices = JSON.parse(files["notifications.json"])
      assert_eq(notices.length, 1)
      assert_eq(notices[0]["kind"], "reply")
      assert_eq(notices[0]["by"], [friend.email])
      assert_eq(notices[0]["excerpt"], "Agreed, pp.")
      account = JSON.parse(files["account.json"])
      assert_eq(account["notification_emails"]["reply"], true)
      assert_eq(account["notification_emails"]["changed"], false)
      everything = files.keys.map do |name|
        files[name]
      end.join("\n")
      ["Friend's own note", "Not for the export", "Someone else's notice", "Elsewhere"].each do |other|
        assert_not(everything.contains(other), "the export holds #{other}")
      end
    end
  end

  describe("parts") do
    test("one part for an ordinary account, its scores the oldest first") do
      user = export_user("parts")
      first = Score.start(user, Score.blank_source("First"))
      second = Score.start(user, Score.blank_source("Second"))
      second.created_at = first.created_at + 1
      second.save
      assert_eq(AccountExport.parts(user), [[first._key, second._key]])
      assert_eq(AccountExport.parts(export_user("none")), [[]])
    end

    test("packs scores up to the limit, never splits one, and a bigger one goes alone") do
      sizes = [
        {"key": "a", "size": 40},
        {"key": "b", "size": 60},
        {"key": "c", "size": 1},
        {"key": "d", "size": 500},
        {"key": "e", "size": 10}
      ]
      assert_eq(AccountExport.packed(sizes, 100), [
        ["a", "b"],
        ["c"],
        ["d"],
        ["e"]
      ])
      assert_eq(AccountExport.packed(sizes, 1000), [[
        "a",
        "b",
        "c",
        "d",
        "e"
      ]])
      assert_eq(AccountExport.packed([], 100), [[]])
    end

    test("a part holds its scores' files, and every part lists them all") do
      user = export_user("split")
      first = Score.start(user, Score.blank_source("First"))
      second = Score.start(user, Score.blank_source("Second"))
      second.created_at = first.created_at + 1
      second.save
      parts = [[first._key], [second._key]]
      one = AccountExport.files(user, parts, 1, 1792700073).map(&:name)
      two = AccountExport.files(user, parts, 2, 1792700073).map(&:name)
      assert_contains(one, "scores/first-#{first._key}/first.ly")
      assert_not(one.includes?("scores/second-#{second._key}/second.ly"))
      assert_contains(two, "scores/second-#{second._key}/second.ly")
      readme = AccountExport.files(user, parts, 2, 1792700073)[0]["text"]
      assert_contains(readme, "part 2 of 2")
      listed = JSON.parse(AccountExport.files(user, parts, 2, 1792700073).find(&{ |file|
        file["name"] == "scores.json"
      })["text"])
      assert_eq(listed.map(&:part), [1, 2])
    end
  end

  describe("a score with many versions (#543)") do
    test("is split across parts, each within the limit, and every version is still exported") do
      user = export_user("many")
      score = Score.start(user, Score.blank_source("Many"))
      sources = (0 .. 7).map do |i|
        "\\header { title = \"Many\" }\n{ c'#{i + 1} " + "c'4 " * 20 + "}"
      end
      size_of = {}
      size_of[score._key] = Score.find(score._key).source.length
      sources.each_with_index do |source, i|
        version = ScoreVersion.keep(score, source, "manual", user._key)
        version.created_at = 1792700000 + i
        version.update()
        size_of["version:#{version._key}"] = source.length
      end
      limit = 300
      parts = AccountExport.parts(user, limit)
      assert_gt(parts.length, 2)
      parts.each do |part|
        assert_not(part.length == 0, "an empty part")
        total = export_part_size(part, size_of)
        assert(total <= limit, "a part of #{total} characters")
      end
      assert_eq(parts.flatten().length, sources.length + 1)

      folder = "scores/many-#{score._key}"
      exported = export_folder_files(user, parts, folder)
      names = exported.keys.sort()
      assert_eq(names.length, sources.length + 1)
      assert_eq(names[0], "#{folder}/many.ly")
      names.slice(1, names.length).each_with_index do |name, i|
        assert_match(name, "versions/\\d{4}-.*-manual\\.ly$")
        assert_eq(exported[name], sources[i])
      end

      listed = JSON.parse(AccountExport.files(user, parts, 1, 1792700073).find(&{ |file|
        file["name"] == "scores.json"
      })["text"])
      assert_eq(listed[0]["part"], 1)
      assert_eq(listed[0]["versions"].length, sources.length)
      assert_eq(listed[0]["versions"].map(&:part).uniq.length, parts.length)
      assert_eq(listed[0]["versions"][sources.length - 1]["part"], parts.length)
    end
  end

  describe("versions across parts and downloads (#543)") do
    test("an old version keeps its file name when a new one comes and the oldest goes") do
      user = export_user("stable")
      score = Score.start(user, Score.blank_source("Stable"))
      kept = export_versions(score, user, 6, 1792600000)
      folder = "scores/stable-#{score._key}"
      before = export_version_texts(export_every_file(user, 300), folder)
      assert_eq(before.keys.length, kept.length)

      newer = ScoreVersion.keep(score, "\\header { title = \"Stable\" }\n{ f'1 }", "auto", user._key)
      kept[0].delete
      after = export_version_texts(export_every_file(user, 300), folder)
      assert_eq(after.keys.length, kept.length)
      kept.slice(1, kept.length).each do |version|
        names = export_names_with(before.keys, version._key)
        assert_eq(names.length, 1, version._key)
        assert_eq(after[names[0]], before[names[0]], "#{names[0]} the same file in both downloads")
      end
      assert_eq(export_names_with(after.keys, newer._key).length, 1)
      assert_eq(export_names_with(after.keys, kept[0]._key).length, 0)
    end

    test("each version is in exactly one part, and every part holding one lists them all") do
      user = export_user("once")
      score = Score.start(user, Score.blank_source("Once"))
      export_versions(score, user, 9, 1792650000)
      folder = "scores/once-#{score._key}"
      every = export_every_file(user, 300)
      held = every.filter do |file|
        file["name"].starts_with?("#{folder}/versions/")
      end
      names = held.map(&:name)
      assert_eq(names.length, 9)
      assert_eq(names.uniq.length, names.length, "a version in two parts")
      parts_with_versions = held.map(&:part).uniq
      assert_gt(parts_with_versions.length, 1)
      parts_with_versions.each do |number|
        listed = export_listed_versions(every, number, folder)
        assert_eq(listed.length, 9, "part #{number} lists every version")
        assert_eq(export_misplaced(listed, held, folder), [], "part #{number} says where each is")
      end
    end
  end

  describe("audio takes (#390)") do
    test("each take is a part's entry of its own, counted by its bytes, after the scores") do
      user = export_user("takes")
      score = Score.start(user, Score.blank_source("Sung"))
      take = ScoreTake.create({
        "score_id": score._key,
        "user_id": user._key,
        "track": 2,
        "name": "Voice",
        "offset": 1.5,
        "duration": 4.0,
        "size": 5000000,
        "created_at": 1792700000
      })
      other = Score.start(export_user("other"), Score.blank_source("Not mine"))
      ScoreTake.create({
        "score_id": other._key,
        "user_id": user._key,
        "track": 1,
        "name": "Elsewhere",
        "size": 10,
        "created_at": 1792700000
      })
      assert_eq(AccountExport.parts(user), [[score._key], ["take:#{take._key}"]])
      listed = JSON.parse(AccountExport.files(user, AccountExport.parts(user), 1, 1792700073).find(&{ |file|
        file["name"] == "scores.json"
      })["text"])
      assert_eq(listed[0]["takes"], [{
        "track": 2,
        "name": "Voice",
        "file": "takes/track-2.wav",
        "part": 2,
        "starts_at_second": 1.5,
        "seconds": 4.0,
        "recorded_at": "2026-10-22T20:13:20+00:00"
      }])
    end
  end

  describe("a collection never written to") do
    test("reads as no rows; any other error is raised, not swallowed") do
      assert_eq(AccountExport.read(fn() {
        throw "Query failed: Collection 'score_shares' not found"
      }), [])
      failing = fn() {
        throw "Query failed: timeout"
      }
      assert_raises("Query failed: timeout") do
        AccountExport.read(failing)
      end
      assert_eq(AccountExport.rows("Error: Collection 'score_versions' not found"), [])
      assert_eq(AccountExport.rows([{"key": "a"}]), [{"key": "a"}])
      assert_raises("could not be planned: Error: Parse error") do
        AccountExport.rows("Error: Parse error")
      end
    end
  end

  test("the zip reads back with the same files") do
    user = export_user("zip")
    Score.start(user, Score.blank_source("Zipped"))
    parts = AccountExport.parts(user)
    bytes = AccountExport.zip(user, parts, 1, 1792700073)
    assert_eq(bytes.slice(0, 4), [
      80,
      75,
      3,
      4
    ])
    count = bytes[bytes.length - 12] + bytes[bytes.length - 11] * 256
    assert_eq(count, AccountExport.files(user, parts, 1, 1792700073).length)
  end
end
