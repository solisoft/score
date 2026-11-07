# The shared library of sections over HTTP (#444): a member publishes bars
# from the editor (JSON); everyone reads the library and a section's page;
# a member rates, comments, reports, and takes away what is theirs; an admin
# hides, shows again, takes away or dismisses what is reported. Guests and
# strangers are refused what is not theirs, and what they send is not
# written.

const LIB_PASSWORD = "correct horse battery"
const LIB_SOURCE = "\\header { title = \"Waltz\" }\n\\new Staff { \\time 3/4 g4 b d' | c'2. }\n"

def lib_user(name = nil, role = "member")
  user = User.new()
  user.email = "lib-#{uuid_v4}@example.com"
  user.name = name unless name.nil?
  user.role = role
  user.set_password(LIB_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  # An admin reaches the admin section only with two-step on (#544).
  if role == "admin"
    secret = User.find(user._key).start_two_step
    User.find(user._key).confirm_two_step(Crypto.totp_generate(secret, DateTime.utc.to_unix, 30))
  end
  user
end

# Signed in as `user`: the password, then the code when two-step is on.
def lib_sign_in(user)
  clear_cookies()
  response = post(
    "/login",
    {"email": user.email, "password": LIB_PASSWORD}
  )
  account = User.find(user._key)
  return response unless account.two_step?

  secret = Crypto.decrypt(account.totp_secret, getenv("SOLI_ENCRYPTION_KEY"))
  post("/login/code", {"code": Crypto.totp_generate(secret, DateTime.utc.to_unix + 30, 30)})
end

def lib_fields(title = "Waltz strum")
  {
    "title": title,
    "description": "Bass, then two chords.",
    "instrument": "guitar",
    "style": "waltz",
    "time": "3/4",
    "key": "G major",
    "bpm": 96,
    "bars": 2,
    "tracks": 1,
    "section": {"bars": 2, "parts": [{
      "offset": 0,
      "voice": 1,
      "pieces": [{"ticks": 6720, "content": {"rest": true}}]
    }]},
    "source": LIB_SOURCE
  }
end

# A section published by `user`, straight through the model.
def lib_section(user, title = "Waltz strum")
  SharedSection.publish(user, lib_fields(title))["section"]
end

def lib_count(user)
  SharedSection.where({"user_id": user._key}).count
end

describe("SectionsController and AppSectionsController") do
  before_each() do
    as_guest()
    clear_cookies()
    clear_headers()
  end

  describe("publishing from the editor") do
    test("a member shares bars: 201, its page's address, the section stored as sent") do
      author = lib_user("Ana")
      lib_sign_in(author)
      response = post("/app/sections", lib_fields())
      assert_eq(res_status(response), 201)
      answer = res_json(response)
      assert_eq(answer["url"], "/sections/#{answer["id"]}")
      stored = SharedSection.find(answer["id"])
      assert_eq(stored.user_id, author._key)
      assert_eq(stored.title, "Waltz strum")
      assert_eq(stored.instrument, "guitar")
      assert_eq(stored.bars, 2)
      assert_eq(stored.section["parts"].length, 1)
      assert_eq(stored.rating_count, 0)
      assert_not(stored.hidden)
    end

    test("a guest is refused, and nothing is written") do
      before = SharedSection.count
      response = post("/app/sections", lib_fields())
      assert_eq(res_status(response), 401, "the editor is told it is signed out")
      assert_eq(SharedSection.count, before)
    end

    test("refuses a section with no name, an unknown style, no bars, too many bars, or one the engraver refuses") do
      author = lib_user()
      lib_sign_in(author)
      cases = [
        ["title", "  ", "Give the section a name."],
        ["style", "polka-metal", "Choose its style."],
        ["instrument", "kazoo", "Choose its instrument."],
        ["bars", 65, "A section is 1 to 64 bars."],
        ["tracks", 0, "A section is 1 to 8 tracks."],
        ["time", "three", "Its metre is not one this reads."],
        ["bpm", 900, "A tempo is 20 to 300 a beat."],
        ["section", "bars", "The bars are missing"],
        ["source", "{ c'4 \\shiver }", "The engraver refuses those bars"]
      ]
      cases.each do |refused|
        fields = lib_fields()
        fields[refused[0]] = refused[1]
        response = post("/app/sections", fields)
        assert_eq(res_status(response), 422, refused[0])
        assert_contains(res_json(response)["error"], refused[2])
      end
      long = lib_fields()
      long["title"] = "é" * 81
      assert_eq(res_status(post("/app/sections", long)), 422, "81 characters")
      assert_eq(lib_count(author), 0, "nothing written")
    end

    test("twenty sections a day, no more") do
      author = lib_user()
      (0 .. 20).each do |n|
        lib_section(author, "Groove #{n}")
      end
      lib_sign_in(author)
      response = post("/app/sections", lib_fields("One more"))
      assert_eq(res_status(response), 422)
      assert_contains(res_json(response)["error"], "20 sections a day")
      assert_eq(lib_count(author), 20)
    end
  end

  describe("reading the library") do
    test("everyone sees the sections, newest first, by name and never by address; a hidden one is left out") do
      author = lib_user("Ana")
      older = lib_section(author, "Bossa comping")
      older.created_at = older.created_at - 100
      older.update()
      newer = lib_section(author, "Reggae skank")
      hidden = lib_section(author, "Hidden one")
      hidden.hidden = true
      hidden.update()
      response = get("/sections")
      assert_eq(res_status(response), 200)
      titles = assigns()["sections"].map do |section|
        section.title
      end
      assert_eq(titles.index_of("Reggae skank") < titles.index_of("Bossa comping"), true)
      assert_not(titles.includes?("Hidden one"))
      body = res_body(response)
      assert_contains(body, "by Ana")
      assert_not(body.contains(author.email))
    end

    test("searched by word, filtered by instrument and style; JSON for the editor") do
      author = lib_user()
      lib_section(author, "Funky clavinet")
      drums = lib_section(author, "Shuffle groove")
      drums.instrument = "drums"
      drums.style = "blues"
      drums.update()
      get("/sections?q=clavinet")
      assert_eq(assigns()["sections"].length >= 1, true)
      assert(assigns()["sections"].all?(&{ |section|
        section.title.downcase.contains("clavinet")
      }))
      get("/sections?instrument=drums&style=blues")
      assert(assigns()["sections"].any?(&{ |section|
        section._key == drums._key
      }))
      assert(assigns()["sections"].all?(&{ |section|
        section.instrument == "drums"
      }))
      SectionRating.rate(drums, lib_user(), 4)
      SectionRating.rate(drums, lib_user(), 5)
      found = res_json(get("/sections/search.json?q=shuffle"))
      assert_eq(found["sections"][0]["rating"], 4.5, "the average, in the list too")
      assert_eq(found["sections"][0]["rating_count"], 2)
      assert_eq(found["sections"][0]["id"], drums._key)
      assert_eq(found["sections"][0]["url"], "/sections/#{drums._key}")
      assert_not(found["sections"][0].has_key("source"), "no source in the list")
    end

    test("a section's page engraves it; its bars and source for the editor; a hidden one is a 404 but to an admin") do
      author = lib_user("Ana")
      section = lib_section(author)
      page = get("/sections/#{section._key}")
      assert_eq(res_status(page), 200)
      assert_contains(res_body(page), "Waltz strum")
      assert_contains(res_body(page), "<svg")
      assert_contains(
        res_body(page),
        "data-section=\"/sections/#{section._key}/data.json\" data-loop",
        "played in a loop (#457)"
      )
      data = res_json(get("/sections/#{section._key}/data.json"))
      assert_eq(data["section"]["bars"], 2)
      assert_eq(data["author"], "Ana")
      assert_eq(res_status(get("/sections/#{section._key}/preview.svg")), 200)
      assert_eq(res_status(get("/sections/no-such-section")), 404)
      section.hidden = true
      section.update()
      assert_eq(res_status(get("/sections/#{section._key}")), 404)
      assert_eq(res_status(get("/sections/#{section._key}/data.json")), 404)
      lib_sign_in(lib_user("Admin", "admin"))
      assert_eq(res_status(get("/sections/#{section._key}")), 200)
    end

    test("each card plays its section: a Play button outside its link, and the MIDI it fetches (#449)") do
      author = lib_user()
      section = lib_section(author, "Playable strum")
      body = res_body(get("/sections?q=playable"))
      assert_contains(body, "data-midi=\"/sections/#{section._key}/play.mid\"")
      assert_contains(body, "aria-label=\"Play Playable strum\"")
      assert_contains(
        body,
        "data-section=\"/sections/#{section._key}/data.json\"",
        "its source fetched on Play, to hear how it asks to be played"
      )
      # The button comes after the card's link closes: no button inside a link.
      card = body.split("data-section-card=\"#{section._key}\"")[1].split("data-score-play")[0]
      assert_contains(card, "</a>")
      midi = get("/sections/#{section._key}/play.mid")
      assert_eq(res_status(midi), 200)
      assert_eq(res_header(midi, "Content-Type"), "audio/midi")
      assert(res_body(midi).starts_with?("MThd"), "a MIDI file")
      assert_eq(res_status(get("/sections/no-such-section/play.mid")), 404)
      section.hidden = true
      section.update()
      as_guest()
      assert_eq(res_status(get("/sections/#{section._key}/play.mid")), 404, "hidden: not played")
    end
  end

  describe("adding a section to one's score (#451)") do
    test("the page offers the person's own scores, or a new one; a guest is asked to sign in") do
      author = lib_user()
      section = lib_section(author)
      guest_page = res_body(get("/sections/#{section._key}"))
      assert_contains(guest_page, "to add it to one of your scores")
      assert_not(guest_page.contains("data-section-import"))
      reader = lib_user()
      mine = Score.start(reader, "\\header { title = \"My song\" }\n{ c'1 }\n")
      theirs = Score.start(author, "\\header { title = \"Not yours\" }\n{ c'1 }\n")
      lib_sign_in(reader)
      page = res_body(get("/sections/#{section._key}"))
      assert_contains(page, "data-section-import")
      assert_contains(page, "<option value=\"#{mine._key}\">My song</option>")
      assert_not(page.contains(theirs._key), "nobody else's scores")
    end

    test("a new score made of it; one of the person's opens in the editor, which is told to add it") do
      author = lib_user()
      section = lib_section(author)
      reader = lib_user()
      lib_sign_in(reader)
      count_before = Score.where({"user_id": reader._key}).count
      made = post("/app/sections/#{section._key}/import", {"score_id": "new"})
      assert_eq(res_status(made), 302)
      assert_eq(Score.where({"user_id": reader._key}).count, count_before + 1)
      created = Score.where({"user_id": reader._key}).order("created_at", "desc").first
      assert_eq(res_location(made), "/app/scores/#{created._key}")
      assert_contains(Score.find(created._key).source, "\\time 3/4")
      mine = Score.start(reader, "{ c'1 }\n")
      into = post("/app/sections/#{section._key}/import", {"score_id": mine._key})
      assert_eq(res_location(into), "/app/scores/#{mine._key}?section=#{section._key}")
      editor = res_body(get("/app/scores/#{mine._key}?section=#{section._key}"))
      assert_contains(editor, "\"import_section\":\"/sections/#{section._key}/data.json\"")
      assert_contains(res_body(get("/app/scores/#{mine._key}?section=%22%3E%3Cscript%3E")), "\"import_section\":\"\"")
      assert_eq(Score.find(mine._key).source, "{ c'1 }\n", "the score itself changes only in the editor")
    end

    test("refused: a guest, a score of someone else's, an unknown or a hidden section — and nothing made") do
      author = lib_user()
      section = lib_section(author)
      theirs = Score.start(author, "{ c'1 }\n")
      as_guest()
      clear_cookies()
      guest = post("/app/sections/#{section._key}/import", {"score_id": "new"})
      assert_ne(res_status(guest), 200)
      assert_not(res_location(guest).to_s.starts_with?("/app/scores/"), "no score opened for a guest")
      reader = lib_user()
      lib_sign_in(reader)
      assert_eq(res_status(post("/app/sections/#{section._key}/import", {"score_id": theirs._key})), 403)
      assert_eq(res_status(post("/app/sections/no-such/import", {"score_id": "new"})), 404)
      section.hidden = true
      section.update()
      assert_eq(res_status(post("/app/sections/#{section._key}/import", {"score_id": "new"})), 404)
      assert_eq(Score.where({"user_id": reader._key}).count, 0, "nothing made for the reader")
    end
  end

  describe("rating") do
    test("one rating a member, changed by rating again; the average follows; the author cannot rate") do
      author = lib_user()
      section = lib_section(author)
      first = lib_user()
      lib_sign_in(first)
      response = post("/app/sections/#{section._key}/rating", {"stars": 5})
      assert(res_redirect?(response))
      post("/app/sections/#{section._key}/rating", {"stars": 3})
      second = lib_user()
      lib_sign_in(second)
      post("/app/sections/#{section._key}/rating", {"stars": 4})
      stored = SharedSection.find(section._key)
      assert_eq(stored.rating_count, 2)
      assert_eq(stored.average, 3.5)
      assert_eq(SectionRating.where({"section_id": section._key}).count, 2)
      lib_sign_in(author)
      post("/app/sections/#{section._key}/rating", {"stars": 5})
      assert_eq(SharedSection.find(section._key).rating_count, 2, "the author's own is refused")
    end

    test("0 or 6 stars are refused; a guest is refused") do
      section = lib_section(lib_user())
      response = post("/app/sections/#{section._key}/rating", {"stars": 5})
      assert_eq(res_status(response), 401)
      lib_sign_in(lib_user())
      post("/app/sections/#{section._key}/rating", {"stars": 0})
      post("/app/sections/#{section._key}/rating", {"stars": 6})
      assert_eq(SectionRating.where({"section_id": section._key}).count, 0)
    end
  end

  describe("comments") do
    test("a member comments; the page shows it; its author or an admin takes it away, no one else") do
      section = lib_section(lib_user())
      writer = lib_user("Wes")
      lib_sign_in(writer)
      post("/app/sections/#{section._key}/comments", {"body": "Lovely groove"})
      comment = SectionComment.where({"section_id": section._key}).first
      assert_eq(comment.body, "Lovely groove")
      assert_eq(SharedSection.find(section._key).comments_count, 1)
      assert_contains(res_body(get("/sections/#{section._key}")), "Lovely groove")
      lib_sign_in(lib_user())
      refused = post("/app/sections/#{section._key}/comments/#{comment._key}/remove", {})
      assert_eq(res_status(refused), 403)
      assert_not_null(SectionComment.find_by("_key", comment._key))
      lib_sign_in(writer)
      post("/app/sections/#{section._key}/comments/#{comment._key}/remove", {})
      assert_null(SectionComment.find_by("_key", comment._key))
      assert_eq(SharedSection.find(section._key).comments_count, 0)
    end

    test("an empty or too long comment is refused; a comment of another section is a 404") do
      section = lib_section(lib_user())
      other = lib_section(lib_user(), "Other")
      lib_sign_in(lib_user())
      post("/app/sections/#{section._key}/comments", {"body": "   "})
      post("/app/sections/#{section._key}/comments", {"body": "a" * 2001})
      assert_eq(SectionComment.where({"section_id": section._key}).count, 0)
      post("/app/sections/#{other._key}/comments", {"body": "Elsewhere"})
      elsewhere = SectionComment.where({"section_id": other._key}).first
      response = post("/app/sections/#{section._key}/comments/#{elsewhere._key}/remove", {})
      assert_eq(res_status(response), 404)
    end
  end

  describe("taking a section away") do
    test("its author does, with its ratings and comments; anyone else is refused") do
      author = lib_user()
      section = lib_section(author)
      rater = lib_user()
      SectionRating.rate(section, rater, 4)
      SectionComment.write(section, rater, "Nice")
      lib_sign_in(rater)
      assert_eq(res_status(post("/app/sections/#{section._key}/remove", {})), 403)
      assert_not_null(SharedSection.find_by("_key", section._key))
      lib_sign_in(author)
      # Asked first by the button's data-confirm, which the policy lets run
      # (an inline onsubmit it would block, and the form would go unasked).
      page = res_body(get("/sections/#{section._key}"))
      asked = "Take this section away from the library? Its ratings and comments go with it."
      assert_contains(page, "data-confirm=\"#{asked}\" data-section-remove")
      assert_not(page.contains("onsubmit"))
      response = post("/app/sections/#{section._key}/remove", {})
      assert_eq(res_location(response), "/sections")
      assert_null(SharedSection.find_by("_key", section._key))
      assert_eq(SectionRating.where({"section_id": section._key}).count, 0)
      assert_eq(SectionComment.where({"section_id": section._key}).count, 0)
    end
  end

  describe("reports and the admins") do
    test("a member reports a section and a comment, once each; a member is refused the admin page") do
      section = lib_section(lib_user())
      writer = lib_user()
      comment = SectionComment.write(section, writer, "Rude words")["comment"]
      reporter = lib_user()
      lib_sign_in(reporter)
      post("/app/sections/#{section._key}/reports", {"reason": "Not music"})
      post("/app/sections/#{section._key}/reports", {"reason": "Not music, again"})
      post(
        "/app/sections/#{section._key}/reports",
        {"reason": "Rude", "comment_id": comment._key}
      )
      post("/app/sections/#{section._key}/reports", {"reason": "  "})
      reports = SectionReport.where({"user_id": reporter._key}).all
      assert_eq(reports.length, 2, "one a thing, none without a reason")
      assert_eq(res_status(get("/admin/reports")), 404)
      assert_eq(res_status(post("/admin/reports/#{reports[0]._key}/dismiss", {})), 404)
      assert_null(SectionReport.find(reports[0]._key).resolved_at)
      assert_eq(AdminAction.about(reports[0]._key).length, 0)
    end

    test("an admin hides a reported section, shows it again, and takes a reported comment away") do
      author = lib_user("Ana")
      section = lib_section(author)
      comment = SectionComment.write(section, lib_user(), "Rude words")["comment"]
      reporter = lib_user()
      SectionReport.file(section, nil, reporter, "Not music")
      SectionReport.file(section, comment, reporter, "Rude")
      admin = lib_user("Admin", "admin")
      lib_sign_in(admin)
      page = get("/admin/reports")
      assert_eq(res_status(page), 200)
      assert_contains(res_body(page), "Rude words")
      reports = SectionReport.still_open
      on_section = reports.filter do |report|
        report.target == "section" && report.section_id == section._key
      end[0]
      on_comment = reports.filter do |report|
        report.target == "comment" && report.target_id == comment._key
      end[0]
      post("/admin/reports/#{on_section._key}/hide", {})
      assert(SharedSection.find(section._key).hidden)
      assert_not_null(SectionReport.find(on_section._key).resolved_at)
      as_guest()
      clear_cookies()
      assert_eq(res_status(get("/sections/#{section._key}")), 404, "hidden from everyone")
      lib_sign_in(lib_user("Admin", "admin"))
      post("/admin/reports/#{on_section._key}/show", {})
      assert_not(SharedSection.find(section._key).hidden)
      post("/admin/reports/#{on_comment._key}/remove", {})
      assert_null(SectionComment.find_by("_key", comment._key))
      assert_eq(SharedSection.find(section._key).comments_count, 0)
      # Each act kept with the report, and who did it (#544).
      on_hidden = AdminAction.about(on_section._key)
      assert_eq(on_hidden.map(&:action), ["report_show", "report_hide"])
      assert_eq(on_hidden[1].admin_id, admin._key)
      assert_eq(on_hidden[1].details["section_id"], section._key)
      assert_eq(on_hidden[1].summary, "Report: hidden")
      on_removed = AdminAction.about(on_comment._key)
      assert_eq(on_removed.map(&:action), ["report_remove"])
      assert_eq(on_removed[0].details["target_id"], comment._key)
      assert_eq(on_removed[0].target_type, "report")
    end

    test("an admin dismisses a report: the section stays as it was") do
      section = lib_section(lib_user())
      SectionReport.file(section, nil, lib_user(), "Not sure")
      report = SectionReport.where({"section_id": section._key}).first
      lib_sign_in(lib_user("Admin", "admin"))
      post("/admin/reports/#{report._key}/dismiss", {})
      assert_eq(SectionReport.find(report._key).outcome, "dismissed")
      assert_not(SharedSection.find(section._key).hidden)
      assert_eq(AdminAction.about(report._key).map(&:action), ["report_dismiss"])
    end
  end

  describe("an admin's powers in the library (#687)") do
    test("an admin signed in with the password alone takes nothing away and sees nothing hidden") do
      author = lib_user("Ana")
      section = lib_section(author)
      SectionComment.write(section, author, "Mine")
      comment = SectionComment.where({"section_id": section._key}).first
      hidden = lib_section(author, "Hidden strum")
      hidden.hidden = true
      hidden.update()
      # An admin without two-step: signed in on the password, no second step.
      admin = lib_user("Admin")
      admin.role = "admin"
      admin.update()
      lib_sign_in(User.find(admin._key))
      assert_eq(res_status(get("/app/account")), 200, "signed in")
      page = res_body(get("/sections/#{section._key}"))
      assert_not(page.contains("data-section-remove"), "no Remove button")
      assert_not(page.contains("/comments/#{comment._key}/remove"), "no Delete button")
      refused = post("/app/sections/#{section._key}/comments/#{comment._key}/remove", {})
      assert_eq(res_status(refused), 403)
      assert_not_null(SectionComment.find_by("_key", comment._key))
      assert_eq(res_status(post("/app/sections/#{section._key}/remove", {})), 403)
      assert_not_null(SharedSection.find_by("_key", section._key))
      assert_eq(res_status(get("/sections/#{hidden._key}")), 404)
      assert_eq(res_status(get("/sections/#{hidden._key}/data.json")), 404)
      assert_eq(res_status(post("/app/sections/#{hidden._key}/rating", {"stars": "5"})), 404)
      assert_eq(AdminAction.about(author._key).length, 0)
    end

    test("an admin with the second step takes a member's comment and section away, each kept in the admins' log") do
      author = lib_user("Ana")
      section = lib_section(author, "Bossa strum")
      SectionComment.write(section, author, "Mine")
      comment = SectionComment.where({"section_id": section._key}).first
      admin = lib_user("Admin", "admin")
      lib_sign_in(admin)
      page = res_body(get("/sections/#{section._key}"))
      assert_contains(page, "/comments/#{comment._key}/remove", "a Delete button")
      response = post("/app/sections/#{section._key}/comments/#{comment._key}/remove", {})
      assert_eq(res_status(response), 302)
      assert_null(SectionComment.find_by("_key", comment._key))
      removed = AdminAction.about(comment._key)
      assert_eq(removed.length, 1)
      assert_eq(removed[0].action, "comment_remove")
      assert_eq(removed[0].admin_id, admin._key)
      assert_eq(removed[0].details["owner"], author._key)
      assert_eq(removed[0].details["body"], "Mine")
      assert_eq(removed[0].account_key, author._key)
      assert_eq(removed[0].summary, "Took away a comment on the section “Bossa strum”")

      post("/app/sections/#{section._key}/remove", {})
      assert_null(SharedSection.find_by("_key", section._key))
      on_author = AdminAction.about(author._key)
      assert_eq(on_author.map(&:action), ["section_remove", "comment_remove"])
      assert_eq(on_author[0].target_id, section._key)
      assert_eq(on_author[0].summary, "Took the section “Bossa strum” away from the library")
      # The author's page in the admin lists both, linked to the account.
      listed = res_body(get("/admin/customers/#{author._key}"))
      assert_contains(listed, "data-admin-action=\"section_remove\"")
      assert_contains(listed, "data-admin-action=\"comment_remove\"")
    end

    test("an admin taking away their own section or comment is no admin act: nothing logged") do
      admin = lib_user("Admin", "admin")
      section = lib_section(admin, "Admin strum")
      SectionComment.write(section, admin, "Own")
      comment = SectionComment.where({"section_id": section._key}).first
      lib_sign_in(admin)
      post("/app/sections/#{section._key}/comments/#{comment._key}/remove", {})
      assert_null(SectionComment.find_by("_key", comment._key))
      post("/app/sections/#{section._key}/remove", {})
      assert_null(SharedSection.find_by("_key", section._key))
      assert_eq(AdminAction.about(admin._key).length, 0)
      assert_eq(AdminAction.about(section._key).length, 0)
    end

    test("AdminAction.kept: a line that cannot be written stops the request (503), and nothing is written") do
      admin = lib_user("Admin", "admin")
      before = AdminAction.where({"admin_id": admin._key}).count
      message = assert_raises("could not be written") do
        AdminAction.kept(admin, "not-a-kind", "section", "some-section", {})
      end
      assert_contains(message, "nothing was done")
      assert_eq(AdminAction.where({"admin_id": admin._key}).count, before)
      kept = AdminAction.kept(admin, "section_remove", "section", "some-section", {
        "owner": "x",
        "title": "T"
      })
      assert_null(kept._errors)
      assert_eq(AdminAction.where({"admin_id": admin._key}).count, before + 1)
    end
  end
end
