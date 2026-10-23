# The editor's AI assistant: chord symbols, a harmonization, improvements,
# or a request of one's own, for the score open in the editor. The editor
# sends its text, then asks after the suggestion until it is ready; applying
# it is the editor's, on the person's say. Behind sign-in; a suggestion is
# only its owner's.
class AppScoreSuggestionsController < AppBaseController
  # POST /app/scores/:id/suggestions — JSON {action, request, source}: 202 {id},
  # or an {error}
  def create
    score = authorize(Score.find(params["id"]), "update")
    user = current_user()
    body = req["json"] ?? params
    action = body["action"].to_s
    request = body["request"].to_s
    source = body["source"].to_s.blank? ? score.source : body["source"].to_s
    no_key = "Add an AI key on your account page to use the assistant."
    return render_json({"error": no_key}, 503) if user.ai_settings.nil?
    return render_json({"error": "Choose what to ask."}, 422) unless ScoreAssistant.actions.includes?(action)
    if action == "ask" && request.trim.blank?
      return render_json({"error": "Write what you would like done."}, 422)
    end

    too_long = source.length > SCORE_ASSISTANT_SOURCE_LIMIT
    return render_json({"error": "This score is too long for the assistant."}, 422) if too_long

    used_up = "You have asked all of today's questions: try again tomorrow."
    return render_json({"error": used_up}, 429) if ScoreSuggestion.left_today(user) <= 0

    suggestion = ScoreSuggestion.start(user, score, action, request, source)
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
end
