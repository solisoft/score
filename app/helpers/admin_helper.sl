# Words of the admin section (/admin, #399): sums of money, dates, and an
# account's plan as a badge. A view cannot call AdminReport (a service), so
# what only the pages say lives here.

# `cents` of `currency` as a page shows them: "€6.00", "12.50 USD".
def admin_money(cents, currency = "eur")
  amount = (cents ?? 0).to_i
  whole = (amount / 100).to_i
  rest = amount - whole * 100
  text = "#{whole}.#{rest < 10 ? "0" : ""}#{rest}"
  code = currency.to_s.downcase
  return "€#{text}" if code == "eur" || code.blank?

  "#{text} #{code.upcase}"
end

# A date as the lists show it, "Oct 25, 2026", from unix seconds or an ISO
# string; "" for none.
def admin_day(value)
  return "" if value.to_s.blank?

  text = value.to_s
  stamp = text.contains("-") ? DateTime.parse(text).to_unix : text.to_i
  DateTime.from_unix(stamp).format("%b %-d, %Y")
end

# An account's plan as a badge: {"text", "kind"}, the kind naming its
# colour ("pro", "gift", "trouble", "free").
def admin_plan_badge(user)
  if ["past_due", "unpaid"].includes?(user.plan_status.to_s)
    return {"text": "Payment failed", "kind": "trouble"}
  end

  unless user.pro?
    return {"text": "Free", "kind": "free"}
  end

  if user.plan_gift == true
    return {"text": "Pro · offered", "kind": "gift"}
  end

  if user.cancel_at_period_end == true
    return {"text": "Pro · ending", "kind": "trouble"}
  end

  {"text": "Pro", "kind": "pro"}
end
