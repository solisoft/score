# Comments on a score (#385), in JSON for the editor's panel and the read
# page: threads anchored to a staff and some bars (ScoreThread), their
# messages (ScoreComment). Behind `require_login`; on every action the score
# must be one the signed-in person may see through their account — its
# owner, or someone it is shared with, to read or to change (ScorePolicy
# show?) — and out of the trash. Each change is told to the score's room
# (ScoreRoom.tell_comments), and to the people it concerns
# (UserNotification).
class AppCommentsController < AppBaseController
  # GET /app/scores/:id/comments — {threads}: open first, the latest first
  def index
    score = @_score
    render_json({"threads": ScoreThread.listing(score)})
  end

  # GET /app/scores/:id/people — {people: [{key, name, email}]}: who an @ may
  # name in this score's comments (#392), its owner and those it is shared
  # with; to those who may see it only
  def people
    score = @_score
    render_json({"people": ScoreShare.mentionable(score)})
  end

  # POST /app/scores/:id/comments — JSON {lane, bars: [first, last], label,
  # body, origin}: a new thread, 201 with it; 422 {error} with nothing written
  def create
    score = @_score
    body = @_body
    started = ScoreThread.start(score, current_user(), body["lane"], body["bars"], body["label"], body["body"])
    return render_json({"error": started["error"]}, 422) unless started["error"].nil?

    UserNotification.commented(started["thread"], started["comment"], score, current_user())
    @_told(score, started["thread"], body, 201)
  end

  # POST /app/scores/:id/comments/:thread_id/replies — JSON {body, origin}
  def reply
    score = @_score
    thread = @_thread_of(score)
    body = @_body
    replied = thread.reply(current_user(), body["body"])
    return render_json({"error": replied["error"]}, 422) unless replied["error"].nil?

    UserNotification.commented(thread, replied["comment"], score, current_user())
    @_told(score, thread, body, 201)
  end

  # POST /app/scores/:id/comments/:thread_id/resolve
  def resolve
    score = @_score
    thread = @_thread_of(score)
    thread.resolve(current_user())
    @_told(score, thread, @_body, 200)
  end

  # POST /app/scores/:id/comments/:thread_id/reopen
  def reopen
    score = @_score
    thread = @_thread_of(score)
    thread.reopen
    @_told(score, thread, @_body, 200)
  end

  # PUT /app/scores/:id/comments/:thread_id/messages/:comment_id — JSON
  # {body}: its author's only (403 for anyone else)
  def update
    score = @_score
    thread = @_thread_of(score)
    comment = @_comment_of(thread)
    body = @_body
    halt(403, "Only its author may change a message.") unless comment.written_by?(current_user())

    problem = comment.edit_by(current_user(), body["body"])
    return render_json({"error": problem}, 422) unless problem.nil?

    @_told(score, thread, body, 200)
  end

  # DELETE /app/scores/:id/comments/:thread_id/messages/:comment_id — its
  # author's only; the thread goes with its last message ({gone})
  def destroy
    score = @_score
    thread = @_thread_of(score)
    comment = @_comment_of(thread)
    halt(403, "Only its author may delete a message.") unless comment.written_by?(current_user())

    comment.remove_by(current_user())
    still = ScoreThread.find_by("_key", thread._key)
    return @_told(score, still, @_body, 200) unless still.nil?

    ScoreRoom.tell_comments(score, ScoreRoom.comments_news(nil, thread._key, @_body["origin"]))
    render_json({"gone": thread._key})
  end

  private

  # The score of the route, if the signed-in person may see it (403
  # otherwise; 404 for no such score, or one in the trash).
  def _score
    score = authorize(Score.find(params["id"]), "show")
    halt(404, "That score is in the trash.") if score.trashed?

    score
  end

  # The thread of the route, if it is one of `score`'s (404 otherwise).
  def _thread_of(score)
    thread = ScoreThread.find(params["thread_id"])
    halt(404, "No such thread on this score") unless thread.score_id == score._key

    thread
  end

  def _comment_of(thread)
    comment = ScoreComment.find(params["comment_id"])
    halt(404, "No such message in this thread") unless comment.thread_id == thread._key

    comment
  end

  def _body
    req["json"] ?? params
  end

  # `thread` as it now stands, told to the room and answered with `status`.
  def _told(score, thread, body, status)
    view = thread.shown
    ScoreRoom.tell_comments(score, ScoreRoom.comments_news(view, nil, body["origin"]))
    render_json({"thread": view}, status)
  end
end
