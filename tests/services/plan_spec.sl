# The plans (#393): Plan.limits reads every limit, User#pro? says which
# plan applies — a Pro subscription active or on trial whose period has not
# ended, nothing else — and the AI on one's own key (#396), the audio takes and
# the people a score is shared with each follow it, at their boundaries.

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
    test("Free: no AI, one audio track and 50 MB, three people") do
      limits = Plan.limits(plan_user(), true)
      assert_eq(limits["plan"], "free")
      assert_eq(limits["own_key_ai"], false)
      assert_null(limits["readings_per_day"], "the site's AI day is gone (#396)")
      assert_null(limits["suggestions_per_day"])
      assert_eq(limits["take_tracks"], 1)
      assert_eq(limits["take_bytes"], 50000000)
      assert_eq(limits["people_per_score"], 3)
    end

    test("Pro: AI with one's own key, four tracks and 2 GB, anyone") do
      limits = Plan.limits(plan_pro(), true)
      assert_eq(limits["plan"], "pro")
      assert_eq(limits["own_key_ai"], true)
      assert_null(limits["readings_per_day"])
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
      assert_eq(plans[0]["ai"], "No AI")
      assert_eq(
        plans[1]["ai"],
        "AI (photo reading, assistant) with your own key from Anthropic, OpenAI, Gemini, Mistral, DeepSeek, Kimi…"
      )
      assert_null(plans[0]["readings"])
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
        assert_eq(limits["own_key_ai"], true)
        assert_eq(limits["take_tracks"], SCORE_TAKE_TRACKS)
        # The room Pro keeps (#543): not unbounded while no one can pay.
        assert_eq(limits["take_bytes"], Plan.pro_limits["take_bytes"])
        assert_null(limits["people_per_score"])
      end
      assert_eq(Plan.limits(user, true)["take_tracks"], 1)
      assert_eq(Plan.limits(user, true)["upgrade"], true)
      assert_eq(Plan.limits(user, true)["own_key_ai"], false)
      # A Pro subscription keeps Pro, open or not.
      assert_eq(Plan.limits(plan_pro(), false)["plan"], "pro")
      assert_eq(Plan.limits(plan_pro())["own_key_ai"], true)
    end

    test("audio takes: every track, and past Free's 50 MB, as #390 allowed") do
      user = plan_user()
      score = Score.start(user, Score.blank_source("As before"))
      plan_take(score, user, 1, 60000000)
      assert_null(ScoreTake.plan_refusal(score, user, 4, 8000000))
      assert_null(ScoreTake.plan_refusal(score, user, 4, 8000000, false))
      assert_not_null(ScoreTake.plan_refusal(score, user, 4, 8000000, true))
    end

    test("audio takes: an account keeps Pro's 2 GB at most, not without end (#543)") do
      user = plan_user()
      score = Score.start(user, Score.blank_source("Too much"))
      room = Plan.pro_limits["take_bytes"]
      plan_take(score, user, 1, room - 8000000)
      assert_null(ScoreTake.plan_refusal(score, user, 2, 8000000, false), "up to the limit")
      refused = ScoreTake.plan_refusal(score, user, 2, 8000001, false)
      assert_contains(refused["error"], "would pass the 2 GB your plan keeps")
      assert_null(refused["upgrade"])
      # The take it replaces does not count.
      assert_null(ScoreTake.plan_refusal(score, user, 1, room, false))
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
  end

  describe("the AI day, on one's own key") do
    test("payments closed, on Free: the 200th photo is read, the 201st refused") do
      user = plan_user()
      user.keep_ai_key("mistral", "pixtral-large-latest", "sk-mistral-2222")
      user = User.find(user._key)
      plan_readings(user, SCORE_READINGS_OWN_PER_DAY - 1)
      assert_null(ScoreReading.refusal(user, 0, false))
      assert_eq(ScoreReading.left_today(user), 1)
      plan_readings(user, 1)
      assert_eq(ScoreReading.refusal(user, 0, false), "used_up")
      assert_eq(ScoreReading.left_today(user), 0)
    end

    test("payments open, on Pro: the same day, kept as it was, for questions too") do
      user = plan_pro()
      user.keep_ai_key("mistral", "mistral-medium-latest", "sk-mistral-3333")
      user = User.find(user._key)
      score = Score.start(user, Score.blank_source("Pro"))
      assert_eq(SCORE_SUGGESTIONS_OWN_PER_DAY, 200)
      plan_suggestions(user, score, SCORE_SUGGESTIONS_OWN_PER_DAY - 1)
      assert_null(ScoreSuggestion.refusal(user, 0, true))
      plan_suggestions(user, score, 1)
      assert_eq(ScoreSuggestion.refusal(user, 0, true), "used_up")
      assert_eq(ScoreSuggestion.left_today(user), 0)
    end

    test("payments open, on Free or a lapsed Pro: refused for the plan, whatever is left of the day") do
      free = plan_user()
      free.keep_ai_key("mistral", "mistral-medium-latest", "sk-mistral-4444")
      free = User.find(free._key)
      assert_eq(ScoreReading.refusal(free, 0, true), "plan")
      assert_eq(ScoreSuggestion.refusal(free, 0, true), "plan")
      assert_eq(ScoreReading.left_today(free), SCORE_READINGS_OWN_PER_DAY)
      lapsed = plan_pro("canceled")
      lapsed.keep_ai_key("mistral", "mistral-medium-latest", "sk-mistral-5555")
      assert_eq(ScoreReading.refusal(User.find(lapsed._key), 0, true), "plan")
    end

    test("without a key of one's own: refused, open or not, on any plan") do
      assert_eq(ScoreReading.refusal(plan_user(), 0, false), "no_key")
      assert_eq(ScoreSuggestion.refusal(plan_pro(), 0, true), "no_key")
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
