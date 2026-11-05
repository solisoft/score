# What the admin section (/admin, #399) shows: the figures of the site's
# accounts and plans, the list of customers, one customer's whole picture,
# and the payments Stripe holds. Reads only: what an admin may change on an
# account is the User model's (gift_pro, stop_gift, unlock).
#
# An account's sign-up date is SoliDB's own `_created_at` (an ISO string,
# set on every document): accounts made before #399 have it too.
#
# What Stripe holds (its invoices) is asked through a `transport`
# (Stripe.call): nil in the app, a stand-in in the specs.
const ADMIN_PAGE_SIZE = 50
const ADMIN_DAY = 86400
const ADMIN_WEEKS = 12
const ADMIN_INVOICES = 25
# The lists' filters, each to the condition it adds (`now` bound).
const ADMIN_FILTERS = {
  "pro": "doc.plan == 'pro' AND doc.plan_status IN ['active', 'trialing'] AND doc.current_period_end > @now",
  "gift": "doc.plan_gift == true AND doc.current_period_end > @now",
  "past_due": "doc.plan_status IN ['past_due', 'unpaid']",
  "cancelling": "doc.plan == 'pro' AND doc.cancel_at_period_end == true AND doc.current_period_end > @now",
  "unconfirmed": "doc.confirmed_at == null",
  "admins": "doc.role == 'admin'"
}

