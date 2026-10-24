# The plans (#393): Plan.limits reads every limit, User#pro? says which
# plan applies — a Pro subscription active or on trial whose period has not
# ended, nothing else — and the AI day, the audio takes and the people a
# score is shared with each follow it, at their boundaries.

const PLAN_DAY = 86400

def plan_user(plan = nil, status = nil, period_end = nil)
  user = User.new()
  user.email = "plan-#{uuid_v4}@example.com"
  user.set_password("correct horse battery")
  user.confirmed_at = DateTime.utc.to_unix
  user.plan = plan
  user.plan_status = status
  user.current_period_end = period_end
  user.save
  User.find(user._key)
end

def plan_pro(status = "active", ends_in = 30 * PLAN_DAY)
  plan_user("pro", status, DateTime.utc.to_unix + ends_in)
end

# `count` photo readings of `user`'s, made in the last day.
def plan_readings(user, count)
  rows = (0 .. count).map do |_|
    {
      "user_id": user._key,
      "state": "done",
      "created_at": DateTime.utc.to_unix - 60
    }
  end
  ScoreReading.create_many(rows) if count > 0
end

def plan_suggestions(user, score, count)
  rows = (0 .. count).map do |_|
    {
      "user_id": user._key,
      "score_id": score._key,
      "action": "chords",
      "state": "done",
      "created_at": DateTime.utc.to_unix - 60
    }
  end
  ScoreSuggestion.create_many(rows) if count > 0
end

# A take of `bytes` that `user` recorded on `score`'s `track` (no sound:
# what counts is its size).
def plan_take(score, user, track, bytes)
  ScoreTake.create({
    "score_id": score._key,
    "user_id": user._key,
    "track": track,
    "name": "Audio #{track}",
    "size": bytes,
    "created_at": DateTime.utc.to_unix
  })
end

