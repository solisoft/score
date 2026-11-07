# Asks the editor's AI assistant for one ScoreSuggestion, off the request: an
# answer takes longer than a request may.
class ScoreSuggestionJob
  static def perform(args: Hash)
    suggestion = ScoreSuggestion.find_by("_key", args["suggestion_id"].to_s)
    # Gone with its account, or its score, before its turn came (#686).
    return true if suggestion.nil?

    suggestion.perform
  end
end