class AdminReport
  # --- The dashboard ----------------------------------------------------------

  # The figures at `now` (unix seconds): accounts, confirmed, new in 7 and
  # 30 days, on Pro (paying and gifted), in payment trouble, cancelling,
  # and the monthly revenue of the paying ones, in cents.
  static def figures(now)
    {
      "accounts": User.count,
      "confirmed": User.where("doc.confirmed_at != null").count,
      "new_week": AdminReport.signed_up_since(now - 7 * ADMIN_DAY).count,
      "new_month": AdminReport.signed_up_since(now - 30 * ADMIN_DAY).count,
      "pro": AdminReport.filtered("pro", now).count,
      "gifts": AdminReport.filtered("gift", now).count,
      "past_due": AdminReport.filtered("past_due", now).count,
      "cancelling": AdminReport.filtered("cancelling", now).count,
      "mrr_cents": AdminReport.monthly_revenue(now),
      "scores": Score.where("doc.trashed_at == null").count
    }
  end

  # The accounts made since `since` (unix seconds).
  static def signed_up_since(since)
    User.where("doc._created_at >= @since", {"since": AdminReport.iso(since)})
  end

  # What the paying accounts bring a month, in cents: Pro's monthly price,
  # or its yearly one over twelve, each by the interval its subscription
  # has (monthly when not known). A gift brings nothing.
  static def monthly_revenue(now)
    paying = AdminReport.filtered("pro", now).where("doc.plan_gift != true")
    rows = paying.select("plan_interval").all
    rows.map do |row|
      AdminReport.monthly_cents(row.plan_interval)
    end.sum
  end

  # Pro's price a month, in cents, paid every `interval`.
  static def monthly_cents(interval)
    price = Plan.price(interval)
    Plan.interval(interval) == "annual" ? (price["cents"] / 12).to_i : price["cents"]
  end

  # The sign-ups of the last ADMIN_WEEKS weeks before `now`, the oldest
  # first: [{"from" (unix seconds), "count"}].
  static def weekly_signups(now)
    first = now - ADMIN_WEEKS * 7 * ADMIN_DAY
    stamps = AdminReport.signed_up_since(first).select("_created_at").all.map do |row|
      DateTime.parse(row._created_at.to_s).to_unix
    end
    AdminReport.weeks(stamps, now)
  end

  # `stamps` (unix seconds) counted by week, the ADMIN_WEEKS before `now`.
  static def weeks(stamps, now)
    first = now - ADMIN_WEEKS * 7 * ADMIN_DAY
    (0 .. ADMIN_WEEKS).map do |week|
      week_start = first + week * 7 * ADMIN_DAY
      week_end = week_start + 7 * ADMIN_DAY
      {"from": week_start, "count": stamps.filter do |stamp|
        stamp >= week_start && stamp < week_end
      end.length}
    end
  end

  # The `count` accounts made last.
  static def newest(count)
    AdminReport.listed(User.where("doc._key != null")).order("_created_at", "desc").limit(count).all
  end

  # The `count` Stripe events handled last.
  static def recent_events(count)
    StripeEvent.where("doc.received_at != null").order("received_at", "desc").limit(count).all
  end

  # --- The customers ----------------------------------------------------------

  # Page `page` (from 1) of the accounts matching `query` (in the address
  # or the name) and `filter` (a key of ADMIN_FILTERS, or none), the newest
  # first: {"users", "more"}.
  static def customers(query, filter, page, now)
    builder = AdminReport.search(query, filter, now)
    first = (Score.page_number(page) - 1) * ADMIN_PAGE_SIZE
    rows = AdminReport.listed(builder).order("_created_at", "desc").offset(first).limit(ADMIN_PAGE_SIZE + 1).all
    more = rows.length > ADMIN_PAGE_SIZE
    {"users": more ? rows.slice(0, ADMIN_PAGE_SIZE) : rows, "more": more}
  end

  # The query for the accounts matching `query` and `filter`.
  static def search(query, filter, now)
    needle = query.to_s.trim.downcase
    condition = "doc._key != null"
    binds = {}
    unless needle.blank?
      condition = condition + " AND (CONTAINS(LOWER(doc.email), @needle)"
      condition = condition + " OR (doc.name != null AND CONTAINS(LOWER(doc.name), @needle)))"
      binds["needle"] = needle
    end
    unless ADMIN_FILTERS[filter.to_s].nil?
      condition = condition + " AND " + ADMIN_FILTERS[filter.to_s]
      binds["now"] = now
    end
    User.where(condition, binds)
  end

  # The accounts matching `filter` at `now`.
  static def filtered(filter, now)
    User.where(ADMIN_FILTERS[filter], {"now": now})
  end

  # What a list shows of an account, without its secrets.
  static def listed(query)
    query.select(
      "email",
      "name",
      "role",
      "plan",
      "plan_status",
      "plan_gift",
      "current_period_end",
      "cancel_at_period_end",
      "confirmed_at",
      "_created_at"
    )
  end

  # Each of `users`' keys to how many scores they have out of the trash.
  static def score_counts(users)
    keys = users.map do |user|
      user._key
    end
    return {} if keys.length == 0

    counts = {}
    rows = Score.where("doc.user_id IN @keys AND doc.trashed_at == null", {"keys": keys}).select("user_id").all
    rows.each do |row|
      counts[row.user_id] = (counts[row.user_id] ?? 0) + 1
    end
    counts
  end

  # One customer's picture: how many scores they have out of the trash
  # (the list itself is `customer_scores`), the bytes of their audio
  # takes, the Stripe events about them.
  static def customer(user)
    mine = {"user": user._key}
    {
      "score_count": Score.where("doc.user_id == @user AND doc.trashed_at == null", mine).count,
      "take_bytes": ScoreTake.bytes_of(user),
      "names": User.names_in([user]),
      "events": StripeEvent.where("doc.user_id == @user", mine).order("received_at", "desc").limit(20).all
    }
  end

  # Page `page` (from 1) of the scores `user` owns, in the trash or not, the
  # latest changed first (#626): each as a list shows it, without its
  # source, with how many people it is shared with and how many versions
  # it keeps — {"scores", "shares", "versions", "more"}, the counts by the
  # score's key. Two round-trips however many there are: the page, then
  # its two counts together.
  static def customer_scores(user, page)
    first = (Score.page_number(page) - 1) * ADMIN_PAGE_SIZE
    rows = Score.where("doc.user_id == @user", {"user": user._key}).select(
      "title",
      "composer",
      "user_id",
      "updated_at",
      "created_at",
      "trashed_at",
      "visibility"
    ).order("updated_at", "desc").offset(first).limit(ADMIN_PAGE_SIZE + 1).all
    more = rows.length > ADMIN_PAGE_SIZE
    scores = more ? rows.slice(0, ADMIN_PAGE_SIZE) : rows
    keys = scores.map(&:_key)
    share_rows = []
    version_rows = []
    if keys.length > 0
      grouped(fn() {
        share_rows = ScoreShare.where("doc.score_id IN @keys", {"keys": keys}).group_by("score_id").all
        version_rows = ScoreVersion.where("doc.score_id IN @keys", {"keys": keys}).group_by("score_id").all
      })
    end
    {
      "scores": scores,
      "shares": AdminReport.counted(share_rows),
      "versions": AdminReport.counted(version_rows),
      "more": more
    }
  end

  # Grouped counts (rows of {"score_id", "n"}) as each score's key to its count.
  static def counted(rows)
    counts = {}
    rows.each do |row|
      counts[row["score_id"]] = row["n"]
    end
    counts
  end

  # --- Payments ---------------------------------------------------------------

  # The invoices Stripe holds, the latest first: of `customer_id` when
  # given, after the invoice `after` when given. {"invoices", "more"}, or
  # {"error"} when Stripe could not be asked.
  static def invoices(customer_id, after, transport = nil)
    return {"error": "Stripe is not set up on this server."} if transport.nil? && Stripe.secret_key.blank?

    answer = Stripe.call("GET", AdminReport.invoices_path(customer_id, after), "", transport)
    return {"error": "Stripe could not be read: #{answer["error"]}"} unless answer["ok"]

    data = answer["data"]
    {"invoices": (data["data"] ?? []).map do |invoice|
      AdminReport.invoice(invoice)
    end, "more": data["has_more"] == true}
  end

  # Where Stripe lists the invoices `invoices` asks for.
  static def invoices_path(customer_id, after)
    fields = {"limit": ADMIN_INVOICES}
    fields["customer"] = customer_id unless customer_id.to_s.blank?
    fields["starting_after"] = after unless after.to_s.blank?
    "invoices?" + Stripe.form(fields)
  end

  # What a list shows of a Stripe invoice.
  static def invoice(raw)
    {
      "id": raw["id"].to_s,
      "number": raw["number"].to_s,
      "status": raw["status"].to_s,
      "amount": raw["status"] == "paid" ? raw["amount_paid"] : raw["amount_due"],
      "currency": raw["currency"].to_s,
      "created": raw["created"],
      "customer": Billing.id_of(raw["customer"]),
      "email": raw["customer_email"].to_s,
      "url": raw["hosted_invoice_url"].to_s
    }
  end

  # Each Stripe customer of `invoices` to the key of the account it is.
  static def accounts_of(invoices)
    customers = invoices.map do |invoice|
      invoice["customer"]
    end.filter do |id|
      !id.blank?
    end.uniq
    return {} if customers.length == 0

    accounts = {}
    User.where("doc.stripe_customer_id IN @ids", {"ids": customers}).select("stripe_customer_id").all.each do |user|
      accounts[user.stripe_customer_id] = user._key
    end
    accounts
  end

  # --- Dates ------------------------------------------------------------------

  # `unix` seconds as an ISO string, to compare with `_created_at`.
  static def iso(unix)
    DateTime.from_unix(unix).to_iso
  end
end
