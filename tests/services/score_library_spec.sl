# ScoreLibrary: the catalogue, and the only door to the files under scores/.

describe("ScoreLibrary") do
  describe("the catalogue") do
    test("lists six families, each with pieces") do
      slugs = ScoreLibrary.categories.map do |cat|
        cat["slug"]
      end
      assert_eq(slugs, [
        "solos",
        "voice",
        "piano",
        "guitar",
        "drums",
        "ensembles"
      ])
      ScoreLibrary.categories.each do |cat|
        assert_gt(ScoreLibrary.examples_in(cat["slug"]).length, 2, cat["slug"])
      end
    end

    test("files every example under a family that exists") do
      ScoreLibrary.examples.each do |example|
        assert_not_null(ScoreLibrary.category(example["category"]), example["slug"])
      end
    end

    test("gives every example a unique address") do
      addresses = ScoreLibrary.examples.map do |example|
        example["category"] + "/" + example["slug"]
      end
      assert_eq(addresses.uniq().length, addresses.length)
    end

    test("has a source the engraver accepts behind every example") do
      ScoreLibrary.examples.each do |example|
        laid = eui_score_layout(ScoreLibrary.source(example), 120, {})
        assert_null(laid["error"], example["slug"])
      end
    end
  end

  describe("lookups") do
    test("finds a family and a piece") do
      assert_eq(ScoreLibrary.category("piano")["title"], "Piano")
      assert_eq(ScoreLibrary.example("piano", "waltz")["title"], "Little Waltz")
    end

    test("answers nil for an unknown family or piece") do
      assert_null(ScoreLibrary.category("harpe"))
      assert_null(ScoreLibrary.example("piano", "nocturne"))
      assert_null(ScoreLibrary.example("solos", "waltz"))
      assert_eq(ScoreLibrary.examples_in("harpe").length, 0)
    end
  end

  describe("source_named") do
    test("reads a snippet and a gallery piece") do
      assert_contains(ScoreLibrary.source_named("syntax/notes"), "c'4")
      assert_contains(ScoreLibrary.source_named("piano/waltz"), "Little Waltz")
    end

    test("refuses names that would leave scores/") do
      assert_null(ScoreLibrary.source_named("../config/routes"))
      assert_null(ScoreLibrary.source_named("syntax/../../.env"))
      assert_null(ScoreLibrary.source_named("/etc/passwd"))
    end

    test("refuses unknown, malformed, blank and oversized names") do
      assert_null(ScoreLibrary.source_named("syntax/unknown"))
      assert_null(ScoreLibrary.source_named("piano/nocturne"))
      assert_null(ScoreLibrary.source_named("piano"))
      assert_null(ScoreLibrary.source_named("piano/waltz/x"))
      assert_null(ScoreLibrary.source_named("Piano/Valse"))
      assert_null(ScoreLibrary.source_named(""))
      assert_null(ScoreLibrary.source_named(nil))
      assert_null(ScoreLibrary.source_named("piano/" + "a" * 80))
    end
  end

  describe("snippets") do
    test("holds every file of scores/syntax by name, all engravable") do
      snippets = ScoreLibrary.snippets
      assert_hash_has_key(snippets, "notes")
      assert_hash_has_key(snippets, "voices")
      assert_gt(snippets.keys.length, 25)
      snippets.keys.each do |name|
        assert_null(eui_score_layout(snippets[name], 100, {})["error"], name)
      end
    end
  end

  describe("refusals") do
    test("are all refused by the engraver, each with a position") do
      ScoreLibrary.refusals.each do |refusal|
        message = eui_score_layout(refusal["src"], 100, {})["error"]
        assert_not_null(message, refusal["what"])
        assert_contains(message, "(at character ")
      end
    end

    test("grace notes after a note are listed while the engraver refuses them, not once it reads them") do
      after_grace = ScoreLibrary.known_refusals.find do |refusal|
        refusal["what"] == "Grace notes after a note"
      end
      assert_not_null(after_grace)
      listed = ScoreLibrary.refusals.map(&:src).includes?(after_grace["src"])
      reads = eui_score_layout(after_grace["src"], 100, {})["error"].nil?
      assert_eq(listed, !reads)
      assert_eq(ScoreLibrary.refused?(after_grace["src"]), !reads)
      # A source it sets is never listed; one it refuses always is.
      assert_not(ScoreLibrary.refused?("{ c''4 }"))
      assert(ScoreLibrary.refused?("{ c''4 \\shiver d''4 }"))
      assert(ScoreLibrary.refusals.length <= ScoreLibrary.known_refusals.length)
      assert(ScoreLibrary.refusals.map(&:what).includes?("An unknown command"))
    end

    test("no longer list what the engraver reads since Soli 2.28.5") do
      # Layout settings are passed over, a forced accidental is drawn.
      listed = ScoreLibrary.refusals.map(&:src)
      ["{ \\stemUp c''4 \\override NoteHead.color = #red d''4 }", "{ cis''!4 }"].each do |src|
        assert_null(eui_score_layout(src, 100, {})["error"], src)
        assert_not(listed.includes?(src), src)
      end
    end
  end
end
