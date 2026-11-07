# A comment thread on a score (#385): anchored to a staff (`lane`, as the
# editor counts them, from 0) and some of its bars (`bars`: [first, last],
# from 0), said in `label` as the editor said it when the thread was started
# ("Bars 3–5, Piano"). Its messages are ScoreComments. Anyone who may see
# the score through their account (its owner, and everyone it is shared
# with, to read or to change) may comment, reply, resolve and reopen.
#
# The anchor follows its bars and its staff (#392): each save of the editor
# carries where the bars and lanes of the text it replaces went in the new
# one (public/eui-score/merge.js, anchorMap), and the threads are moved by
# it in the same request (`follow`), once the save went through. A thread
# whose bars were all taken away, or whose staff was, is kept, marked
# `detached` ("bars" or "staff"), on the bars it had.
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
    @_write({
      "resolved": @resolved,
      "resolved_by": @resolved_by,
      "resolved_at": @resolved_at
    })
  end

  def reopen
    @resolved = false
    @resolved_by = nil
    @resolved_at = nil
    @_write({
      "resolved": false,
      "resolved_by": nil,
      "resolved_at": nil
    })
  end

  def touch
    @_write({})
  end

  # `fields` and the time written into the stored thread, they alone
  # (#685): `save` writes the whole copy, and a thread resolved while an
  # editor's save moved it was moved back, or reopened.
  def _write(fields)
    @updated_at = DateTime.utc.to_unix
    fields["updated_at"] = @updated_at
    ScoreThread.where({"_key": @_key}).update_all(fields)
    true
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
      "detached": @detached,
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

  # ---- Following the bars (#392) ------------------------------------------

  # Where a save's bars and lanes went, as the editor sends it with the save:
  # {"from": the bars before, "to": the bars after, "bars": [[old, new,
  # length], …] (a bar in no run was taken away), "lanes": [each old lane's
  # new one, -1 for gone]}. Nil when it does not read as one: nothing moves.
  static def moves_of(anchors)
    return nil unless anchors.is_a?("hash")

    count_before = anchors["from"]
    count_after = anchors["to"]
    return nil unless ScoreThread.count?(count_before, 0, 10000) && ScoreThread.count?(count_after, 0, 10000)

    runs = anchors["bars"]
    return nil unless runs.is_a?("array") && runs.length <= 10000

    good_runs = runs.all? do |run|
      ScoreThread.run?(run, count_before, count_after)
    end
    return nil unless good_runs

    lanes = anchors["lanes"]
    return nil unless lanes.nil? || ScoreThread.lanes?(lanes)

    {
      "from": count_before,
      "to": count_after,
      "bars": runs,
      "lanes": lanes
    }
  end

  # A whole number from `least` to `most`.
  static def count?(value, least, most)
    value.is_a?("int") && value >= least && value <= most
  end

  # [old, new, length]: bars that are there before (`before` bars) and after (`after`).
  static def run?(run, before, after)
    return false unless run.is_a?("array") && run.length == 3

    numbers = run.all? do |number|
      ScoreThread.count?(number, 0, 10000)
    end
    numbers && run[2] >= 1 && run[0] + run[2] <= before && run[1] + run[2] <= after
  end

  # Each old lane's new one: at most 64, each a lane or -1.
  static def lanes?(lanes)
    return false unless lanes.is_a?("array") && lanes.length <= 64

    lanes.all? do |lane|
      ScoreThread.count?(lane, -1, 63)
    end
  end

  # `bars` [first, last] after `moves`: the first and the last of them still
  # there, or nil when none is. Bars past the old end (a thread placed by
  # hand beyond it) move with the end.
  static def bars_after(bars, moves)
    first = nil
    last = nil
    moves["bars"].each do |run|
      lo = [bars[0], run[0]].max()
      hi = [bars[1], run[0] + run[2] - 1].min()
      if lo <= hi
        start = run[1] + lo - run[0]
        finish = run[1] + hi - run[0]
        first = start if first.nil? || start < first
        last = finish if last.nil? || finish > last
      end
    end
    if bars[1] >= moves["from"]
      shift = moves["to"] - moves["from"]
      start = [bars[0], moves["from"]].max() + shift
      first = start if first.nil? || start < first
      last = [bars[1] + shift, 9999].min()
    end
    return nil if first.nil? || first > 9999

    [first, last]
  end

  # `lane` after `moves`: nil when its staff was taken away.
  static def lane_after(lane, moves)
    lanes = moves["lanes"]
    return lane if lanes.nil? || lane >= lanes.length

    moved = lanes[lane]
    moved < 0 ? nil : moved
  end

  # `label` as the editor said it ("Bars 3–5, Piano", "Bar 2, staff 1"),
  # its numbers moved as the bars and the lane were: any other label as it is.
  static def label_moved(label, old_bars, new_bars, old_lane, new_lane)
    text = label.to_s
    found = Regex.capture("^Bars? (?P<first>\\d+)(?:–(?P<last>\\d+))?(?P<rest>.*)$", text)
    unless found.nil?
      first = found["first"].to_i + new_bars[0] - old_bars[0]
      last = (found["last"].blank? ? found["first"] : found["last"]).to_i + new_bars[1] - old_bars[1]
      text = (first == last ? "Bar #{first}" : "Bars #{first}–#{last}") + found["rest"].to_s
    end
    staff = Regex.capture("^(?P<head>.*, [Ss]taff )(?P<number>\\d+)$", text)
    text = staff["head"] + (staff["number"].to_i + new_lane - old_lane).to_s unless staff.nil?
    text
  end

  # The thread moved by `moves`: true when it changed (moved, or detached
  # from bars or a staff that are gone).
  def follow_moves(moves)
    return false unless @detached.blank?

    lane = ScoreThread.lane_after(@lane, moves)
    bars = lane.nil? ? nil : ScoreThread.bars_after(@bars, moves)
    if bars.nil?
      @detached = lane.nil? ? "staff" : "bars"
      ScoreThread.where({"_key": @_key}).update_all({"detached": @detached})
      return true
    end
    return false if lane == @lane && bars == @bars

    @label = ScoreThread.label_moved(@label, @bars, bars, @lane, lane)
    @lane = lane
    @bars = bars
    # Where it is, alone (#685): not whether it is resolved.
    ScoreThread.where({"_key": @_key}).update_all({
      "label": @label,
      "lane": @lane,
      "bars": @bars
    })
    true
  end

  # Every thread of `score` moved by the editor's `anchors` (`moves_of`),
  # resolved ones too, so that a thread reopened later is on its bars.
  # Answers the keys of those that changed.
  static def follow(score, anchors)
    moves = ScoreThread.moves_of(anchors)
    return [] if moves.nil?

    moved = []
    ScoreThread.where({"score_id": score._key}).limit(SCORE_THREADS_KEPT).all.each do |thread|
      moved = moved + [thread._key] if thread.follow_moves(moves)
    end
    moved
  end

  # The threads of `score` whose keys are `keys`, as `listing` shows them.
  static def moved_views(score, keys)
    return [] if keys.length == 0

    ScoreThread.listing(score).filter do |view|
      keys.includes?(view["id"])
    end
  end
end