describe("Plan") do
  describe("User#pro?") do
    test("is Pro while an active or trialing subscription's period runs") do
      assert(plan_pro("active").pro?)
      assert(plan_pro("trialing").pro?)
    end

    test("is not Pro in any other status, even with the period running") do
      ["past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused", ""].each do |status|
        assert_not(plan_pro(status).pro?, status)
      end
    end

    test("is not Pro once the period has ended, to the second") do
      user = plan_pro("active", 100)
      ends = user.current_period_end
      assert(user.pro_at?(ends - 1))
      assert_not(user.pro_at?(ends))
      assert_not(user.pro_at?(ends + 1))
      assert_not(plan_pro("active", -1).pro?)
    end

    test("is not Pro without the Pro plan, or without a period end") do
      assert_not(plan_user().pro?)
      assert_not(plan_user("free", "active", DateTime.utc.to_unix + PLAN_DAY).pro?)
      assert_not(plan_user("pro", "active").pro?)
    end
  end

  describe("Plan.limits") do
    test("Free: #365's AI day, one audio track and 50 MB, three people") do
      limits = Plan.limits(plan_user(), true)
      assert_eq(limits["plan"], "free")
      assert_eq(limits["readings_per_day"], 20)
      assert_eq(limits["suggestions_per_day"], 30)
      assert_eq(limits["take_tracks"], 1)
      assert_eq(limits["take_bytes"], 50000000)
      assert_eq(limits["people_per_score"], 3)
    end

    test("Pro: five times the AI, four tracks and 2 GB, anyone") do
      limits = Plan.limits(plan_pro(), true)
      assert_eq(limits["plan"], "pro")
      assert_eq(limits["readings_per_day"], 100)
      assert_eq(limits["suggestions_per_day"], 150)
      assert_eq(limits["take_tracks"], 4)
      assert_eq(limits["take_bytes"], 2000000000)
      assert_null(limits["people_per_score"])
    end

    test("a guest, a lapsed Pro and a failed payment are on Free") do
      assert_eq(Plan.limits(nil, true)["plan"], "free")
      assert_eq(Plan.limits(plan_pro("active", -60), true)["plan"], "free")
      assert_eq(Plan.limits(plan_pro("past_due"), true)["plan"], "free")
      assert_eq(Plan.name_of(plan_pro("past_due")), "Free")
      assert_eq(Plan.name_of(plan_pro()), "Pro")
    end

    test("the catalog puts each plan's limits in words, from the same numbers") do
      plans = Plan.catalog
      assert_eq(plans.map(&:slug), ["free", "pro"])
      assert_eq(plans[0]["readings"], "20 photos read a day")
      assert_eq(plans[1]["suggestions"], "150 questions to the assistant a day")
      assert_eq(plans[0]["tracks"], "1 audio track a score")
      assert_eq(plans[1]["tracks"], "4 audio tracks a score")
      assert_eq(plans[0]["storage"], "50 MB of audio takes")
      assert_eq(plans[1]["storage"], "2 GB of audio takes")
      assert_eq(plans[0]["people"], "Share a score with up to 3 people")
      assert_eq(plans[1]["people"], "Share a score with as many people as you like")
    end

    test("the prices are kept in one place, monthly unless annual is asked") do
      assert_eq(Plan.price("monthly")["cents"], 600)
      assert_eq(Plan.price("annual")["cents"], 6000)
      assert_eq(Plan.price("weekly")["cents"], 600)
      assert_eq(Plan.interval(" annual "), "annual")
      assert_eq(Plan.interval(nil), "monthly")
    end
  end

  describe("while payments are not open") do
    test("no one can buy Pro, so everyone not on it keeps the site as it was") do
      assert_not(Plan.open?)
      user = plan_user()
      [Plan.limits(user), Plan.limits(user, false), Plan.limits(nil)].each do |limits|
        assert_eq(limits["plan"], "free")
        assert_eq(limits["upgrade"], false)
        assert_eq(limits["readings_per_day"], 20)
        assert_eq(limits["suggestions_per_day"], 30)
        assert_eq(limits["take_tracks"], SCORE_TAKE_TRACKS)
        assert_null(limits["take_bytes"])
        assert_null(limits["people_per_score"])
      end
      assert_eq(Plan.limits(user, true)["take_tracks"], 1)
      assert_eq(Plan.limits(user, true)["upgrade"], true)
      # A Pro subscription keeps Pro, open or not.
      assert_eq(Plan.limits(plan_pro(), false)["plan"], "pro")
      assert_eq(Plan.limits(plan_pro())["readings_per_day"], 100)
    end

    test("audio takes: every track, and no account total, as #390 allowed") do
      user = plan_user()
      score = Score.start(user, Score.blank_source("As before"))
      plan_take(score, user, 1, 60000000)
      assert_null(ScoreTake.plan_refusal(score, user, 4, 8000000))
      assert_null(ScoreTake.plan_refusal(score, user, 4, 8000000, false))
      assert_not_null(ScoreTake.plan_refusal(score, user, 4, 8000000, true))
    end

    test("people: a score shared with as many as before") do
      owner = plan_user()
      score = Score.start(owner, Score.blank_source("Everyone"))
      (0 .. 5).each do |n|
        assert_not_null(ScoreShare.invite_by(owner, score, "all#{n}-#{uuid_v4}@example.com", "read")._key)
      end
      assert_eq(ScoreShare.of(score).length, 5)
      assert_null(ScoreShare.plan_refusal(score, "sixth@example.com", false))
      assert_not_null(ScoreShare.plan_refusal(score, "sixth@example.com", true))
    end

    test("the AI's used-up day says Pro only when it can be bought") do
      closed = ScoreReading.used_up_text(Plan.today_limits)
      assert_eq(
        closed,
        "You have read the 20 photos a day the site's AI reads: try again tomorrow, "
        + "or add your own AI key on your account page to read more."
      )
      assert_eq(
        ScoreReading.used_up_text(Plan.free_limits),
        "You have read the 20 photos a day the site's AI reads on Free: try again tomorrow, "
        + "move to Pro for 100 a day, or add your own AI key on your account page to read more."
      )
      assert_eq(
        ScoreReading.used_up_text(Plan.pro_limits),
        "You have read the 100 photos a day the site's AI reads on Pro: try again tomorrow, "
        + "or add your own AI key on your account page to read more."
      )
      assert_eq(
        ScoreSuggestion.used_up_text(Plan.free_limits),
        "You have asked the 30 questions a day the site's AI answers on Free: try again tomorrow, "
        + "move to Pro for 150 a day, or add your own AI key on your account page to ask more."
      )
      assert_contains(
        ScoreSuggestion.used_up_text(Plan.pro_limits),
        "the 150 questions a day the site's AI answers on Pro"
      )
      assert_contains(
        ScoreSuggestion.used_up_text(Plan.today_limits),
        "the 30 questions a day the site's AI answers: try"
      )
    end
  end

  describe("the AI day") do
    test("Free: the 20th photo is read, the 21st refused") do
      user = plan_user()
      plan_readings(user, 19)
      assert_null(ScoreReading.refusal(user))
      assert_eq(ScoreReading.left_today(user), 1)
      plan_readings(user, 1)
      assert_eq(ScoreReading.refusal(user), "used_up")
      assert_eq(ScoreReading.left_today(user), 0)
    end

    test("Pro: five times as many photos and questions, to the boundary") do
      user = plan_pro()
      score = Score.start(user, Score.blank_source("Pro"))
      plan_readings(user, 99)
      assert_null(ScoreReading.refusal(user))
      plan_readings(user, 1)
      assert_eq(ScoreReading.refusal(user), "used_up")
      plan_suggestions(user, score, 149)
      assert_null(ScoreSuggestion.refusal(user))
      plan_suggestions(user, score, 1)
      assert_eq(ScoreSuggestion.refusal(user), "used_up")
    end

    test("Pro lapsed: back to the Free day") do
      user = plan_pro("canceled")
      plan_readings(user, 20)
      assert_eq(ScoreReading.refusal(user), "used_up")
      assert_eq(ScoreSuggestion.limit_for(user), 30)
    end

    test("one's own key keeps its own day, whatever the plan") do
      free = plan_user()
      free.keep_ai_key("mistral", "mistral-medium-latest", "sk-mistral-2222")
      pro = plan_pro()
      pro.keep_ai_key("mistral", "mistral-medium-latest", "sk-mistral-3333")
      assert_eq(ScoreReading.limit_for(User.find(free._key)), SCORE_READINGS_OWN_PER_DAY)
      assert_eq(ScoreReading.limit_for(User.find(pro._key)), SCORE_READINGS_OWN_PER_DAY)
      assert_eq(ScoreSuggestion.limit_for(User.find(pro._key)), SCORE_SUGGESTIONS_OWN_PER_DAY)
    end
  end

  describe("audio takes") do
    test("Free: track 1 only, on the owner's plan; Pro: all four") do
      owner = plan_user()
      score = Score.start(owner, Score.blank_source("Takes"))
      assert_null(ScoreTake.plan_refusal(score, owner, 1, 1000, true))
      refused = ScoreTake.plan_refusal(score, owner, 2, 1000, true)
      assert_eq(refused["error"], "On the Free plan a score has 1 audio track: Pro records on 4.")
      assert(refused["upgrade"])
      pro = plan_pro()
      theirs = Score.start(pro, Score.blank_source("Pro takes"))
      assert_null(ScoreTake.plan_refusal(theirs, pro, 4, 1000, true))
      # An editor on Free records on every track of a Pro owner's score.
      editor = plan_user()
      ScoreShare.invite(theirs, editor.email, "write")
      assert_null(ScoreTake.plan_refusal(theirs, editor, 3, 1000, true))
    end

    test("Free: up to 50 MB of takes, to the byte, counting every score") do
      user = plan_user()
      first = Score.start(user, Score.blank_source("One"))
      plan_take(first, user, 1, 30000000)
      second = Score.start(user, Score.blank_source("Two"))
      assert_eq(ScoreTake.bytes_of(user), 30000000)
      assert_null(ScoreTake.plan_refusal(second, user, 1, 20000000, true))
      refused = ScoreTake.plan_refusal(second, user, 1, 20000001, true)
      assert_eq(
        refused["error"],
        "Your takes would pass the 50 MB the Free plan keeps: delete some, or move to Pro for 2 GB."
      )
      assert(refused["upgrade"])
    end

    test("the take a new one replaces is not counted twice; another person's is not counted at all") do
      user = plan_user()
      score = Score.start(user, Score.blank_source("Again"))
      plan_take(score, user, 1, 49000000)
      assert_null(ScoreTake.plan_refusal(score, user, 1, 50000000, true))
      other = plan_user()
      Score.start(other, Score.blank_source("Theirs"))
      assert_eq(ScoreTake.bytes_of(other), 0)
      assert_eq(ScoreTake.replaced_bytes(score, other, 1), 0)
    end

    test("Pro: 2 GB, refused past it without a way to Pricing") do
      user = plan_pro()
      score = Score.start(user, Score.blank_source("Big"))
      plan_take(score, user, 1, 1999000000)
      assert_null(ScoreTake.plan_refusal(score, user, 2, 1000000, true))
      refused = ScoreTake.plan_refusal(score, user, 2, 1000001, true)
      assert_eq(refused["error"], "Your takes would pass the 2 GB your plan keeps: delete some first.")
      assert_null(refused["upgrade"])
    end
  end

  describe("people a score is shared with") do
    test("Free: the third person is invited, the fourth refused, nothing written") do
      owner = plan_user()
      score = Score.start(owner, Score.blank_source("Trio"))
      ["a", "b"].each do |name|
        assert_not_null(ScoreShare.invite_by(owner, score, "#{name}-#{uuid_v4}@example.com", "read", true)._key)
      end
      third = ScoreShare.invite_by(owner, score, "c-#{uuid_v4}@example.com", "read", true)
      assert_not_null(third._key)
      refused = ScoreShare.invite_by(owner, score, "d@example.com", "read", true)
      assert_eq(
        refused["error"],
        "On the Free plan a score is shared with 3 people at most: Pro shares it with as many as you like."
      )
      assert(refused["upgrade"])
      assert_eq(ScoreShare.of(score).length, 3)
      assert_eq(ScoreShare.where({"email": "d@example.com"}).count, 0)
      # One already in: their role still changes.
      changed = ScoreShare.invite_by(owner, score, third.email, "write", true)
      assert_eq(changed.role, "write")
      assert_eq(ScoreShare.of(score).length, 3)
    end

    test("shares made past the limit (on Pro once) are kept and still open the score") do
      owner = plan_user()
      score = Score.start(owner, Score.blank_source("Choir"))
      friends = (0 .. 5).map do |_|
        plan_user()
      end
      friends.each do |friend|
        ScoreShare.invite(score, friend.email, "read")
      end
      assert_eq(ScoreShare.of(score).length, 5)
      assert_eq(ScoreShare.role_for(score, friends[4]), "read")
      assert(ScoreShare.plan_refusal(score, "sixth@example.com", true)["upgrade"])
      assert_null(ScoreShare.plan_refusal(score, friends[0].email, true))
    end

    test("Pro: anyone, past three") do
      owner = plan_pro()
      score = Score.start(owner, Score.blank_source("Orchestra"))
      (0 .. 5).each do |n|
        assert_not_null(ScoreShare.invite_by(owner, score, "player#{n}-#{uuid_v4}@example.com", "read", true)._key)
      end
      assert_eq(ScoreShare.of(score).length, 5)
    end
  end
end
