# An engraving the server made (ScoreSvg.engrave), kept ENGRAVING_DAYS days
# under a digest of all that made it — the source, the width, the staff
# size, the cut, the lit items — so the editor's first picture, a library
# card's preview or an AI answer polled again is read, not engraved again.
# The nightly DataCleanupJob lets the old ones go; at most ENGRAVINGS_KEPT
# are kept, weighing at most ENGRAVINGS_BYTES_KEPT, the oldest let go as new
# ones come in (Engraving.bound).
#
# Not the built-in `Cache`: it lives in SoliKV, which this server does not
# run; SoliDB, which it does, holds these as well.
const ENGRAVING_DAYS = 3
const ENGRAVINGS_KEPT = 2000
# The biggest file (a PDF, a MIDI file) kept, in characters: a bigger one is
# made again each time rather than weigh on the database. The symphony's
# PDF, the gallery's biggest, is half of it.
const ENGRAVED_FILE_KEPT = 1000000
# The biggest drawing kept: one at the bound (SCORE_MOST_WRITTEN_OUT) is
# some 4 MB, and drawing it again costs seconds.
const ENGRAVED_SVG_KEPT = 4500000
# What all kept engravings may weigh together, in characters. Weighed when
# a heavy one (past ENGRAVING_HEAVY) comes in — the light ones are held by
# their number alone, so most are kept without reading the others.
const ENGRAVINGS_BYTES_KEPT = 200000000
const ENGRAVING_HEAVY = 100000
# Part of every engraving's key (ScoreSvg.digest): one more, and every kept
# engraving is drawn anew — for a change of drawing or of engraver (2: Soli
# 2.28.4, the browser's engraver on the server; 3: data-breaks for printing;
# 4: Soli 2.28.5, the engine with movements, mid-bar changes and gathered
# rests; 7: Soli 2.28.9, cross-staff notation, \paper and line breaking, overrides,
# empty staves hidden, \partCombine; 8: eui 354d650, scaled staves, mid-bar \time,
# polymetre, vertical springs and beam quanting).
const ENGRAVING_FORMAT = 8

class Engraving < Model
  # The engraving kept under `digest`, as `ScoreSvg.engrave` answers it
  # ({"svg", "error"}) — or a file it made (ScoreSvg.pdf, ScoreSvg.midi:
  # {"file", "error"}) — or nil: never kept, past its time, or no database.
  static def recall(digest)
    return nil unless AppSetup.ready?

    kept = Engraving.find_by("_key", digest) rescue nil
    return nil if kept.nil? || kept.created_at < Engraving.cutoff

    {
      "svg": kept.svg,
      "file": kept.file,
      "error": kept.error
    }
  end

  # `engraved` kept under `digest` (its _key), with its weight, unless its
  # file weighs more than ENGRAVED_FILE_KEPT or its drawing more than
  # ENGRAVED_SVG_KEPT. Two requests engraving the same score at once both
  # write it, the same.
  static def remember(digest, engraved)
    return nil unless AppSetup.ready?
    if engraved["file"].to_s.length > ENGRAVED_FILE_KEPT || engraved["svg"].to_s.length > ENGRAVED_SVG_KEPT
      return nil
    end

    bytes = engraved["svg"].to_s.length + engraved["file"].to_s.length

    Engraving.upsert(
      digest,
      {
        "svg": engraved["svg"],
        "file": engraved["file"],
        "error": engraved["error"],
        "bytes": bytes,
        "created_at": DateTime.utc.to_unix
      }
    ) rescue nil
    Engraving.bound(bytes) rescue nil
  end

  # After one of `bytes` was kept: no more than `kept` kept, and, when it
  # was a heavy one, no more than `budget` characters in all.
  static def bound(bytes, kept = ENGRAVINGS_KEPT, budget = ENGRAVINGS_BYTES_KEPT)
    Engraving.keep_newest(kept) if Engraving.count > kept
    Engraving.keep_within(budget) if bytes > ENGRAVING_HEAVY
  end

  # The nightly cleanup: what is past ENGRAVING_DAYS, and past the newest
  # `kept` (ENGRAVINGS_KEPT). Answers how many went.
  static def expire(kept = ENGRAVINGS_KEPT)
    before = Engraving.count
    Engraving.where("doc.created_at < @before", {"before": Engraving.cutoff}).delete_all
    Engraving.keep_newest(kept)
    before - Engraving.count
  end

  # The `kept` newest kept, the others let go — those made in the same
  # second as the last of them stay too.
  static def keep_newest(kept)
    last_kept = Engraving.select("created_at").order("created_at", "desc").offset(kept - 1).limit(1).all
    return nil if last_kept.length == 0

    oldest = last_kept[0].created_at
    Engraving.where("doc.created_at < @oldest", {"oldest": oldest}).delete_all
  end

  # The newest kept as long as they weigh no more than `budget` together;
  # from the second the budget runs out, the older ones let go.
  static def keep_within(budget)
    weights = @sdbql{
      FOR e IN engravings
      SORT e.created_at DESC
      RETURN {"at": e.created_at, "bytes": e.bytes}
    }
    total = 0
    i = 0
    while i < weights.length
      total += weights[i]["bytes"].to_s.to_i
      break if total > budget

      i += 1
    end
    return nil if i >= weights.length

    Engraving.where("doc.created_at <= @last", {"last": weights[i]["at"]}).delete_all
  end

  static def cutoff
    DateTime.utc.to_unix - ENGRAVING_DAYS * 86400
  end
end
