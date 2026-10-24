# The plans (#393): Free, what the site has always offered, and Pro, paid
# through Stripe (StripeBilling). Every limit a plan sets is read here,
# through `Plan.limits(user)`: the AI on the server's key, the audio takes,
# the people a score is shared with. A person's own AI key is never limited
# by the plan (ScoreReading / ScoreSuggestion keep their own day for it).
#
# The prices are provisional, and kept here only: the Pricing page and the
# account show them from PLAN_PRICES. What Stripe charges is the Price its
# id names (STRIPE_PRICE_PRO_MONTHLY / STRIPE_PRICE_PRO_ANNUAL, bin/stripe-setup):
# change both together.
const PLAN_PRICES = {"monthly": {
  "cents": 600,
  "label": "6 €",
  "per": "month"
}, "annual": {
  "cents": 6000,
  "label": "60 €",
  "per": "year"
}}
# What Pro multiplies the free AI day by (#365's 20 photos and 30 questions).
const PLAN_PRO_AI_FACTOR = 5
const PLAN_MEGABYTE = 1000000

class Plan
  # What `user` may do (a guest, nil, as on Free): each limit a number, or
  # nil for no limit. "plan" says which plan it is; "upgrade" whether Pro
  # would give more and can be bought now.
  #
  # Until payments are open (`open`, Stripe.configured? when nil), no one
  # can move to Pro, so the Free plan's new limits do not apply yet: those
  # not on Pro keep what the site allowed before (`today_limits`).
  static def limits(user, open = nil)
    return Plan.pro_limits if !user.nil? && user.pro?

    payments_open = open.nil? ? Plan.open? : open
    return Plan.free_limits if payments_open

    Plan.today_limits
  end

  # Whether Pro can be bought here: Stripe's key and both Prices are set.
  static def open?
    Stripe.configured?
  end

  # What everyone not on Pro has while payments are not open: the site as it
  # was before the plans (#365's AI day, every audio track, a take capped
  # only by SCORE_TAKE_MAX_BYTES, anyone a score is shared with).
  static def today_limits
    {
      "plan": "free",
      "upgrade": false,
      "readings_per_day": SCORE_READINGS_PER_DAY,
      "suggestions_per_day": SCORE_SUGGESTIONS_PER_DAY,
      "take_tracks": SCORE_TAKE_TRACKS,
      "take_bytes": nil,
      "people_per_score": nil
    }
  end

  # Free, once payments are open: the AI day of #365, one audio track a
  # score and 50 MB of takes, three people a score.
  static def free_limits
    {
      "plan": "free",
      "upgrade": true,
      "readings_per_day": SCORE_READINGS_PER_DAY,
      "suggestions_per_day": SCORE_SUGGESTIONS_PER_DAY,
      "take_tracks": 1,
      "take_bytes": 50 * PLAN_MEGABYTE,
      "people_per_score": 3
    }
  end

  # Pro: five times the AI, every audio track (SCORE_TAKE_TRACKS) and 2 GB
  # of takes, anyone a score is shared with.
  static def pro_limits
    {
      "plan": "pro",
      "upgrade": false,
      "readings_per_day": SCORE_READINGS_PER_DAY * PLAN_PRO_AI_FACTOR,
      "suggestions_per_day": SCORE_SUGGESTIONS_PER_DAY * PLAN_PRO_AI_FACTOR,
      "take_tracks": SCORE_TAKE_TRACKS,
      "take_bytes": 2000 * PLAN_MEGABYTE,
      "people_per_score": nil
    }
  end

  # The plan's name, as people read it.
  static def name_of(user)
    Plan.limits(user)["plan"] == "pro" ? "Pro" : "Free"
  end

  # The plans side by side, as the Pricing page lists them: each limit put
  # in words.
  static def catalog
    [Plan.shown("Free", Plan.free_limits), Plan.shown("Pro", Plan.pro_limits)]
  end

  static def shown(name, limits)
    {
      "name": name,
      "slug": limits["plan"],
      "readings": "#{limits["readings_per_day"]} photos read a day",
      "suggestions": "#{limits["suggestions_per_day"]} questions to the assistant a day",
      "tracks": limits["take_tracks"] == 1 ? "1 audio track a score" : "#{limits["take_tracks"]} audio tracks a score",
      "storage": "#{Plan.size_text(limits["take_bytes"])} of audio takes",
      "people": Plan.people_text(limits["people_per_score"])
    }
  end

  static def people_text(most)
    return "Share a score with as many people as you like" if most.nil?

    "Share a score with up to #{most} people"
  end

  # `bytes` as "50 MB" or "2 GB".
  static def size_text(bytes)
    return "#{bytes / (1000 * PLAN_MEGABYTE)} GB" if bytes >= 1000 * PLAN_MEGABYTE

    "#{bytes / PLAN_MEGABYTE} MB"
  end

  # The price of Pro paid every `interval` ("monthly" or "annual").
  static def price(interval)
    PLAN_PRICES[Plan.interval(interval)]
  end

  # `raw` as a billing interval: "annual", or else "monthly".
  static def interval(raw)
    raw.to_s.trim == "annual" ? "annual" : "monthly"
  end
end
