# A comment thread on a score (#385): anchored to a staff (`lane`, as the
# editor counts them, from 0) and some of its bars (`bars`: [first, last],
# from 0), said in `label` as the editor said it when the thread was started
# ("Bars 3–5, Piano"). Its messages are ScoreComments. Anyone who may see
# the score through their account (its owner, and everyone it is shared
# with, to read or to change) may comment, reply, resolve and reopen.
#
# The anchor keeps the bar numbers it was given: bars inserted or taken away
# later do not move it (the editor's changes are text, saved as a whole; a
# thread on bars that are gone says so when it is clicked).
const SCORE_THREADS_KEPT = 500
const SCORE_THREAD_LABEL_LENGTH = 120

class ScoreThread < Model
  validates("score_id", {"presence": true})
  validates("user_id", {"presence": true})

  # A thread on `score` by `user`, at `lane` and `bars` (as the page sent
  # them), `label` naming them, its first message `body`. Answers
  # {"thread", "comment"}, or {"error"} with nothing written.
  static def start(score, user, lane, bars, label, body)
    anchor = ScoreRoom.place(lane, bars)
    return {"error": "Select some bars or a note first: the comment goes on them."} if anchor["lane"].nil?

    problem = ScoreComment.body_error(body)
    return {"error": problem} unless problem.nil?
    if ScoreThread.where({"score_id": score._key}).count >= SCORE_THREADS_KEPT
      return {"error": "This score has the #{SCORE_THREADS_KEPT} threads it may keep: delete some first."}
    end

    now = DateTime.utc.to_unix
    thread = ScoreThread.create({
      "score_id": score._key,
      "user_id": user._key,
      "lane": anchor["lane"],
      "bars": anchor["bars"],
      "label": ScoreThread.label_for(label, anchor),
      "resolved": false,
      "created_at": now,
      "updated_at": now
    })
    {"thread": thread, "comment": ScoreComment.write(thread, user, body)}
  end

  # `label` as the page said it, trimmed and cut short; when there is none,
  # the bars and the staff counted from 1.
  static def label_for(label, anchor)
    text = label.to_s.trim
    return text.substring(0, SCORE_THREAD_LABEL_LENGTH) unless text.blank?

    first = anchor["bars"][0] + 1
    last = anchor["bars"][1] + 1
    bars_said = first == last ? "Bar #{first}" : "Bars #{first}–#{last}"
    "#{bars_said}, staff #{anchor["lane"] + 1}"
  end

  # A reply by `user`: {"comment"}, or {"error"} with nothing written. A
  # resolved thread is reopened first to be replied to.
  def reply(user, body)
    return {"error": "This thread is resolved: reopen it to reply."} if @resolved

    problem = ScoreComment.body_error(body)
    return {"error": problem} unless problem.nil?

    comment = ScoreComment.write(this, user, body)
    @touch
    {"comment": comment}
  end

  def resolve(user)
    @resolved = true
    @resolved_by = user._key
    @resolved_at = DateTime.utc.to_unix
    @touch
  end

  def reopen
    @resolved = false
    @resolved_by = nil
    @resolved_at = nil
    @touch
  end

  def touch
    @updated_at = DateTime.utc.to_unix
    @save
  end

  # Its messages, the first first.
  def messages
    ScoreComment.where({"thread_id": @_key}).order("created_at", "asc").order("_key", "asc").limit(1000).all
  end

  # The keys of those who wrote in it, each once.
  def writers
    @messages.map(&:user_id).uniq
  end

  # The thread as the editor shows it, with `messages` and the names in
  # `names` (key to name).
  def view(messages, names)
    {
      "id": @_key,
      "lane": @lane,
      "bars": @bars,
      "label": @label,
      "resolved": @resolved == true,
      "resolved_by": @resolved_by.blank? ? nil : names[@resolved_by] ?? "someone",
      "created_at": @created_at,
      "updated_at": @updated_at,
      "messages": messages.map do |message|
        message.view(names)
      end
    }
  end

  # `view`, its messages and names read here.
  def shown
    messages = @messages
    keys = messages.map(&:user_id)
    keys = keys + [@resolved_by] unless @resolved_by.blank?
    @view(messages, User.names_of(keys))
  end

  # Every thread of `score`, as `view` shows them, open first, the latest
  # first: three reads however many there are.
  static def listing(score)
    threads = []
    comments = []
    grouped(fn() {
      threads = ScoreThread.where({"score_id": score._key}).limit(SCORE_THREADS_KEPT).all
      in_order = ScoreComment.where({"score_id": score._key}).order("created_at", "asc").order("_key", "asc")
      comments = in_order.limit(20000).all
    })
    resolvers = threads.map(&:resolved_by).filter do |key|
      !key.blank?
    end
    names = User.names_of(comments.map(&:user_id) + resolvers)
    by_thread = comments.group_by("thread_id")
    views = threads.map do |thread|
      thread.view(by_thread[thread._key] ?? [], names)
    end
    views.sort_by(fn(view) { (view["resolved"] ? 0 : 10000000000) + view["updated_at"].to_i }).reverse()
  end

  # Gone with their score (Score#erase).
  static def delete_all_for(score)
    ScoreComment.where({"score_id": score._key}).delete_all
    ScoreThread.where({"score_id": score._key}).delete_all
  end
end
