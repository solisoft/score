# What the admins did (#544): every change made from the admin section, the
# latest first, with the admin who made it and the account or report it was
# made to.
class AdminActionsController < AdminBaseController
  # GET /admin/actions
  def index
    @actions = AdminAction.latest
    on_accounts = @actions.filter do |action|
      action.target_type == "user"
    end
    @names = User.names_of(on_accounts.map(&:target_id))
    @title = "Activity · Admin"
    @description = "What the admins did."
  end
end
