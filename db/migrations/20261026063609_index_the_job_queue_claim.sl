# Migration: index_the_job_queue_claim — the job queue's claim query
# (#414). Soli's workers ask `_jobs` every second for due work:
#   FOR doc IN _jobs FILTER doc.state IN [pending, scheduled, failed]
#   AND doc.run_at <= now SORT doc.priority DESC, doc.run_at ASC LIMIT n
# On SoliDB the framework indexes state, run_at and priority one by one,
# as hash indexes, which serve neither the run_at range nor the sort (on
# SQL it builds a composite index itself). This persistent (sorted) index
# follows the query's own shape, so a claim stays quick as done jobs pile up (kept 7
# days, SOLI_JOBS_RETENTION_SECS) and slow-query alerts stop.

def up(db)
  # A database the app never served yet has no queue: make it, as Soli would.
  # (list_collections leaves out names that start with "_": try, and a
  # queue already there answers 409.)
  db.create_collection("_jobs") rescue nil
  db.create_index("_jobs", "idx_jobs_claim", [
    "state",
    "run_at",
    "priority"
  ], {"type": "persistent"})
end

def down(db)
  db.drop_index("_jobs", "idx_jobs_claim")
end
