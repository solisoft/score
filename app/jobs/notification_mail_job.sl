# Every five minutes, the notifications' e-mails that are due (#385): each
# reply and mention its own e-mail, and the changes to the scores shared
# with someone gathered in one digest once their hour is over — each as its
# person's settings allow (UserNotification.mail_due). Answers what it did.
class NotificationMailJob
  static cron: String = Cron.every("5 minutes")

  static def perform(args: Hash)
    UserNotification.mail_due(DateTime.utc.to_unix)
  end
end
