# How many times one sender asked for one thing in a window (#684): the
# engravings an account, or an address signed out, has had the server make
# (ScoreSvg.allowed?), the photos it sent to be read (ScoreReading.held?).
# Kept in the database, not in a worker's memory as Soli's RateLimiter is:
# both workers and both deploy slots count together, and a restart forgets
# nothing.
#
# One row a name, its _key a digest of the name: its window starts at the
# first ask and lasts `window` seconds; the first ask after it starts the
# next. Read and written in one statement, which SoliDB does not run
# atomically against another (#541): two asks at the same instant may be
# counted once. What that lets through is one more, never a stream.
class RateCount < Model
  # Whether `name` may ask once more: `limit` times in `window` seconds.
  # Each ask counts, a refused one too, so a sender that keeps asking is
  # held until the window it started ends. True without a database, or when
  # the count cannot be written: what is counted here is a cost, not a lock.
  static def take(name, limit, window)
    return true unless AppSetup.ready?

    taken = RateCount.count_one(name, window, DateTime.utc.to_unix) rescue nil
    return true if taken.nil?

    taken <= limit
  end

  # One more ask of `name` at `now`: how many its window has had, this one
  # included; nil when the count could not be written.
  static def count_one(name, window, now)
    key = Crypto.sha256(name.to_s)
    ends = now + window
    since = now - window
    counted = @sdbql{
      LET old = FIRST(FOR r IN rate_counts FILTER r._key == #{key} RETURN r)
      LET fresh = old == null || old.started_at <= #{since}
      UPSERT { _key: #{key} }
      INSERT { _key: #{key}, started_at: #{now}, expires_at: #{ends}, count: 1 }
      UPDATE (fresh ? { started_at: #{now}, expires_at: #{ends}, count: 1 } : { count: old.count + 1 })
      IN rate_counts
      RETURN NEW.count
    }
    return nil if type(counted) == "string" || counted.length == 0

    counted[0].to_s.to_i
  end

  # The nightly cleanup: the rows whose window has ended. Answers how many went.
  static def expire
    ended = RateCount.where("doc.expires_at < @now", {"now": DateTime.utc.to_unix})
    count = ended.count
    ended.delete_all
    count
  end
end
