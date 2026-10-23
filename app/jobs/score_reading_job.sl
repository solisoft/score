# Reads one ScoreReading's picture with Claude, off the request: a reading
# takes longer than a request may.
class ScoreReadingJob
  static def perform(args: Hash)
    ScoreReading.find(args["reading_id"]).perform
  end
end
