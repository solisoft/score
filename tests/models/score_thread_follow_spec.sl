# Comment threads that follow their bars and their staff (#392): where a
# save says the bars and lanes went (ScoreThread.moves_of), each thread
# moved by it, its label with it; a thread whose bars or staff are gone
# kept, detached; anything that does not read as moves, refused.

def mover_person
  user = User.new()
  user.email = "mover-#{uuid_v4}@example.com"
  user.set_password("correct horse battery")
  user.save
  user
end

def mover_thread(score, user, lane, bars, label)
  ScoreThread.start(score, user, lane, bars, label, "Look")["thread"]
end

def mover_moves(anchors)
  ScoreThread.moves_of(anchors)
end

describe("ScoreThread, following the bars") do
  test("moves read as runs and lanes; anything else is nil") do
    good = {
      "from": 4,
      "to": 5,
      "bars": [[0, 0, 2], [
        2,
        3,
        2
      ]],
      "lanes": [0, 2]
    }
    assert_eq(mover_moves(good)["bars"], [[
      0,
      0,
      2
    ], [2, 3, 2]])
    assert_null(mover_moves(good.merge({"lanes": nil}))["lanes"])
    assert_null(mover_moves(nil))
    assert_null(mover_moves("moves"))
    assert_null(mover_moves(good.merge({"from": -1})))
    assert_null(mover_moves(good.merge({"to": "5"})))
    assert_null(mover_moves(good.merge({"to": 10001})))
    assert_null(mover_moves(good.merge({"bars": "0-2"})))
    assert_null(mover_moves(good.merge({"bars": [[0, 0]]})), "a run has three numbers")
    assert_null(mover_moves(good.merge({"bars": [[
      0,
      0,
      0
    ]]})), "a run is one bar at least")
    assert_null(mover_moves(good.merge({"bars": [[
      3,
      0,
      2
    ]]})), "a run past the old bars")
    assert_null(mover_moves(good.merge({"bars": [[
      0,
      4,
      2
    ]]})), "a run past the new bars")
    assert_null(mover_moves(good.merge({"bars": [[
      0,
      "a",
      1
    ]]})))
    assert_null(mover_moves(good.merge({"lanes": [0, -2]})))
    assert_null(mover_moves(good.merge({"lanes": [64]})))
    assert_null(mover_moves(good.merge({"lanes": "0"})))
    assert_null(mover_moves(good.merge({"lanes": (0 .. 65).map(&{ |k|
      0
    })})), "64 lanes at most")
  end

  test("bars after the moves: the first and the last still there; past the old end, with the end") do
    moves = mover_moves({
      "from": 6,
      "to": 5,
      "bars": [[0, 0, 2], [
        3,
        2,
        3
      ]],
      "lanes": nil
    })
    assert_eq(ScoreThread.bars_after([0, 1], moves), [0, 1])
    assert_eq(ScoreThread.bars_after([1, 3], moves), [1, 2], "bar 2 gone: from bar 1 to the old bar 3")
    assert_eq(ScoreThread.bars_after([4, 5], moves), [3, 4])
    assert_null(ScoreThread.bars_after([2, 2], moves), "its only bar gone")
    assert_eq(ScoreThread.bars_after([7, 9], moves), [6, 8], "placed by hand past the end")
    assert_eq(ScoreThread.bars_after([5, 8], moves), [4, 7])
  end

  test("lanes after the moves: moved, gone (nil), or as they were past the list or without one") do
    moves = mover_moves({
      "from": 1,
      "to": 1,
      "bars": [[0, 0, 1]],
      "lanes": [0, -1, 1]
    })
    assert_eq(ScoreThread.lane_after(0, moves), 0)
    assert_null(ScoreThread.lane_after(1, moves))
    assert_eq(ScoreThread.lane_after(2, moves), 1)
    assert_eq(ScoreThread.lane_after(5, moves), 5)
    assert_eq(ScoreThread.lane_after(3, mover_moves({
      "from": 1,
      "to": 1,
      "bars": [[0, 0, 1]]
    })), 3)
  end

  test("labels say the new bars and staff; a label of another shape is left as it is") do
    assert_eq(ScoreThread.label_moved("Bars 3–5, Piano", [2, 4], [3, 5], 0, 0), "Bars 4–6, Piano")
    assert_eq(ScoreThread.label_moved("Bars 3–5, Piano", [2, 4], [2, 2], 0, 0), "Bar 3, Piano")
    assert_eq(ScoreThread.label_moved("Bar 1, staff 2", [0, 0], [1, 1], 1, 3), "Bar 2, staff 4")
    # A pickup counts its bars from 0: the numbers move, whatever they started at.
    assert_eq(ScoreThread.label_moved("Bars 0–2, Flute", [0, 2], [1, 3], 0, 0), "Bars 1–3, Flute")
    assert_eq(ScoreThread.label_moved("The coda", [5, 6], [7, 8], 0, 0), "The coda")
    assert_eq(ScoreThread.label_moved(nil, [5, 6], [7, 8], 0, 0), "")
  end

  test("follow moves every thread of the score, resolved ones too, and answers the keys of those that changed") do
    owner = mover_person()
    score = Score.start(owner, Score.blank_source("Followed"))
    stays = mover_thread(score, owner, 0, [0, 0], "Bar 1, Flute")
    moves = mover_thread(score, owner, 1, [2, 3], "Bars 3–4, Oboe")
    resolved = mover_thread(score, owner, 0, [3, 3], "Bar 4, Flute")
    resolved.resolve(owner)
    staff_gone = mover_thread(score, owner, 2, [1, 1], "Bar 2, Cello")
    bars_gone = mover_thread(score, owner, 0, [1, 1], "Bar 2, Flute")
    anchors = {
      "from": 4,
      "to": 4,
      "bars": [[0, 0, 1], [
        2,
        1,
        2
      ]],
      "lanes": [0, 2, -1]
    }
    moved = ScoreThread.follow(score, anchors)
    assert_eq(moved.sort(), [
      moves._key,
      resolved._key,
      staff_gone._key,
      bars_gone._key
    ].sort())
    assert_eq(ScoreThread.find(stays._key).bars, [0, 0])
    shifted = ScoreThread.find(moves._key)
    assert_eq(shifted.lane, 2)
    assert_eq(shifted.bars, [1, 2])
    assert_eq(shifted.label, "Bars 2–3, Oboe")
    assert_eq(ScoreThread.find(resolved._key).bars, [2, 2])
    assert(ScoreThread.find(resolved._key).resolved, "still resolved")
    assert_eq(ScoreThread.find(staff_gone._key).detached, "staff")
    assert_eq(ScoreThread.find(staff_gone._key).bars, [1, 1], "kept on the bars it had")
    assert_eq(ScoreThread.find(bars_gone._key).detached, "bars")
    # A detached thread moves no more.
    assert_eq(ScoreThread.follow(score, anchors).includes?(bars_gone._key), false)
    assert_eq(ScoreThread.find(bars_gone._key).bars, [1, 1])
  end

  test("moves that do not read move nothing, and touch no other score's threads") do
    owner = mover_person()
    score = Score.start(owner, Score.blank_source("Still"))
    other = Score.start(owner, Score.blank_source("Elsewhere"))
    mine = mover_thread(score, owner, 0, [2, 2], "")
    theirs = mover_thread(other, owner, 0, [2, 2], "")
    assert_eq(ScoreThread.follow(
      score,
      {
        "from": 4,
        "to": 5,
        "bars": [[0, 9, 9]]
      }
    ), [])
    assert_eq(ScoreThread.follow(score, nil), [])
    assert_eq(ScoreThread.find(mine._key).bars, [2, 2])
    assert_eq(ScoreThread.follow(
      score,
      {
        "from": 4,
        "to": 5,
        "bars": [[0, 0, 1], [
          1,
          2,
          3
        ]]
      }
    ), [mine._key])
    assert_eq(ScoreThread.find(mine._key).bars, [3, 3])
    assert_eq(ScoreThread.find(theirs._key).bars, [2, 2])
  end

  test("the view says a thread is detached, and the moved ones are listed as the editor shows them") do
    owner = mover_person()
    score = Score.start(owner, Score.blank_source("Shown"))
    thread = mover_thread(score, owner, 0, [1, 1], "")
    other = mover_thread(score, owner, 0, [0, 0], "")
    ScoreThread.follow(
      score,
      {
        "from": 4,
        "to": 3,
        "bars": [[0, 0, 1], [
          2,
          1,
          2
        ]]
      }
    )
    views = ScoreThread.moved_views(score, [thread._key])
    assert_eq(views.length, 1)
    assert_eq(views[0]["detached"], "bars")
    assert_eq(ScoreThread.moved_views(score, []), [])
    assert_null(ScoreThread.find(other._key).view([], {})["detached"])
  end
end
