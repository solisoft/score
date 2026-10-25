# The editor's AI assistant: chord symbols, a harmonization, improvements,
# or a request of one's own, for the score open in the editor, on the
# person's own AI key (the site has no AI of its own, #396). The editor
# sends its text, then asks after the suggestion until it is ready; applying
# it is the editor's, on the person's say. Behind sign-in; a suggestion is
# only its owner's.
class AppScoreSuggestionsController < AppBaseController
  # POST /app/scores/:id/suggestions — JSON {action, request, source}: 202 {id},
  # or an {error} (with the `link` that lifts it when it is the key or the plan)
  def create
    score = authorize(Score.find(params["id"]), "update")
    user = current_user()
    body = req["json"] ?? params
    action = body["action"].to_s
    request = body["request"].to_s
    source = body["source"].to_s.blank? ? score.source : body["source"].to_s
    allowed = AiClient.refusal(user)
    return @_ai_refused(allowed) unless allowed.nil?
    return render_json({"error": "Choose what to ask."}, 422) unless ScoreAssistant.actions.includes?(action)
    if action == "ask" && request.trim.blank?
      return render_json({"error": "Write what you would like done."}, 422)
    end

    if request.trim.length > SCORE_SUGGESTION_REQUEST_LIMIT
      return render_json(
        {"error": "Your request is too long: keep it under #{SCORE_SUGGESTION_REQUEST_LIMIT} characters."},
        422
      )
    end

    too_long = source.length > SCORE_ASSISTANT_SOURCE_LIMIT
    return render_json({"error": "This score is too long for the assistant."}, 422) if too_long

    refusal = ScoreSuggestion.refusal(user)
    return @_refusal_json(refusal) unless refusal.nil?

    suggestion = ScoreSuggestion.start(user, score, action, request, source)
    return @_refusal_json(suggestion) if type(suggestion) == "string"

    render_json(
      {"id": suggestion._key, "state": suggestion.state},
      202
    )
  end

  # GET /app/suggestions/:id — {state}, with `source`, its `svg` and the
  # `explanation` once done, or `error` once failed
  def show
    suggestion = ScoreSuggestion.find(params["id"])
    halt(404, "No such suggestion") unless suggestion.owned_by?(current_user())

    return render_json({"state": "working"}) if suggestion.state == "working"
    if suggestion.state == "failed"
      return render_json({"state": "failed", "error": suggestion.error})
    end

    render_json({
      "state": "done",
      "source": suggestion.source,
      "explanation": suggestion.explanation.to_s,
      "svg": ScoreSvg.engrave(suggestion.source, 1000, 7, 0, {})["svg"]
    })
  end

  private

  # The answer refusing one more question now (`refusal`,
  # ScoreSuggestion.refusal): the day's used up (429), or the key or the
  # plan (403, with its link).
  def _refusal_json(refusal)
    if refusal == "used_up"
      return render_json({"error": "You have asked all of today's questions: try again tomorrow."}, 429)
    end

    @_ai_refused(refusal)
  end
end
