# Whether this process can serve the app (/health/ready), as opposed to
# merely running (/health): its database answers, and the job queue is not
# left behind. The deploy checks it after each slot switch, and a scheduled
# workflow every 15 minutes. Its reasons are short and name no host, user
# or error text: the page is public. The details go to the log.

# A job still waiting this long after its time means no worker claims jobs.
const READINESS_JOB_LATE_SECONDS = 1800

class Readiness
  # {"ready": Bool, "problems": [String]} for this process.
  static def check
    return Readiness.verdict(["database not configured"]) unless AppSetup.ready?

    database = Readiness.database_problem
    return Readiness.verdict([database]) unless database.nil?

    jobs = Readiness.jobs_problem(DateTime.utc.to_unix)
    Readiness.verdict(jobs.nil? ? [] : [jobs])
  end

  # The decision, apart from the checks, so a spec can take both ways.
  static def verdict(problems)
    {"ready": problems.length == 0, "problems": problems}
  end

  # nil when the database answers a one-row read, else why not.
  static def database_problem
    try
      User.limit(1).all
      return nil
    catch error
      Logger.warn("readiness: the database does not answer", {"error": str(error)})
      return "database unreachable"
    end
  end

  # nil when no job waits past its time by READINESS_JOB_LATE_SECONDS at
  # `now` (Unix seconds), else how many do.
  static def jobs_problem(now)
    late = 0
    try
      late = Readiness.late_jobs(now)
    catch error
      Logger.warn("readiness: the job queue could not be read", {"error": str(error)})
      return "job queue unreadable"
    end
    return nil if late == 0

    "#{late} job(s) waiting past their time: no worker claims them"
  end

  # How many jobs, due before `now` minus READINESS_JOB_LATE_SECONDS, wait
  # unclaimed (pending, scheduled, or failed and due for a retry).
  static def late_jobs(now)
    cutoff = DateTime.from_unix(now - READINESS_JOB_LATE_SECONDS).to_iso
    counted = @sdbql{
      FOR job IN _jobs
      FILTER job.state IN ["pending", "scheduled", "failed"] AND job.run_at < #{cutoff}
      COLLECT WITH COUNT INTO total
      RETURN total
    }
    # No job was ever queued: the collection does not exist yet.
    return 0 if type(counted) == "string" && counted.contains("Collection '_jobs' not found")

    throw "the job queue could not be read: #{counted}" if type(counted) == "string"

    counted[0] ?? 0
  end
end
