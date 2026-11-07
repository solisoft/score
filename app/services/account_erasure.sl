# "Delete my account" (#686): the account gone, and everything it left in
# the app — what it owns and what it wrote on other people's things — so
# that nothing of the person is kept that they did not have to leave.
#
# What goes, collection by collection:
# - scores: theirs, trash included, each with all that hangs off it
#   (Score#erase: versions, shares, AI suggestions, threads and messages,
#   takes and their sound, notifications), read ERASE_BATCH at a time
#   until none is left;
# - score_shares: those they made, and those made to their address;
# - score_versions: those of their scores; on someone else's score, a
#   version they saved stays — it is that score's history — but says
#   nobody saved it (`author_id` cleared), as one kept before authors were;
# - scores of other people: `saved_by` cleared where it names them;
# - score_takes (and their WAV in score_take_audio): those they recorded
#   on someone else's score too;
# - score_comments: every message they wrote. A thread in which only they
#   wrote goes with them; one where others answered stays, without their
#   messages, so the others' words keep their place. Its `user_id` (who
#   started it) is left as it is: a key that now names nobody, which the
#   thread needs (a validation) and shows as no one. `resolved_by` naming
#   them is cleared.
# - user_notifications: those told to them; those told to others of what
#   they did — gone when they were the only one who did it, which is the
#   case of a reply or a mention quoting their message; when others
#   changed the score too, the notification stays, without them.
# - the shared library: the sections they published, with what was said
#   of them (SharedSection#remove: ratings, comments, reports, everyone's);
#   their ratings and comments on others' sections, the counters of those
#   sections counted again, and the reports on their comments; the reports
#   they filed;
# - score_readings (photos) and score_suggestions (requests to the AI);
# - push_subscriptions, access_tokens (their refresh tokens are in the same
#   rows), oauth_codes, two_step_guards;
# - rate_counts: their counts, by the names they are kept under;
# - _jobs: the jobs queued for their address or their key that have not
#   started (a running one finds no account and sends nothing);
# - users: their row, last.
#
# What is kept, and why:
# - admin_actions: what an admin did to their account or their content.
#   An audit trail kept for the site's legitimate interest (who changed
#   what), as the record of a decision; it holds their key and, in a
#   report's details, maybe a title — no message, no score.
# - stripe_events: the payments' log (event id, kind, their key). Billing
#   records are kept for the accounts, as the law asks. Stripe is not
#   asked to delete its customer: the customer, its address and invoices
#   stay at Stripe, under its own retention; a subscription is cancelled
#   first (Billing.cancel_on_leaving).
# - engravings: drawings kept a few days under a digest of their source,
#   no owner; they go with the nightly cleanup (ENGRAVING_DAYS).
# - oauth_clients: applications that registered themselves, nobody's; one
#   that never got a token goes with the nightly cleanup.
#
# Resumable: the account is marked (`erasing_at`) first and its row goes
# last, and every step deletes by a query, so running it again — the
# person asking again, or the nightly DataCleanupJob (`resume_all`) —
# finishes what an interruption left. Between the deletion of their
# library comments (or ratings) on a section and its count again, an
# interruption leaves that one section's counters a little off, until the
# next rating or comment on it counts them again.
const ERASE_BATCH = 500
# An account marked longer ago than this is one whose erasure stopped: the
# nightly cleanup finishes it. (Not sooner: it may be running still.)
const ERASE_RESUME_AFTER_SECONDS = 3600

