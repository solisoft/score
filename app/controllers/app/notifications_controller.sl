# What the app tells the signed-in person (#385): the bell's count, the
# list, each opened (and read) or marked read, all of them at once. Behind
# `require_login`; each person sees and marks only their own.
class AppNotificationsController < AppBaseController
  # GET /app/notifications — the latest, the unread ones marked
  def index
    @notifications = UserNotification.recent(current_user())
    @unread = @notifications.filter do |notification|
      !notification.read?
    end.length
    @title = "Notifications"
    @description = "What happened on the scores you share."
  end

  # GET /app/notifications/unread — JSON {count}, for the bell
  def unread
    render_json({"count": UserNotification.unread_count(current_user())})
  end

  # GET /app/notifications/:id/open — read, and off to what it is about: the
  # editor for those who may change the score, its read page for the others,
  # at the thread when there is one
  def visit
    notification = @_notification
    notification.read!
    score = Score.find_by("_key", notification.score_id)
    if score.nil? || score.trashed? || score.access_of(current_user()).nil?
      flash("notice", "That score is no longer there for you.")
      return redirect(app_notifications_path())
    end

    at = notification.thread_id.blank? ? "" : "#thread-#{notification.thread_id}"
    return redirect(app_score_path(score) + at) if score.writable_by?(current_user())

    redirect(shared_score_path(score.share_token) + at)
  end

  # POST /app/notifications/:id/read
  def mark_read
    @_notification.read!
    redirect(app_notifications_path())
  end

  # POST /app/notifications/read-all — every one read
  def mark_all_read
    UserNotification.read_all(current_user())
    flash("notice", "Everything is marked read.")
    redirect(app_notifications_path())
  end

  private

  # The notification of the route, if it is the signed-in person's (404 otherwise).
  def _notification
    notification = UserNotification.of(current_user(), params["id"])
    halt(404, "No such notification") if notification.nil?

    notification
  end
end
