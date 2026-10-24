# Migration: create_score_comments — comment threads anchored to a staff and
# bars of a score (ScoreThread), their messages (ScoreComment), and what the
# app tells each person (UserNotification): in the app, and by e-mail.

def up(db)
  db.create_collection("score_threads")
  db.create_index("score_threads", "idx_score_threads_score", ["score_id"], {})
  db.create_collection("score_comments")
  db.create_index("score_comments", "idx_score_comments_thread", ["thread_id"], {})
  db.create_index("score_comments", "idx_score_comments_score", ["score_id"], {})
  db.create_collection("user_notifications")
  db.create_index("user_notifications", "idx_user_notifications_user", ["user_id", "created_at"], {})
  db.create_index("user_notifications", "idx_user_notifications_mail", ["mail"], {})
  db.create_index("user_notifications", "idx_user_notifications_score", ["score_id", "kind"], {})
end

def down(db)
  db.drop_collection("user_notifications")
  db.drop_collection("score_comments")
  db.drop_collection("score_threads")
end
