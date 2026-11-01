# The server's engravings, kept a few days: the same score at the same size
# is engraved once, then read back.

# An engraving kept `age` seconds ago, under a key of its own, weighing `bytes`.
def engraving_made(age, bytes = 6)
  Engraving.upsert(
    Crypto.sha256(uuid_v4),
    {
      "svg": "<svg/>",
      "error": nil,
      "bytes": bytes,
      "created_at": DateTime.utc.to_unix - age
    }
  )
end

describe("Engraving") do
  describe("ScoreSvg.engrave") do
    test("keeps what it engraved, and reads it back the next time instead of engraving again") do
      src = "\\header { title = \"Kept #{uuid_v4}\" }\n{ c'4 d' e' f' }"
      digest = ScoreSvg.digest(src, 600, 7, 0, {})
      assert_null(Engraving.find_by("_key", digest))
      first = ScoreSvg.engrave(src, 600, 7, 0, {})
      kept = Engraving.find(digest)
      assert_eq(kept.svg, first["svg"])
      # Changed under its key: what comes back is what was kept, not a new engraving.
      kept.svg = "<svg>from the store</svg>"
      kept.save
      assert_eq(ScoreSvg.engrave(src, 600, 7, 0, {})["svg"], "<svg>from the store</svg>")
      assert_eq(Engraving.where({"_key": digest}).count, 1)
    end

    test("keeps each width, size, cut and lit item apart") do
      src = "{ c'4 d' e' f' }"
      digests = [
        ScoreSvg.digest(src, 600, 7, 0, {}),
        ScoreSvg.digest(src, 601, 7, 0, {}),
        ScoreSvg.digest(src, 600, 8, 0, {}),
        ScoreSvg.digest(src, 600, 7, 230, {}),
        ScoreSvg.digest(src, 600, 7, 0, {"0": "#c00"}),
        ScoreSvg.digest(src + " ", 600, 7, 0, {})
      ]
      assert_eq(digests.uniq.length, 6)
      assert_eq(ScoreSvg.digest(src, 600, 7, 0, {}), digests[0])
    end

    test("keeps a refusal too, and answers it the same") do
      src = "\\header { title = \"#{uuid_v4}\" }\n{ c'4 d' } d'4"
      refused = ScoreSvg.engrave(src, 600, 7, 0, {})
      assert_null(refused["svg"])
      assert_contains(refused["error"], "score:")
      again = ScoreSvg.engrave(src, 600, 7, 0, {})
      assert_eq(again["error"], refused["error"])
      assert_null(again["svg"])
      assert_not_null(Engraving.find_by("_key", ScoreSvg.digest(src, 600, 7, 0, {})))
    end

    test("does not read back an engraving past its days: it engraves anew") do
      src = "\\header { title = \"Stale #{uuid_v4}\" }\n{ g'1 }"
      Engraving.upsert(
        ScoreSvg.digest(src, 600, 7, 0, {}),
        {
          "svg": "<svg>stale</svg>",
          "error": nil,
          "created_at": DateTime.utc.to_unix - ENGRAVING_DAYS * 86400 - 10
        }
      )
      fresh = ScoreSvg.engrave(src, 600, 7, 0, {})
      assert_ne(fresh["svg"], "<svg>stale</svg>")
      # Kept again, fresh, in place of the stale one.
      renewed = Engraving.find(ScoreSvg.digest(src, 600, 7, 0, {}))
      assert_eq(renewed.svg, fresh["svg"])
      assert_gt(renewed.created_at, Engraving.cutoff)
      assert(fresh["svg"].starts_with?("<svg xmlns="))
    end
  end

  describe("what is kept, and how much") do
    test("keeps an engraving with its weight; one past ENGRAVED_FILE_KEPT is not kept") do
      light = Crypto.sha256(uuid_v4)
      Engraving.remember(
        light,
        {"file": "%PDF small", "error": nil}
      )
      assert_eq(Engraving.find(light).bytes, 10)
      heavy = Crypto.sha256(uuid_v4)
      Engraving.remember(
        heavy,
        {"file": "x" * (ENGRAVED_FILE_KEPT + 1), "error": nil}
      )
      assert_null(Engraving.find_by("_key", heavy))
      edge = Crypto.sha256(uuid_v4)
      Engraving.remember(
        edge,
        {"file": "x" * ENGRAVED_FILE_KEPT, "error": nil}
      )
      assert_not_null(Engraving.find_by("_key", edge), "the bound itself is kept")
      drawing = Crypto.sha256(uuid_v4)
      Engraving.remember(
        drawing,
        {"svg": "x" * (ENGRAVED_FILE_KEPT * 2), "error": nil}
      )
      assert_not_null(Engraving.find_by("_key", drawing), "a drawing may weigh more")
      huge = Crypto.sha256(uuid_v4)
      Engraving.remember(
        huge,
        {"svg": "x" * (ENGRAVED_SVG_KEPT + 1), "error": nil}
      )
      assert_null(Engraving.find_by("_key", huge))
    end

    test("past so many kept, the oldest go as a new one comes in") do
      kept = Engraving.count + 2
      oldest = engraving_made(5000)
      newer = (0 .. 2).map do |i|
        engraving_made(100 + i)
      end
      Engraving.bound(6, kept, ENGRAVINGS_BYTES_KEPT)
      assert_null(Engraving.find_by("_key", oldest._key))
      newer.each do |made|
        assert_not_null(Engraving.find_by("_key", made._key))
      end
      assert_eq(Engraving.count, kept)
    end

    test("past the weight they may have together, a heavy one coming in lets the oldest go") do
      Engraving.where("doc.created_at > 0", {}).delete_all
      old = engraving_made(3000, 400)
      middle = engraving_made(2000, 400)
      recent = engraving_made(1000, 400)
      newest = engraving_made(0, ENGRAVING_HEAVY + 1)
      Engraving.bound(6, 1000, ENGRAVING_HEAVY + 900)
      assert_not_null(Engraving.find_by("_key", old._key), "a light one in does not weigh them")
      Engraving.bound(ENGRAVING_HEAVY + 1, 1000, ENGRAVING_HEAVY + 900)
      assert_null(Engraving.find_by("_key", old._key), "the oldest, past the budget")
      assert_not_null(Engraving.find_by("_key", middle._key))
      assert_not_null(Engraving.find_by("_key", recent._key))
      Engraving.bound(ENGRAVING_HEAVY + 1, 1000, ENGRAVING_HEAVY + 100)
      assert_null(Engraving.find_by("_key", middle._key))
      assert_null(Engraving.find_by("_key", recent._key))
      assert_not_null(Engraving.find_by("_key", newest._key), "the newest stays")
    end

    test("within the weight, nothing goes") do
      Engraving.where("doc.created_at > 0", {}).delete_all
      made = engraving_made(10, 500)
      Engraving.keep_within(1000)
      assert_not_null(Engraving.find_by("_key", made._key))
    end
  end

  describe("expire") do
    test("lets go of what is past its days, and keeps the rest") do
      old = engraving_made(ENGRAVING_DAYS * 86400 + 60)
      recent = engraving_made(60)
      assert_gt(Engraving.expire, 0)
      assert_null(Engraving.find_by("_key", old._key))
      assert_not_null(Engraving.find_by("_key", recent._key))
    end

    test("keeps no more than the newest it is given") do
      kept = Engraving.count + 3
      newest = (0 .. 3).map do |i|
        engraving_made(i)
      end
      oldest = (0 .. 3).map do |i|
        engraving_made(1000 + i * 10)
      end
      Engraving.expire(kept)
      newest.each do |made|
        assert_not_null(Engraving.find_by("_key", made._key))
      end
      oldest.each do |made|
        assert_null(Engraving.find_by("_key", made._key))
      end
    end
  end
end
