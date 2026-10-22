# Tells someone a score was shared with them. Links are built from
# `auth_base_url` (app/models/user.sl).
class ShareMailer < Mailer
  def invited(share, score, inviter)
    @inviter = inviter
    @score_title = score.title
    @role = share.role
    @open_url = auth_base_url() + "/app/scores/" + score._key
    @signup_url = auth_base_url() + "/signup"
    this.mail(to: share.email, subject: "#{inviter} shared “#{score.title}” with you")
  end
end
