# The notifications' e-mails (#385), written as Mailer.deliver takes them —
# {"to", "subject", "html", "text"} — and sent by NotificationMailJob
# (UserNotification.mail_due) through MailDelivery. Each says how to turn
# such e-mails off. Links are built from `auth_base_url` (app/models/user.sl);
# a notification's link opens it in the app, which marks it read.
class NotificationMail
  # A reply or a mention, to `user`.
  static def single(notification, user)
    open_url = NotificationMail.open_url(notification)
    quote = notification.excerpt.to_s
    lines = [notification.sentence + "."]
    lines = lines + ["", "“#{quote}”"] unless quote.blank?
    {
      "to": user.email,
      "subject": notification.sentence,
      "text": NotificationMail.text(lines, open_url, "Open the thread"),
      "html": NotificationMail.html(lines, open_url, "Open the thread")
    }
  end

  # The scores changed by others, gathered: one line a score.
  static def digest(notifications, user)
    lines = notifications.map do |notification|
      "#{notification.sentence}."
    end
    count = notifications.length
    subject = count == 1 ? notifications[0].sentence : "#{count} scores shared with you were changed"
    open_url = count == 1 ? NotificationMail.open_url(notifications[0]) : "#{auth_base_url}/app/notifications"
    action = count == 1 ? "Open the score" : "See them in the app"
    {
      "to": user.email,
      "subject": subject,
      "text": NotificationMail.text(lines, open_url, action),
      "html": NotificationMail.html(lines, open_url, action)
    }
  end

  static def open_url(notification)
    "#{auth_base_url}/app/notifications/#{notification._key}/open"
  end

  static def settings_url
    "#{auth_base_url}/app/account#notifications"
  end

  static def text(lines, url, action)
    settings = "Choose which e-mails EUI Score sends you: #{NotificationMail.settings_url}"
    (lines + ["", "#{action}: #{url}", "", settings]).join("\n")
  end

  static def html(lines, url, action)
    paragraphs = lines.filter do |line|
      !line.blank?
    end.map do |line|
      "<p>#{html_escape(line)}</p>"
    end.join("\n")
    page = ("<div style=\"font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;\">\n"
    + paragraphs
    + "\n<p style=\"margin: 24px 0;\"><a href=\"#{html_escape(url)}\" style=\"background: #8b2b2c; color: #fff; "
    + "padding: 10px 18px; border-radius: 6px; text-decoration: none;\">#{action}</a></p>\n"
    + "<p style=\"color: #666; font-size: 13px;\"><a href=\"#{html_escape(NotificationMail.settings_url)}\">"
    + "Choose which e-mails EUI Score sends you</a>.</p>\n</div>")
    page
  end
end
