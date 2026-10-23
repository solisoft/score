# A score as it stood at one moment: kept every SCORE_VERSION_EVERY seconds
# of work ("auto"), when asked for ("manual"), before a restore ("restore"),
# and when a save was refused because the score had changed elsewhere
# ("conflict" — the refused text, so nothing typed is ever lost). A score
# keeps its latest SCORE_VERSIONS_KEPT. Each says who saved it (author_id,
# a user's key); one kept before authors were recorded says nobody.
const SCORE_VERSION_EVERY = 600
const SCORE_VERSIONS_KEPT = 200

class ScoreVersion < Model
  validates("score_id", {"presence": true})
  validates("source", {"presence": true})
  validates("reason", {"inclusion": [
    "auto",
    "manual",
    "restore",
    "conflict"
  ]})

  # `source` kept as a version of `score`, written by the user whose key is
  # `author_id` (nil when nobody is known). The score as it stands is its
  # last saver's (Score#saved_by); a refused save's text, the one who typed it.
  static def keep(score, source, reason, author_id = nil)
    version = ScoreVersion.create({
      "score_id": score._key,
      "user_id": score.user_id,
      "author_id": author_id,
      "source": source,
      "title": Score.title_in(source) ?? score.title,
      "revision": score.revision,
      "reason": reason,
      "created_at": DateTime.utc.to_unix
    })
    ScoreVersion.prune(score)
    version
  end

  # The score as it stands, kept if its latest version is older than
  # SCORE_VERSION_EVERY seconds (or it has none): called before each save.
  # It is the work of whoever saved it last.
  static def keep_if_due(score)
    latest = ScoreVersion.of(score).select("created_at").order("created_at", "desc").first
    return nil unless latest.nil? || DateTime.utc.to_unix - latest.created_at >= SCORE_VERSION_EVERY

    ScoreVersion.keep(score, score.source, "auto", score.saved_by)
  end

  # `score`'s versions, the latest first, as the History page lists them:
  # without their sources (`find` one for its source).
  static def history(score)
    listed = ScoreVersion.of(score).select("title", "reason", "revision", "created_at", "author_id")
    listed.order("created_at", "desc").limit(SCORE_VERSIONS_KEPT).all
  end

  # Who saved each of `versions`: their user's key to the name the History
  # shows, read in one query however many versions there are.
  static def authors_of(versions)
    User.names_of(versions.map(&:author_id))
  end

  # Past SCORE_VERSIONS_KEPT, the oldest versions go: found by the time of
  # the last one kept, read alone, then removed in one statement.
  static def prune(score)
    last_kept = ScoreVersion.of(score).select("created_at").order("created_at", "desc")
    last_kept = last_kept.offset(SCORE_VERSIONS_KEPT - 1).limit(1).all
    return nil if last_kept.length == 0

    ScoreVersion.where(
      "doc.score_id == @score AND doc.created_at < @oldest",
      {"score": score._key, "oldest": last_kept[0].created_at}
    ).delete_all
  end

  static def of(score)
    ScoreVersion.where("doc.score_id == @score", {"score": score._key})
  end

  static def delete_all_for(score)
    ScoreVersion.where("doc.score_id == @score", {"score": score._key}).delete_all
  end

  static def delete_all_of(user)
    ScoreVersion.where("doc.user_id == @user", {"user": user._key}).delete_all
  end
end
