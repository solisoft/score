# The signed-in person's part in the shared library of sections (#444):
# publishing bars from the editor (JSON), and on a section's page — forms —
# rating it, commenting on it, reporting it or a comment, and taking away
# what is theirs. Behind `require_login`. The library itself is
# SectionsController's.
class AppSectionsController < AppBaseController
  # POST /app/sections — JSON {title, description, instrument, style, time,
  # key, bpm, bars, tracks, section, source, author_name — the name the
  # library shows, kept on the account}: 201 {id, url}; 422 {error}
  # with nothing written
  def create
    body = req["json"] ?? params
    named = current_user().name_as(body["author_name"])
    return render_json({"error": named}, 422) unless named.nil?

    published = SharedSection.publish(current_user(), body)
    return render_json({"error": published["error"]}, 422) unless published["error"].nil?

    section = published["section"]
    render_json(
      {"id": section._key, "url": section_path(section._key)},
      201
    )
  end

  # POST /app/sections/:id/import — `score_id`: one of the person's scores,
  # or "new" (#451). A new score is the section itself, titled with its name;
  # one of theirs opens in the editor, which adds the section after its bars.
  def add_to_score
    section = @_visible
    if params["score_id"].to_s == "new"
      # Read by the engraver first, counted against the account's engravings (#684).
      sender = ScoreSvg.sender("save", current_user(), client_ip(req))
      return ScoreSvg.too_many if Score.engraving_held?(section.source, sender)

      score = Score.start(current_user(), section.source)
      halt(422, Score.refusal_in(score, "That score could not be created.")) if score._errors

      return redirect(app_score_path(score))
    end

    score = authorize(Score.find(params["score_id"].to_s), "update")
    redirect("#{app_score_path(score)}?section=#{section._key}")
  end

  # POST /app/sections/:id/rating — `stars`, 1 to 5
  def rate
    section = @_visible
    problem = SectionRating.rate(section, current_user(), params["stars"])
    @_back(section, problem ?? "Thank you: your rating is in.")
  end

  # POST /app/sections/:id/comments — `body`, and `author_name` while the account has none
  def comment
    section = @_visible
    named = current_user().name_as(params["author_name"])
    return @_back(section, named) unless named.nil?

    written = SectionComment.write(section, current_user(), params["body"])
    @_back(section, written["error"] ?? "Your comment is posted.")
  end

  # POST /app/sections/:id/comments/:comment_id/remove — its author's, or an
  # admin's (with the second step, #687: kept in the admins' log)
  def uncomment
    section = @_visible
    comment = @_comment_of(section)
    halt(403, "Only its author may take a comment away.") unless comment.removable_by?(current_user())

    unless comment.by?(current_user())
      AdminAction.kept(current_user(), "comment_remove", "comment", comment._key, {
        "owner": comment.user_id,
        "title": section.title,
        "section_id": section._key,
        "body": comment.body.to_s.substring(0, 200)
      })
    end
    comment.delete
    section.recount
    @_back(section, "The comment is taken away.")
  end

  # POST /app/sections/:id/reports — `reason`, and `comment_id` for a comment
  def report
    section = @_visible
    comment = params["comment_id"].to_s.blank? ? nil : @_comment_of(section)
    problem = SectionReport.file(section, comment, current_user(), params["reason"])
    @_back(section, problem ?? "Thank you: the admins will look at it.")
  end

  # POST /app/sections/:id/remove — its author's, or an admin's (with the
  # second step, #687: kept in the admins' log)
  def remove
    section = SharedSection.find(params["id"])
    halt(403, "Only its author may take a section away.") unless section.removable_by?(current_user())

    unless section.by?(current_user())
      AdminAction.kept(current_user(), "section_remove", "section", section._key, {
        "owner": section.user_id,
        "title": section.title
      })
    end
    section.remove
    flash("notice", "“#{section.title}” is taken away from the library.")
    redirect(sections_path())
  end

  private

  # The section of the route, unless it is hidden (404; but to an admin
  # whose session passed the second step, #687).
  def _visible
    section = SharedSection.find(params["id"])
    halt(404, "No such section") if section.hidden && !SecondStep.admin?(current_user())

    section
  end

  # The comment of the route, if it is one of `section`'s (404 otherwise).
  def _comment_of(section)
    comment = SectionComment.find(params["comment_id"])
    halt(404, "No such comment on this section") unless comment.section_id == section._key

    comment
  end

  def _back(section, message)
    flash("notice", message)
    redirect(section_path(section._key))
  end
end
