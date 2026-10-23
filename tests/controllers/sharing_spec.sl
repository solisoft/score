# Sharing a score: its read page by link, and the people it is shared with.

const SHARE_PASSWORD = "correct horse battery"

def share_user
  user = User.new()
  user.email = "share-#{uuid_v4}@example.com"
  user.set_password(SHARE_PASSWORD)
  # Confirmed: an address must be, to sign in.
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  user
end

def share_sign_in(user)
  clear_cookies()
  post(
    "/login",
    {"email": user.email, "password": SHARE_PASSWORD}
  )
end

describe("Sharing") do
  before_each() do
    as_guest()
    clear_cookies()
  end

  describe("the read page") do
    test("a private score's link opens for nobody but its owner") do
      owner = share_user()
      score = Score.start(owner, Score.blank_source("Secret"))
      assert_eq(score.visibility, "private")
      assert_eq(res_status(get("/s/#{score.share_token}")), 404)
      assert_eq(res_status(get("/s/#{score.share_token}/source.ly")), 404)
      assert_eq(res_status(get("/s/#{score.share_token}/score.pdf")), 404)
      share_sign_in(share_user())
      assert_eq(res_status(get("/s/#{score.share_token}")), 404)
      share_sign_in(owner)
      assert_eq(res_status(get("/s/#{score.share_token}")), 200)
    end

    test("by link: anyone reads, plays and prints it, and search engines are asked to stay out") do
      owner = share_user()
      score = Score.start(owner, Score.blank_source("Open air"))
      share_sign_in(owner)
      post("/app/scores/#{score._key}/share", {"visibility": "link"})
      clear_cookies()
      page = get("/s/#{score.share_token}")
      assert_eq(res_status(page), 200)
      assert_contains(res_body(page), "Open air")
      assert_contains(res_body(page), "<meta name=\"robots\" content=\"noindex\">")
      assert_not(res_body(page).contains("Open in the editor"))
      source = get("/s/#{score.share_token}/source.ly")
      assert_contains(res_body(source), "Open air")
      assert_eq(res_status(get("/s/#{score.share_token}/score.pdf")), 200)
    end

    test("a guest takes the score away: PDF under its title, MIDI, MusicXML, LilyPond, parts; nothing edits") do
      owner = share_user()
      score = Score.start(owner, Score.blank_source("Für Elise / op. 59"))
      score.make_visible("link")
      clear_cookies()
      page = get("/s/#{score.share_token}")
      assert_eq(res_status(page), 200)
      body = res_body(page)
      assert_eq(assigns()["file_name"], "für-elise-op-59")
      # MIDI as Play plays it, under the title.
      assert_contains(body, "data-score-midi href=\"data:audio/midi;base64,")
      assert_contains(body, "download=\"für-elise-op-59.mid\"")
      # The PDF on its paper, under the title.
      assert_contains(
        body,
        "data-score-pdf href=\"/s/#{score.share_token}/score.pdf\" download=\"für-elise-op-59.pdf\""
      )
      assert_contains(body, ">A4 PDF</a>")
      # The files written in the browser, from the readable source alone.
      assert_contains(body, "data-read-exports data-source-url=\"/s/#{score.share_token}/source.ly\"")
      assert_contains(body, "data-read-musicxml>MusicXML</button>")
      assert_contains(body, "data-read-parts>A part…</button>")
      assert_contains(body, "data-read-part-pdf>Part as PDF</button>")
      assert_contains(body, "data-read-part-ly>Part as LilyPond</button>")
      assert_contains(body, "download=\"für-elise-op-59.ly\"")
      # Nothing that changes the score: no editor, no save, no form.
      assert_not(body.contains("Open in the editor"))
      assert_not(body.contains("/app/scores/#{score._key}"))
      assert_not(body.contains("<form"))
      assert_not(body.contains("<textarea"), "no source box to type into")

      pdf = get("/s/#{score.share_token}/score.pdf")
      assert_eq(res_status(pdf), 200)
      assert_eq(
        res_header(pdf, "Content-Disposition"),
        "inline; filename=\"f-r-elise-op-59.pdf\"; filename*=UTF-8''f%C3%BCr-elise-op-59.pdf"
      )
      assert(res_body(pdf).starts_with?("%PDF"))
    end

    test("the PDF of a Letter score is offered as Letter; a score the engraver refuses offers no files") do
      owner = share_user()
      letter = Score.start(
        owner,
        "\\header { title = \"Letter\" }\n\\paper { #(set-paper-size \"letter\") }\n{ c'4 d' e' f' }"
      )
      letter.make_visible("link")
      refused = Score.start(owner, "\\header { title = \"Broken\" }\n{ c'4 \\foo }")
      refused.make_visible("link")
      clear_cookies()
      body = res_body(get("/s/#{letter.share_token}"))
      assert_contains(body, ">Letter PDF</a>")
      assert_not(body.contains("A4 PDF"))
      broken = get("/s/#{refused.share_token}")
      assert_eq(res_status(broken), 200)
      assert_contains(res_body(broken), "score-sheet-refused")
      assert_not(res_body(broken).contains("data-read-exports"))
      assert_not(res_body(broken).contains("data-score-pdf"))
    end

    test("a private score's files are refused to a guest, the PDF included, and say nothing of its title") do
      score = Score.start(share_user(), Score.blank_source("Hidden title"))
      clear_cookies()
      pdf = get("/s/#{score.share_token}/score.pdf")
      assert_eq(res_status(pdf), 404)
      assert_null(res_header(pdf, "Content-Disposition"))
      assert_not(res_body(pdf).contains("Hidden"))
    end

    test("public: open, and indexable") do
      owner = share_user()
      score = Score.start(owner, Score.blank_source("Anthem"))
      share_sign_in(owner)
      post("/app/scores/#{score._key}/share", {"visibility": "public"})
      clear_cookies()
      body = res_body(get("/s/#{score.share_token}"))
      assert_contains(body, "Anthem")
      assert_not(body.contains("noindex"))
    end

    test("a new link closes the old one") do
      owner = share_user()
      score = Score.start(owner, Score.blank_source("Moved"))
      share_sign_in(owner)
      post("/app/scores/#{score._key}/share", {"visibility": "link"})
      post("/app/scores/#{score._key}/share/link", {})
      fresh = Score.find(score._key)
      assert_ne(fresh.share_token, score.share_token)
      clear_cookies()
      assert_eq(res_status(get("/s/#{score.share_token}")), 404)
      assert_eq(res_status(get("/s/#{fresh.share_token}")), 200)
    end

    test("a trashed score's link, and a made-up one, open nothing") do
      owner = share_user()
      score = Score.start(owner, Score.blank_source("Binned"))
      score.make_visible("link")
      Score.find(score._key).move_to_trash
      assert_eq(res_status(get("/s/#{score.share_token}")), 404)
      assert_eq(res_status(get("/s/not-a-token")), 404)
    end

    test("refuses a visibility that does not exist") do
      owner = share_user()
      score = Score.start(owner, Score.blank_source("Odd"))
      share_sign_in(owner)
      assert_eq(res_status(post("/app/scores/#{score._key}/share", {"visibility": "everyone"})), 422)
      assert_eq(Score.find(score._key).visibility, "private")
    end
  end

  describe("people") do
    test("invited to read: the score is in their library, opens on its read page, and cannot be changed") do
      owner = share_user()
      reader = share_user()
      score = Score.start(owner, Score.blank_source("Chorale"))
      share_sign_in(owner)
      post(
        "/app/scores/#{score._key}/invitations",
        {"email": reader.email.upcase, "role": "read"}
      )
      share_page = res_body(get("/app/scores/#{score._key}/share"))
      assert_contains(share_page, reader.email)
      # The invitation left: the notice says nothing of a failed email.
      assert_contains(share_page, "#{reader.email} may now open “Chorale”.")
      assert_not(share_page.contains("could not be sent"))
      share_sign_in(reader)
      get("/app/scores")
      assert_eq(assigns()["shared"].map(&{ |entry|
        entry["score"].title
      }), ["Chorale"])
      assert_eq(res_location(get("/app/scores/#{score._key}")), "/s/#{score.share_token}")
      assert_eq(res_status(get("/s/#{score.share_token}")), 200)
      assert_eq(res_status(put(
        "/app/scores/#{score._key}",
        {"source": "{ c'1 }", "revision": score.revision}
      )), 403)
      assert_contains(Score.find(score._key).source, "r1")
    end

    test("invited to write: they edit and save, but neither trash nor share it") do
      owner = share_user()
      writer = share_user()
      score = Score.start(owner, Score.blank_source("Duet"))
      share_sign_in(owner)
      post(
        "/app/scores/#{score._key}/invitations",
        {"email": writer.email, "role": "write"}
      )
      share_sign_in(writer)
      editor = get("/app/scores/#{score._key}")
      assert_eq(res_status(editor), 200)
      assert_not(res_body(editor).contains("/share\">Share"))
      assert_contains(res_body(editor), "shareUrl: null")
      # File's link item copies the score's address in the app, which opens for them.
      assert_contains(res_body(editor), "scoreUrl: \"/app/scores/#{score._key}\"")
      assert_contains(res_body(editor), "Copy a link to this score <kbd>for those it is shared with</kbd>")
      assert_not(res_body(editor).contains("data-act=\"share\">Share…"))
      saved = put(
        "/app/scores/#{score._key}",
        {"source": "\\header { title = \"Duet\" }\n{ c'1 }", "revision": score.revision}
      )
      assert_eq(res_status(saved), 200)
      assert_eq(res_status(post("/app/scores/#{score._key}/trash", {})), 403)
      assert_eq(res_status(get("/app/scores/#{score._key}/share")), 403)
      assert_eq(res_status(post(
        "/app/scores/#{score._key}/invitations",
        {"email": "x@example.com", "role": "write"}
      )), 403)
      assert_not(Score.find(score._key).trashed?)
    end

    test("the live room's ticket: for those who may edit, and no one else") do
      owner = share_user()
      writer = share_user()
      reader = share_user()
      stranger = share_user()
      score = Score.start(owner, Score.blank_source("Room"))
      assert_eq(res_status(get("/app/scores/#{score._key}/room_ticket")), 302)
      share_sign_in(stranger)
      refused = get("/app/scores/#{score._key}/room_ticket")
      assert_eq(res_status(refused), 403)
      assert_not(res_body(refused).contains("ticket"))
      assert_eq(res_status(get("/app/scores/no-such-score/room_ticket")), 404)
      ScoreShare.invite(score, reader.email, "read")
      share_sign_in(reader)
      assert_eq(res_status(get("/app/scores/#{score._key}/room_ticket")), 403)
      share = ScoreShare.invite(score, writer.email, "write")
      share_sign_in(writer)
      answer = get("/app/scores/#{score._key}/room_ticket")
      assert_eq(res_status(answer), 200)
      admitted = ScoreRoom.admit(res_json(answer)["ticket"], DateTime.utc.to_unix)
      assert_eq(admitted["score"], score._key)
      assert_eq(admitted["user"], writer._key)
      share.delete
      assert_eq(res_status(get("/app/scores/#{score._key}/room_ticket")), 403)
      share_sign_in(owner)
      assert_eq(res_status(get("/app/scores/#{score._key}/room_ticket")), 200)
      score.move_to_trash
      assert_eq(res_status(get("/app/scores/#{score._key}/room_ticket")), 404)
    end

    test("a copy made by someone it is shared with goes to their own library") do
      owner = share_user()
      reader = share_user()
      score = Score.start(owner, Score.blank_source("Theme"))
      ScoreShare.invite(score, reader.email, "read")
      share_sign_in(reader)
      post("/app/scores/#{score._key}/duplicate", {})
      assert_eq(Score.library(reader, "", "title").map(&{ |copy|
        copy.title
      }), ["Theme (copy)"])
      assert_eq(Score.library(owner, "", "title").length, 1)
    end

    test("inviting again changes the role; removing takes the score away") do
      owner = share_user()
      guest = share_user()
      score = Score.start(owner, Score.blank_source("Rondeau"))
      share_sign_in(owner)
      post(
        "/app/scores/#{score._key}/invitations",
        {"email": guest.email, "role": "read"}
      )
      post(
        "/app/scores/#{score._key}/invitations",
        {"email": guest.email, "role": "write"}
      )
      shares = ScoreShare.of(score)
      assert_eq(shares.length, 1)
      assert_eq(shares[0].role, "write")
      assert_contains(
        res_body(get("/app/scores/#{score._key}/share")),
        "action=\"/app/scores/#{score._key}/invitations/#{shares[0]._key}\""
      )
      request("DELETE", "/app/scores/#{score._key}/invitations/#{shares[0]._key}", {}, {})
      assert_eq(ScoreShare.of(score).length, 0)
      share_sign_in(guest)
      assert_eq(res_status(get("/app/scores/#{score._key}")), 403)
    end

    test("refuses the owner's own address, a wrong address, a wrong role, and writes nothing") do
      owner = share_user()
      score = Score.start(owner, Score.blank_source("Solo"))
      share_sign_in(owner)
      own = post(
        "/app/scores/#{score._key}/invitations",
        {"email": owner.email, "role": "read"}
      )
      assert_eq(res_status(own), 422)
      assert_contains(res_body(own), "your own address")
      assert_eq(res_status(post(
        "/app/scores/#{score._key}/invitations",
        {"email": "not-an-address", "role": "read"}
      )), 422)
      assert_eq(res_status(post(
        "/app/scores/#{score._key}/invitations",
        {"email": "a@example.com", "role": "admin"}
      )), 422)
      assert_eq(ScoreShare.of(score).length, 0)
    end

    test("a share of another score is not removed through this one") do
      owner = share_user()
      score = Score.start(owner, Score.blank_source("A"))
      other = Score.start(owner, Score.blank_source("B"))
      share = ScoreShare.invite(other, "friend@example.com", "read")
      share_sign_in(owner)
      assert_eq(res_status(request("DELETE", "/app/scores/#{score._key}/invitations/#{share._key}", {}, {})), 404)
      assert_eq(ScoreShare.of(other).length, 1)
    end

    test("someone else cannot change who reads a score") do
      owner = share_user()
      score = Score.start(owner, Score.blank_source("Mine alone"))
      share_sign_in(share_user())
      assert_eq(res_status(post("/app/scores/#{score._key}/share", {"visibility": "public"})), 403)
      assert_eq(res_status(post("/app/scores/#{score._key}/share/link", {})), 403)
      assert_eq(Score.find(score._key).visibility, "private")
      assert_eq(Score.find(score._key).share_token, score.share_token)
    end

    test("leaving goes with the account: what they shared and what was shared with them") do
      owner = share_user()
      friend = share_user()
      score = Score.start(owner, Score.blank_source("Farewell"))
      ScoreShare.invite(score, friend.email, "read")
      theirs = Score.start(friend, Score.blank_source("Theirs"))
      ScoreShare.invite(theirs, owner.email, "write")
      Score.delete_all_of(owner)
      assert_eq(ScoreShare.where({"owner_id": owner._key}).all.length, 0)
      assert_eq(ScoreShare.where({"email": owner.email}).all.length, 0)
    end
  end
end
