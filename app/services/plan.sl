# The plans (#393): Free, what the site has always offered, and Pro, paid
# through Stripe (StripeBilling). Every limit a plan sets is read here,
# through `Plan.limits(user)`: whether the AI may run on one's own key, the
# audio takes, the people a score is shared with, the scores an account
# keeps (#684: far past any library, so that none fills the database). The site has no AI of its
# own (#396, AiClient): "own_key_ai" says whether a person's own key may be
# used. Its day (ScoreReading / ScoreSuggestion, 200 each) is not the plan's:
# it guards against a runaway loop, the provider's bill being theirs.
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
const PLAN_MEGABYTE = 1000000
# Whether the site is free (#699): no plan is sold, everyone has Pro's
# limits, and nothing on the site or in the app speaks of plans. The plans
# and Stripe stay in the code, switched off: false sells them again (once
# Stripe is set up), and the pages that offered them come back.
const PLAN_SITE_FREE = true

class Plan
  # What `user` may do (a guest, nil, as on Free): each limit a number, or
  # nil for no limit. "plan" says which plan it is; "upgrade" whether Pro
  # would give more and can be bought now.
  #
  # Until payments are open (`open`, Plan.open? when nil), no one can move
  # to Pro, so the Free plan's limits do not apply: everyone has Pro's
  # (`today_limits`). While the site is free (#699), payments never open.
  static def limits(user, open = nil)
    return Plan.pro_limits if !user.nil? && user.pro?

    payments_open = open.nil? ? Plan.open? : open
    return Plan.free_limits if payments_open

    Plan.today_limits
  end

  # Whether Pro can be bought here: the site is not free (#699), and
  # Stripe's key and both Prices are set.
  static def open?
    Plan.selling?(Plan.free?, Stripe.configured?)
  end

  # Whether the site is free (#699, PLAN_SITE_FREE): nothing is sold, and
  # the pages say nothing of plans.
  static def free?
    PLAN_SITE_FREE
  end

  # Whether Pro is on sale when the site is `free` or not, and Stripe
  # `configured` or not.
  static def selling?(free, configured)
    !free && configured
  end

  # What everyone not on Pro has while payments are not open, and so while
  # the site is free (#699): Pro's limits, every one of them (AI with one's
  # own key, every audio track, anyone a score is shared with, Pro's room
  # for takes and scores), under no plan's name: no "upgrade".
  static def today_limits
    Plan.pro_limits.merge({"plan": "free"})
  end

  # Free, once payments are open: no AI, one audio track a score and 50 MB
  # of takes, three people a score, 1,000 scores.
  static def free_limits
    {
      "plan": "free",
      "upgrade": true,
      "own_key_ai": false,
      "take_tracks": 1,
      "take_bytes": 50 * PLAN_MEGABYTE,
      "people_per_score": 3,
      "scores": 1000
    }
  end

  # Pro: AI with one's own key, every audio track (SCORE_TAKE_TRACKS) and
  # 2 GB of takes, anyone a score is shared with, 10,000 scores.
  static def pro_limits
    {
      "plan": "pro",
      "upgrade": false,
      "own_key_ai": true,
      "take_tracks": SCORE_TAKE_TRACKS,
      "take_bytes": 2000 * PLAN_MEGABYTE,
      "people_per_score": nil,
      "scores": 10000
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
      "ai": Plan.ai_text(limits["own_key_ai"]),
      "tracks": Plan.said(limits["take_tracks"] == 1 ? "plan.one_track" : "plan.tracks", limits["take_tracks"]),
      "storage": Plan.said("plan.storage", Plan.size_text(limits["take_bytes"])),
      "people": Plan.people_text(limits["people_per_score"])
    }
  end

  # What the Pricing page adds about the AI: while payments are closed,
  # that anyone may use it with their own key (today_limits); nil once open.
  static def ai_note(open)
    return nil if open

    SiteText.t("plan.ai_note")
  end

  static def ai_text(own_key_ai)
    return SiteText.t("plan.no_ai") unless own_key_ai

    SiteText.t("plan.ai")
  end

  static def people_text(most)
    return SiteText.t("plan.people_any") if most.nil?

    Plan.said("plan.people", most)
  end

  # The text of `key` in the request's language (#471), its {n} said `value`.
  static def said(key, value)
    SiteText.t(key, {"n": value})
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
