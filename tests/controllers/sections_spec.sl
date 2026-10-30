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
  user
end

def lib_sign_in(user)
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": LIB_PASSWORD}
  )
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
    end

    test("an admin hides a reported section, shows it again, and takes a reported comment away") do
      author = lib_user("Ana")
      section = lib_section(author)
      comment = SectionComment.write(section, lib_user(), "Rude words")["comment"]
      reporter = lib_user()
      SectionReport.file(section, nil, reporter, "Not music")
      SectionReport.file(section, comment, reporter, "Rude")
      lib_sign_in(lib_user("Admin", "admin"))
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
    end

    test("an admin dismisses a report: the section stays as it was") do
      section = lib_section(lib_user())
      SectionReport.file(section, nil, lib_user(), "Not sure")
      report = SectionReport.where({"section_id": section._key}).first
      lib_sign_in(lib_user("Admin", "admin"))
      post("/admin/reports/#{report._key}/dismiss", {})
      assert_eq(SectionReport.find(report._key).outcome, "dismissed")
      assert_not(SharedSection.find(section._key).hidden)
    end
  end
end
