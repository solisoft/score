# What an account's second step has seen (#538): the wrong codes typed at
# it, and the codes spent. One row per account (`user_id`, unique), written
# only as a compare-and-set: `optimistic_lock`, whose SoliDB write puts the
# row with If-Match on the revision read, so that two requests at once
# cannot both win from the same read. A FOR…FILTER…UPDATE would not do:
# SoliDB checks its filter on the document it scanned and then writes
# without checking again (see #541, AccessToken.rotate).
#
# Wrong codes: `wrong` of them, the last at `wrong_at`; TWO_STEP_MAX_WRONG
# within TWO_STEP_LOCK_SECONDS of each other pause the code step for
# TWO_STEP_LOCK_SECONDS from `locked_at` (0, not nil, when none: the
# compare-and-set write merges into the row, and a nil in it is dropped,
# the old value kept). The codes alone are paused: the
# password step still leads to the code page, which refuses every code,
# the right one included, until the pause runs out; the sessions and
# remembered browsers the account has are left as they are. Whoever types
# codes there has the password already, so neither a password reset nor a
# right password clears the count: only a right code, or the time.
#
# Codes spent: `last_step`, the time step of the last code of the app
# used (a code is good once, and none older than it), and `spent`, the
# digests of the backup codes used. The account (User#totp_last_step,
# User#totp_backup) keeps a copy for what it shows; this row decides.
# (TWO_STEP_MAX_WRONG and TWO_STEP_LOCK_SECONDS are in user.sl, with the
# sign-in's other limits.)
# How often a write is tried again when another one landed since its read.
const TWO_STEP_WRITE_ATTEMPTS = 5

class TwoStepGuard < Model
  optimistic_lock
  validates("user_id", {"presence": true})

  # The row of `user`, read now: made when it has none yet (two requests
  # making it at once: the unique index keeps one, the other reads it).
  static def of(user)
    row = TwoStepGuard.find_by("user_id", user._key)
    return row unless row.nil?

    made = TwoStepGuard.create({
      "user_id": user._key,
      "wrong": 0,
      "wrong_at": 0,
      "locked_at": 0,
      "last_step": nil,
      "spent": []
    })
    return made if made._errors.nil?

    TwoStepGuard.find_by("user_id", user._key)
  end

  # Whether the code step of `user` is paused now.
  static def locked?(user)
    row = TwoStepGuard.find_by("user_id", user._key)
    !row.nil? && row.locked_at?(DateTime.utc.to_unix)
  end

  def locked_at?(now)
    since = @locked_at.to_s.to_i
    return false if since == 0

    now - since <= TWO_STEP_LOCK_SECONDS
  end

  # One more wrong code at `user`'s second step: whether it paused the
  # code step (the owner is then told, once a pause). Not counted while
  # paused: the pause runs out on schedule however many come.
  static def count_wrong(user)
    TwoStepGuard._written(TwoStepGuard.of(user), fn(row) {
      now = DateTime.utc.to_unix
      return nil if row.locked_at?(now)

      last = row.wrong_at.to_s.to_i
      recent = last > 0 && now - last <= TWO_STEP_LOCK_SECONDS
      count = (recent ? row.wrong.to_s.to_i : 0) + 1
      row.wrong = count
      row.wrong_at = now
      row.locked_at = count >= TWO_STEP_MAX_WRONG ? now : 0
      count >= TWO_STEP_MAX_WRONG ? "paused" : "counted"
    }) == "paused"
  end

  # A right code: the wrong ones are forgotten.
  static def clear_wrong(user)
    row = TwoStepGuard.find_by("user_id", user._key)
    return true if row.nil? || (row.wrong.to_s.to_i == 0 && row.locked_at.to_s.to_i == 0)

    TwoStepGuard._written(row, fn(current) {
      current.wrong = 0
      current.wrong_at = 0
      current.locked_at = 0
      true
    })
    true
  end

  # The code of the app of time step `step` spent, from `row` (the row as
  # read; read again when another write landed since): whether it was —
  # not when a code of this step or of a later one was spent before.
  # `floor`: the last step the account itself has as used.
  static def spend_step(row, step, floor)
    TwoStepGuard._written(row, fn(current) {
      last = [current.last_step ?? -1, floor ?? -1].max()
      return false if step <= last

      current.last_step = step
      true
    }) == true
  end

  # The backup code of digest `digest` spent, from `row`: whether it was —
  # not when it was spent before. Those of `valid` (the account's codes)
  # are the only ones kept in `spent`: an older set's are of no use.
  static def spend_backup(row, digest, valid)
    TwoStepGuard._written(row, fn(current) {
      before = current.spent ?? []
      return false if before.includes?(digest) || !valid.includes?(digest)

      kept = before.filter(&{ |d|
        valid.includes?(d)
      })
      kept.push(digest)
      current.spent = kept
      true
    }) == true
  end

  # The codes of `codes` (backup digests) not spent yet.
  def unspent(codes)
    used = @spent ?? []
    codes.filter do |d|
      !used.includes?(d)
    end
  end

  # `change` applied to `row` and saved, as a compare-and-set: when another
  # write landed since `row` was read, read again and applied again. What
  # `change` answered once saved; nil when it answered nil (nothing to
  # write) or false (refused, nothing written either), or when the write
  # never went through.
  static def _written(row, change)
    current = row
    attempts = 0
    while attempts < TWO_STEP_WRITE_ATTEMPTS && !current.nil?
      attempts = attempts + 1
      outcome = change(current)
      return outcome if outcome.nil? || outcome == false

      saved = current.save rescue false
      return outcome if saved == true
      return nil unless current.stale?

      current = TwoStepGuard.find_by("_key", current._key)
    end
    nil
  end

  # Gone with their account (User#erase_account).
  static def delete_of(user)
    TwoStepGuard.where({"user_id": user._key}).delete_all
  end
end
