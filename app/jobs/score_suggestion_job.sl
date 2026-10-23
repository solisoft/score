# Asks the editor's AI assistant for one ScoreSuggestion, off the request: an
# answer takes longer than a request may.
class ScoreSuggestionJob
  static def perform(args: Hash)
    ScoreSuggestion.find(args["suggestion_id"]).perform
  end
end
