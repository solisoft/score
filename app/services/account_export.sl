# "Export all my data": what a person's account holds, as the files of a
# zip (ZipArchive). Their scores, each in a folder with its LilyPond and
# every version kept of it; who each is shared with; their account, without
# its password, secrets or tokens; and the scores others share with them,
# listed only — those are their owners' to export.
#
# The zip is made in memory, so a big account comes in parts of about
# EXPORT_PART_CHARACTERS characters of LilyPond each, a score never split
# across two: one part for nearly everyone. Each part carries the account,
# the list of every score (saying which part holds it) and the shared list.
const EXPORT_PART_CHARACTERS = 4000000
# Downloads one person may ask for in EXPORT_WINDOW_SECONDS, parts included.
const EXPORTS_PER_WINDOW = 10
const EXPORT_WINDOW_SECONDS = 3600

class AccountExport
  # The parts `user`'s export comes in: each a list of their scores' keys,
  # the oldest score first, then the audio takes of their scores (#390),
  # each "take:<key>" and counted by its bytes. Always at least one part,
  # empty when they have no score. Three queries, which read the sizes and
  # not the sources.
  static def parts(user)
    owner = user._key
    scores = @sdbql{
      FOR s IN scores
      FILTER s.user_id == #{owner}
      SORT s.created_at ASC, s._key ASC
      RETURN {"key": s._key, "size": LENGTH(s.source)}
    }
    kept = @sdbql{
      FOR v IN score_versions
      FILTER v.user_id == #{owner}
      COLLECT score = v.score_id AGGREGATE total = SUM(LENGTH(v.source))
      RETURN {"key": score, "size": total}
    }
    versions = {}
    AccountExport.rows(kept).each do |row|
      versions[row["key"]] = row["size"]
    end
    sizes = AccountExport.rows(scores).map do |row|
      {
        "key": row["key"],
        "size": row["size"] + (versions[row["key"]] ?? 0)
      }
    end
    takes = @sdbql{
      FOR t IN score_takes
      FILTER t.score_id IN (FOR s IN scores FILTER s.user_id == #{owner} RETURN s._key)
      SORT t.score_id ASC, t.track ASC
      RETURN {"key": t._key, "size": t.size}
    }
    AccountExport.rows(takes).each do |row|
      sizes.push({"key": "take:#{row["key"]}", "size": row["size"] ?? 0})
    end
    AccountExport.packed(sizes, EXPORT_PART_CHARACTERS)
  end

  # A query's rows; none when its collection was never written to (a new
  # server); raises on any other error. (`is_a?`, not `type()`: the account
  # page calls this while rendering, where `type` can name a value.)
  static def rows(result)
    return result unless result.is_a?("string")
    return [] if result.contains("not found")

    throw "The export could not be planned: #{result}"
  end

  # `sizes` ([{"key", "size"}], in order) in parts of at most `limit`, a
  # bigger one alone in its part.
  static def packed(sizes, limit)
    parts = [[]]
    filled = 0
    sizes.each do |entry|
      if parts[parts.length - 1].length > 0 && filled + entry["size"] > limit
        parts.push([])
        filled = 0
      end
      parts[parts.length - 1].push(entry["key"])
      filled = filled + entry["size"]
    end
    parts
  end

  # Whether `user` may download one more part now: each asked for counts.
  static def allowed?(user)
    RateLimiter("account-export:#{user._key}", EXPORTS_PER_WINDOW, EXPORT_WINDOW_SECONDS).allowed()
  end

  # The zip of part `number` (from 1) of `parts` (AccountExport.parts), as
  # bytes.
  static def zip(user, parts, number, at)
    ZipArchive.build(AccountExport.files(user, parts, number, at), at)
  end

  # The files of part `number`: [{"name", "text"}].
  static def files(user, parts, number, at)
    keys = parts[number - 1]
    owner = user._key
    scores = AccountExport.read(fn() {
      Score.where("doc.user_id == @user", {"user": owner}).order("created_at", "asc").all
    })
    shares = AccountExport.read(fn() { ScoreShare.where({"owner_id": owner}).order("email", "asc").all })
    versions = []
    if keys.length > 0
      versions = AccountExport.read(fn() {
        ScoreVersion.where("doc.score_id IN @keys", {"keys": keys}).order("created_at", "asc").all
      })
    end
    authors = ScoreVersion.authors_of(versions)
    threads = AccountExport.threads_on(keys)
    takes = AccountExport.read(fn() {
      ScoreTake.where("doc.score_id IN @keys", {"keys": scores.map(&:_key)}).order("track", "asc").all
    })
    part_of = {}
    parts.each_with_index do |part, i|
      part.each do |key|
        part_of[key] = i + 1
      end
    end
    files = [
      {"name": "README.txt", "text": AccountExport.readme(user, number, parts.length, at)},
      {"name": "account.json", "text": JSON.stringify(AccountExport.account(user, at))}
    ]
    listed = scores.map do |score|
      entry = AccountExport.listing(score, part_of[score._key], shares)
      own_takes = takes.filter do |take|
        take.score_id == score._key
      end
      entry["takes"] = own_takes.map do |take|
        AccountExport.take_listing(take, part_of["take:#{take._key}"])
      end
      own_takes.each do |take|
        if keys.includes?("take:#{take._key}")
          files.push({"name": "#{entry["folder"]}/#{AccountExport.take_file(take)}", "bytes": take.audio_bytes})
        end
      end
      if keys.includes?(score._key)
        own_versions = versions.filter do |version|
          version.score_id == score._key
        end
        entry["versions"] = AccountExport.version_files(own_versions, authors)
        entry["comments"] = threads[score._key] ?? []
        files.push({"name": "#{entry["folder"]}/#{score.file_name}.ly", "text": score.source})
        own_versions.each_with_index do |version, i|
          files.push({"name": "#{entry["folder"]}/#{entry["versions"][i]["file"]}", "text": version.source})
        end
      end
      entry
    end
    files.push({"name": "scores.json", "text": JSON.stringify(listed)})
    files.push({"name": "shared-with-me.json", "text": JSON.stringify(AccountExport.shared_with_me(user))})
    files.push({"name": "comments.json", "text": JSON.stringify(AccountExport.comments_by(user))})
    files.push({"name": "notifications.json", "text": JSON.stringify(AccountExport.notifications_of(user))})
    files
  end

  # The comment threads on the scores whose keys are `keys` (the person's
  # own), each with all its messages, whoever wrote them: score key to
  # [{"on", "staff", "bars", "resolved", "started_at", "messages"}].
  static def threads_on(keys)
    return {} if keys.length == 0

    threads = AccountExport.read(fn() {
      ScoreThread.where("doc.score_id IN @keys", {"keys": keys}).order("created_at", "asc").all
    })
    messages = AccountExport.read(fn() {
      ScoreComment.where("doc.score_id IN @keys", {"keys": keys}).order("created_at", "asc").all
    })
    names = User.names_of(messages.map(&:user_id))
    by_score = {}
    threads.each do |thread|
      said = messages.filter do |message|
        message.thread_id == thread._key
      end
      by_score[thread.score_id] = (by_score[thread.score_id] ?? [])
      + [{
        "on": thread.label,
        "staff": thread.lane + 1,
        "bars": thread.bars.map do |bar|
          bar + 1
        end,
        "resolved": thread.resolved == true,
        "started_at": AccountExport.iso(thread.created_at),
        "messages": said.map do |message|
          {
            "author": names[message.user_id] ?? "Someone",
            "text": message.body,
            "written_at": AccountExport.iso(message.created_at),
            "edited_at": AccountExport.iso(message.edited_at)
          }
        end
      }]
    end
    by_score
  end

  # Every comment the person wrote, on their scores or others': where, and
  # what. (A comment on someone else's score is theirs to export, the score
  # is not.)
  static def comments_by(user)
    owner = user._key
    written = AccountExport.read(fn() { ScoreComment.where({"user_id": owner}).order("created_at", "asc").all })
    return [] if written.length == 0

    thread_keys = written.map(&:thread_id).uniq
    score_keys = written.map(&:score_id).uniq
    threads = []
    scores = []
    grouped(fn() {
      threads = ScoreThread.where("doc._key IN @keys", {"keys": thread_keys}).select("label", "resolved").all
      scores = Score.where("doc._key IN @keys", {"keys": score_keys}).select("title", "user_id").all
    })
    labels = {}
    threads.each do |thread|
      labels[thread._key] = thread.label
    end
    titles = {}
    owners = {}
    scores.each do |score|
      titles[score._key] = score.title
      owners[score._key] = score.user_id
    end
    written.map do |comment|
      {
        "score": titles[comment.score_id] ?? "(a score now deleted)",
        "own_score": owners[comment.score_id] == owner,
        "on": labels[comment.thread_id],
        "text": comment.body,
        "written_at": AccountExport.iso(comment.created_at),
        "edited_at": AccountExport.iso(comment.edited_at)
      }
    end
  end

  # What the app told the person (the bell's list), the newest last.
  static def notifications_of(user)
    owner = user._key
    told = AccountExport.read(fn() { UserNotification.where({"user_id": owner}).order("created_at", "asc").all })
    told.map do |notice|
      {
        "kind": notice.kind,
        "score": notice.score_title,
        "by": notice.actor_names ?? [],
        "on": notice.label,
        "excerpt": notice.excerpt,
        "at": AccountExport.iso(notice.created_at),
        "read_at": AccountExport.iso(notice.read_at),
        "emailed": notice.mail
      }
    end
  end

  # The rows `query` (a function) reads: none when its collection does not
  # exist yet (nothing of that kind was ever written on this server). Any
  # other error is raised: an export must not quietly miss something.
  static def read(query)
    try
      return query()
    catch error
      throw error unless Regex.matches("Collection '[a-z_]+' not found", str(error))

      return []
    end
  end

  # The account, as the person may read it back: nothing that signs in or
  # decrypts (password digest, two-step secret and codes, tokens, the AI key).
  static def account(user, at)
    {
      "email": user.email,
      "name": user.name,
      "role": user.role,
      "email_confirmed_at": AccountExport.iso(user.confirmed_at),
      "email_change_waiting_for": user.email_change_to,
      "two_step_sign_in": user.two_step?(),
      "two_step_since": AccountExport.iso(user.totp_enabled_at),
      "own_ai": user.own_ai?() ? {
        "provider": user.ai_provider,
        "model": user.ai_model
      } : nil,
      "notification_emails": AccountExport.mail_prefs(user),
      "exported_at": AccountExport.iso(at)
    }
  end

  # Which notification e-mails the person gets, each kind to true or false.
  static def mail_prefs(user)
    prefs = {}
    NOTIFICATION_KINDS.each do |kind|
      prefs[kind] = user.mails?(kind)
    end
    prefs
  end

  # One score in scores.json: where its files are, whether it is in the
  # trash, and who it is shared with.
  static def listing(score, part, shares)
    shared = shares.filter do |share|
      share.score_id == score._key
    end
    {
      "title": score.title,
      "composer": score.composer.to_s,
      "folder": AccountExport.folder(score),
      "part": part,
      "in_trash": score.trashed?,
      "trashed_at": AccountExport.iso(score.trashed_at),
      "visibility": score.visibility ?? "private",
      "created_at": AccountExport.iso(score.created_at),
      "updated_at": AccountExport.iso(score.updated_at),
      "shared_with": shared.map do |share|
        {
          "email": share.email,
          "role": share.role,
          "since": AccountExport.iso(share.created_at)
        }
      end
    }
  end

  # One audio take in scores.json: its track, its file, the part that file
  # is in, where it starts in the score's playback and how long it lasts.
  static def take_listing(take, part)
    {
      "track": take.track,
      "name": take.name,
      "file": AccountExport.take_file(take),
      "part": part,
      "starts_at_second": take.offset,
      "seconds": take.duration,
      "recorded_at": AccountExport.iso(take.created_at)
    }
  end

  static def take_file(take)
    "takes/track-#{take.track}.wav"
  end

  # A score's folder: under trash/ when it is in the trash, its name then
  # its key, so two scores of one title never share one.
  static def folder(score)
    "#{score.trashed? ? "trash" : "scores"}/#{score.file_name}-#{score._key}"
  end

  # Each of `versions` (the oldest first) as a file of its score's
  # versions/ folder, numbered in order, with when, why and by whom.
  static def version_files(versions, authors)
    versions.each_with_index.map do |version, i|
      padded = "00#{i + 1}"
      number = padded.substring(padded.length - [3, padded.length - 2].max(), padded.length)
      moment = DateTime.from_unix(version.created_at ?? 0).to_iso.substring(0, 19).replace(":", "-")
      {
        "file": "versions/#{number}-#{moment}-#{version.reason}.ly",
        "reason": version.reason,
        "saved_at": AccountExport.iso(version.created_at),
        "saved_by": authors[version.author_id.to_s]
      }
    end
  end

  # The scores others share with `user`: named, not copied.
  static def shared_with_me(user)
    AccountExport.read(fn() { ScoreShare.shared_with(user) }).map do |row|
      {
        "title": row["score"].title,
        "composer": row["score"].composer.to_s,
        "owner": row["owner"],
        "role": row["role"],
        "address": auth_base_url() + "/app/scores/" + row["score"]._key
      }
    end
  end

  static def readme(user, number, count, at)
    part = count > 1 ? "This is part #{number} of #{count}: the scores are split so that no download is too big.\n" : ""
    "EUI Score: everything in the account #{user.email}, exported #{AccountExport.iso(at)}.\n\n" + part
    + "scores/        your scores, one folder each: the score as it is now (.ly, LilyPond),\n"
    + "               and versions/, every version kept of it, the oldest first;\n"
    + "               takes/, the audio recorded onto its tracks (WAV, one per track).\n"
    + "trash/         the scores in your trash, the same way.\n"
    + "scores.json    every score: its folder, the part it is in, whether it is in the trash,\n"
    + "               who it is shared with and with which role, its versions, and the\n"
    + "               comment threads on it, with every message, and its audio takes:\n"
    + "               where each starts in the score, and the part that holds it.\n"
    + "account.json   your account. No password, secret or token is in it.\n"
    + "shared-with-me.json  the scores others share with you, and your role: listed, not\n"
    + "               copied, since they are their owners' (each can export their own).\n"
    + "comments.json  every comment you wrote, on your scores or on others'.\n"
    + "notifications.json  what the app told you (the bell), and whether it was e-mailed.\n"
  end

  static def iso(seconds)
    return nil if seconds.nil?

    DateTime.from_unix(seconds).to_iso
  end
end
