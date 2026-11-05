# What the admins did (#544): every change made from the admin section, the
# latest first, with the admin who made it and the account or report it was
# made to.
class AdminActionsController < AdminBaseController
  # GET /admin/actions
  def index
    @actions = AdminAction.latest
    # The accounts named: those acted on, and the owners of the scores read (#626).
    @names = User.names_of(@actions.map(&:account_key).filter(&{ |key|
      !key.nil?
    }))
    @title = "Activity · Admin"
    @description = "What the admins did."
  end
end
