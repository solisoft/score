# What every screen of the score-writing app (/app) shares, and no action:
# its full-screen layout, and the way an AI refusal (AiClient.refusal, #396)
# is linked — the Start page, the editor and both AI endpoints say it. The
# routes behind it sit in the `require_app_database` middleware
# (app/middleware/app_setup.sl).
class AppBaseController < Controller
  static {
    this.layout = "app"

    # The app speaks the language of the `locale` cookie (#505) at one
    # address: a page prefetched in English stays fresh for a while in the
    # browser's cache, and a switch to French would get it back. Varying on
    # the cookie keeps the English copy for the English request only.
    # Set once on the class at boot, not per instance: no cycle to free.
    # soli-lint-disable-next-line smell/closure-cycle
    this.after_action = fn(req, response) {
      return response unless type(response) == "hash" && response.has_key("status")

      headers = response["headers"] ?? {}
      headers["Vary"] = headers["Vary"].blank? ? "Cookie" : headers["Vary"] + ", Cookie"
      response["headers"] = headers
      response
    }
  }

  private

  # The page that lifts `refusal`: {"href", "text"}.
  def _ai_link(refusal)
    AiClient.refusal_link(refusal, app_account_path() + "#ai", pricing_path())
  end

  # The 403 refusing an AI request for `refusal`, with its link.
  def _ai_refused(refusal)
    render_json(AiClient.refusal_answer(refusal, @_ai_link(refusal)), 403)
  end
end