class AccountErasure
  # `user`'s account erased, everything it left with it. `batch`: how
  # many rows are read at a time.
  static def erase(user, batch = ERASE_BATCH)
    AccountErasure.mark(user)
    Billing.cancel_on_leaving(user)
    AccountErasure.their_scores(user, batch)
    AccountErasure.their_takes(user, batch)
    AccountErasure.their_messages(user, batch)
    AccountErasure.their_notifications(user, batch)
    AccountErasure.their_library(user, batch)
    AccountErasure.their_requests(user)
    AccountErasure.their_access(user)
    AccountErasure.their_counts(user)
    AccountErasure.their_jobs(user)
    user.delete
  end

  # The accounts whose erasure stopped half-way, finished. One that fails
  # again is logged and tried the next night; the others go on. Answers
  # how many were finished.
  static def resume_all(now = DateTime.utc.to_unix)
    stopped = User.where(
      "doc.erasing_at != null AND doc.erasing_at < @before",
      {"before": now - ERASE_RESUME_AFTER_SECONDS}
    ).limit(100).all
    finished = 0
    stopped.each do |user|
      try
        AccountErasure.erase(user)
        finished = finished + 1
      catch error
        Logger.warn("erasure: #{user._key}'s account not finished: #{error}")
      end
    end
    finished
  end

  # The account marked as going: written alone, so that nothing else of an
  # older copy of the row is written back.
  static def mark(user)
    return nil unless user.erasing_at.nil?

    user.erasing_at = DateTime.utc.to_unix
    User.where({"_key": user._key}).update_all({"erasing_at": user.erasing_at})
  end

  # Their scores and what was shared with them; their name taken off the
  # versions and scores of others they saved.
  static def their_scores(user, batch)
    key = user._key
    Score.delete_all_of(user, batch)
    @sdbql{
      FOR version IN score_versions
      FILTER version.author_id == #{key}
      UPDATE version WITH { author_id: null } IN score_versions
    }
    @sdbql{
      FOR score IN scores
      FILTER score.saved_by == #{key}
      UPDATE score WITH { saved_by: null } IN scores
    }
  end

  # The takes they recorded on others' scores, their sound with them.
  static def their_takes(user, batch)
    while true
      takes = ScoreTake.where({"user_id": user._key}).limit(batch).all
      break if takes.length == 0

      takes.each do |take|
        take.remove
      end
    end
  end

  # Their messages in the threads of others' scores: a thread only they
  # wrote in goes whole; in another, their messages alone.
  static def their_messages(user, batch)
    key = user._key
    while true
      mine = ScoreComment.where({"user_id": key}).limit(batch).all
      break if mine.length == 0

      mine.map(&:thread_id).uniq.each do |thread_id|
        others = ScoreComment.where(
          "doc.thread_id == @thread AND doc.user_id != @user",
          {"thread": thread_id, "user": key}
        )
        if others.count == 0
          ScoreComment.where({"thread_id": thread_id}).delete_all
          ScoreThread.where({"_key": thread_id}).delete_all
        else
          ScoreComment.where({"thread_id": thread_id, "user_id": key}).delete_all
        end
      end
    end
    # A thread they started whose messages are all gone (none should be).
    ScoreThread.where({"user_id": key}).all.each do |thread|
      thread.delete if ScoreComment.where({"thread_id": thread._key}).count == 0
    end
    @sdbql{
      FOR thread IN score_threads
      FILTER thread.resolved_by == #{key}
      UPDATE thread WITH { resolved_by: null } IN score_threads
    }
  end

  # The notifications told to them, and those told to others of what they
  # alone did; where others did it too, they are taken out of it.
  static def their_notifications(user, batch)
    key = user._key
    UserNotification.delete_all_of(user)
    seen = {}
    while true
      told = UserNotification.where("@user IN doc.actor_ids", {"user": key}).limit(batch).all
      break if told.length == 0

      told.each do |notification|
        throw "Notification #{notification._key} could not be changed" if seen[notification._key]

        seen[notification._key] = true
        AccountErasure.without_actor(notification, key)
      end
    end
  end

  # `notification` without the actor `key`: deleted when they were its only one.
  static def without_actor(notification, key)
    ids = notification.actor_ids ?? []
    names = notification.actor_names ?? []
    kept = (0 .. ids.length).filter do |i|
      ids[i] != key
    end
    return notification.delete if kept.length == 0

    notification.actor_ids = kept.map do |i|
      ids[i]
    end
    notification.actor_names = kept.map do |i|
      names[i]
    end
    notification.save
  end

  # Their sections, ratings, comments and reports in the shared library.
  static def their_library(user, batch)
    key = user._key
    while true
      sections = SharedSection.where({"user_id": key}).limit(batch).all
      break if sections.length == 0

      sections.each do |section|
        section.remove
      end
    end
    while true
      comments = SectionComment.where({"user_id": key}).limit(batch).all
      ratings = SectionRating.where({"user_id": key}).limit(batch).all
      break if comments.length == 0 && ratings.length == 0

      (comments.map(&:section_id) + ratings.map(&:section_id)).uniq.each do |section_id|
        AccountErasure.off_section(section_id, key)
      end
    end
    SectionReport.where({"user_id": key}).delete_all
  end

  # Their comments (and the reports on them) and their rating taken off the
  # section `section_id`, its counters counted again.
  static def off_section(section_id, key)
    comment_keys = SectionComment.where({
      "section_id": section_id,
      "user_id": key
    }).all.map(&:_key)
    if comment_keys.length > 0
      about = "doc.target == 'comment' AND doc.target_id IN @comments"
      SectionReport.where(about, {"comments": comment_keys}).delete_all
    end
    SectionComment.where({"section_id": section_id, "user_id": key}).delete_all
    SectionRating.where({"section_id": section_id, "user_id": key}).delete_all
    section = SharedSection.find_by("_key", section_id)
    section.recount unless section.nil?
  end

  # Their photo readings and the requests they made of the AI.
  static def their_requests(user)
    ScoreReading.delete_all_of(user)
    ScoreSuggestion.delete_all_of(user)
  end

  # Their devices, tokens, codes and second step.
  static def their_access(user)
    PushSubscription.delete_all_of(user)
    AccessToken.delete_all_of(user)
    OauthCode.where({"user_id": user._key}).delete_all
    TwoStepGuard.delete_of(user)
  end

  # The counts kept of what they asked (RateCount), under the names they
  # are counted by (ScoreSvg.sender, ScoreReading.held?).
  static def their_counts(user)
    names = ENGRAVINGS_PER_MINUTE.keys().map do |kind|
      "engrave-#{kind}:user:#{user._key}"
    end
    names.push("reading-photo:#{user._key}")
    digests = names.map do |name|
      Crypto.sha256(name)
    end
    RateCount.where("doc._key IN @keys", {"keys": digests}).delete_all
  end

  # The jobs queued for their address or their key that have not started:
  # an e-mail to them, a test of their devices. Answers how many went.
  static def their_jobs(user)
    email = user.email.to_s
    key = user._key
    removed = @sdbql{
      FOR job IN _jobs
      FILTER job.state != "running"
      AND ((#{email} != "" AND job.args.email == #{email}) OR job.args.user_id == #{key})
      REMOVE job IN _jobs
      RETURN OLD._key
    }
    if type(removed) == "string"
      Logger.warn("erasure: #{key}'s queued jobs not cancelled: #{removed}")
      return 0
    end

    removed.length
  end
end
