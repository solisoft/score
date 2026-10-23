# Readiness (/health/ready): the database answers, and no job waits far
# past its time.

# Jobs other specs queued wait here unclaimed (`soli test` runs no worker):
# each test starts, and leaves, with an empty queue.
def readiness_empty_queue
  Job.list().each do |job|
    Job.cancel(job["_key"]) rescue nil
  end
end

describe("Readiness") do
  before_each() do
    readiness_empty_queue()
  end

  after_each() do
    readiness_empty_queue()
  end

  test("is ready with no problem, and not with any") do
    assert_eq(
      Readiness.verdict([]),
      {"ready": true, "problems": []}
    )
    refused = Readiness.verdict(["database unreachable"])
    assert_not(refused["ready"])
    assert_eq(refused["problems"], ["database unreachable"])
  end

  test("here, with a database that answers and no late job, it is ready") do
    assert_null(Readiness.database_problem)
    assert_eq(
      Readiness.check,
      {"ready": true, "problems": []}
    )
  end

  test("a job due a moment ago is not late; one left far past its time is") do
    now = DateTime.utc.to_unix
    Job.enqueue_in("DataCleanupJob", "1 minute", {})
    assert_null(Readiness.jobs_problem(now))
    assert_null(Readiness.jobs_problem(now + 60 + READINESS_JOB_LATE_SECONDS - 5))
    problem = Readiness.jobs_problem(now + 60 + READINESS_JOB_LATE_SECONDS + 5)
    assert_eq(problem, "1 job(s) waiting past their time: no worker claims them")
  end

  test("a job left far past its time makes the whole check fail") do
    Job.enqueue_at("DataCleanupJob", "2020-01-01T00:00:00Z", {})
    report = Readiness.check
    assert_not(report["ready"])
    assert_eq(report["problems"], ["1 job(s) waiting past their time: no worker claims them"])
  end
end
