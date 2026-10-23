# An engraving the server made (ScoreSvg.engrave), kept ENGRAVING_DAYS days
# under a digest of all that made it — the source, the width, the staff
# size, the cut, the lit items — so the editor's first picture, a library
# card's preview or an AI answer polled again is read, not engraved again.
# The nightly DataCleanupJob lets the old ones go and keeps at most
# ENGRAVINGS_KEPT.
#
# Not the built-in `Cache`: it lives in SoliKV, which this server does not
# run; SoliDB, which it does, holds these as well.
const ENGRAVING_DAYS = 3
const ENGRAVINGS_KEPT = 2000
# Part of every engraving's key (ScoreSvg.digest): one more, and every kept
# engraving is drawn anew — for a change of drawing or of engraver (2: Soli
# 2.28.4, the browser's engraver on the server; 3: data-breaks for printing).
const ENGRAVING_FORMAT = 3

class Engraving < Model
  # The engraving kept under `digest`, as `ScoreSvg.engrave` answers it
  # ({"svg", "error"}), or nil: never kept, past its time, or no database.
  static def recall(digest)
    return nil unless AppSetup.ready?

    kept = Engraving.find_by("_key", digest) rescue nil
    return nil if kept.nil? || kept.created_at < Engraving.cutoff

    {"svg": kept.svg, "error": kept.error}
  end

  # `engraved` kept under `digest` (its _key). Two requests engraving the
  # same score at once both write it, the same.
  static def remember(digest, engraved)
    return nil unless AppSetup.ready?

    Engraving.upsert(
      digest,
      {
        "svg": engraved["svg"],
        "error": engraved["error"],
        "created_at": DateTime.utc.to_unix
      }
    ) rescue nil
  end

  # The nightly cleanup: what is past ENGRAVING_DAYS, and past the newest
  # `kept` (ENGRAVINGS_KEPT) newest — those made in the same second as the
  # last of them stay too. Answers how many went.
  static def expire(kept = ENGRAVINGS_KEPT)
    before = Engraving.count
    Engraving.where("doc.created_at < @before", {"before": Engraving.cutoff}).delete_all
    last_kept = Engraving.select("created_at").order("created_at", "desc").offset(kept - 1).limit(1).all
    unless last_kept.length == 0
      oldest = last_kept[0].created_at
      Engraving.where("doc.created_at < @oldest", {"oldest": oldest}).delete_all
    end
    before - Engraving.count
  end

  static def cutoff
    DateTime.utc.to_unix - ENGRAVING_DAYS * 86400
  end
end
