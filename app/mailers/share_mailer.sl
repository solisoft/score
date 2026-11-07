# Tells someone a score was shared with them. Links are built from
# `auth_base_url` (app/models/user.sl).
class ShareMailer < Mailer
  def invited(share, score, inviter)
    @inviter = inviter
    # On one line (#687): a title kept before #687 may hold a line break;
    # none reaches the subject, nor the body.
    @score_title = Score.one_line(score.title)
    @role = share.role
    @open_url = auth_base_url() + "/app/scores/" + score._key
    @signup_url = auth_base_url() + "/signup"
    this.mail(to: share.email, subject: "#{inviter} shared “#{this.score_title}” with you")
  end
end
