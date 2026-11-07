# Reads one ScoreReading's picture with Claude, off the request: a reading
# takes longer than a request may.
class ScoreReadingJob
  static def perform(args: Hash)
    reading = ScoreReading.find_by("_key", args["reading_id"].to_s)
    # Gone with its account before its turn came (#686): nothing to read.
    return true if reading.nil?

    reading.perform
  end
end
