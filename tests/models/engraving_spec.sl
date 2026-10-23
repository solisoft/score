# The server's engravings, kept a few days: the same score at the same size
# is engraved once, then read back.

# An engraving kept `age` seconds ago, under a key of its own.
def engraving_made(age)
  Engraving.upsert(
    Crypto.sha256(uuid_v4),
    {
      "svg": "<svg/>",
      "error": nil,
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
