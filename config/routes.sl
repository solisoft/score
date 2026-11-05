# Routes of the eui-score site: a guide to the engraver, the syntax it reads,
# a gallery of engraved examples, how to embed it, and a playground.

# The browser engraver (public/eui-score/) is meant to be loaded by any
# site: a module script and the WebAssembly it fetches are CORS requests.
# So are the gallery's .ly sources, which `<eui-score src="…">` fetches.
cors(
  "/eui-score*",
  {"origins": "*", "methods": ["GET"]}
)
cors(
  "/s/*",
  {"origins": "*", "methods": ["GET"]}
)
cors(
  "/examples/*",
  {"origins": "*", "methods": ["GET"]}
)

get("/eui-score.js", "assets#element")
get("/eui-score-editor.js", "assets#editor")

get("/health", "home#health")
get("/health/deep", "home#ready")

# The site in English at /…, in French at /fr/… (#471): its pages and the
# account pages are declared twice, the second time without names — a
# route's name gives its English path, and `lp()` / SiteLocale.path put the
# /fr in front of it in French.
def site_page(path, action, name, named)
  if named
    get(path, action, name: name)
  else
    get(path, action)
  end
end

def site_routes(named)
  site_page("/", "home#index", "root", named)
  site_page("/guide", "pages#guide", "guide", named)
  site_page("/syntax", "pages#syntax", "syntax", named)
  site_page("/embed", "pages#embed", "embed", named)
  site_page("/limits", "pages#limits", "limits", named)
  site_page("/claude", "pages#claude", "claude", named)
  site_page("/changelog", "pages#changelog", "changelog", named)
  # The plans, Free and Pro (#393): what each allows, read from Plan.
  site_page("/pricing", "pages#pricing", "pricing", named)
  site_page("/examples", "examples#index", "examples", named)
  site_page("/examples/:category", "examples#category", "example_category", named)
  site_page("/examples/:category/:slug", "examples#show", "example", named)
end

def account_routes(named)
  site_page("/login", "sessions#new", "login", named)
  post("/login", "sessions#create")
  site_page("/login/code", "two_step#new", "login_code", named)
  post("/login/code", "two_step#create")
  site_page("/signup", "registrations#new", "signup", named)
  post("/signup", "registrations#create")
  site_page("/password/reset", "passwords#new", "password_reset", named)
  post("/password/reset", "passwords#create")
  site_page("/password/edit", "passwords#edit", "password_edit", named)
  post("/password/update", "passwords#update")
  site_page("/confirm_email", "confirmations#show", "confirm_email", named)
  site_page("/confirmation/resend", "confirmations#new", "confirmation_resend", named)
  post("/confirmation/resend", "confirmations#create")
  # A change of address, from the link mailed to the new one: signed in or not.
  site_page("/account/email", "email_changes#show", "confirm_email_change", named)
  post("/account/email", "email_changes#update")
end

site_routes(true)
get("/fr", "home#index")
namespace("fr", fn() { site_routes(false) })
get("/examples/:category/:slug/score.pdf", "examples#pdf", name: "example_pdf")
get("/examples/:category/:slug/preview.svg", "examples#preview", name: "example_preview")
get("/examples/:category/:slug/source.ly", "examples#source", name: "example_source")

get("/playground", "playground#show", name: "playground")

# The score-writing app: accounts and saved scores, in SoliDB.
# The room of a score open in the editor: who is there, and saves live.
# One fixed path: the ticket names the score (a dynamic segment in a
# websocket route is not matched by Soli 2.28).
router_websocket("/ws/scores", "score_room#handle")
# What the Content-Security-Policy refused, reported by browsers (#544):
# logged, with or without the app's database.
post("/csp-report", "csp_reports#create", name: "csp_report")
get("/app/setup", "app_setup#show", name: "app_setup")
middleware("require_app_database", fn() {
  get("/app", "app/home#index", name: "app_home")

  # Stripe's events (#393): public, proven by their signature, not by CSRF
  # (config/application.sl). They alone set the plan.
  post("/webhooks/stripe", "webhooks#stripe", name: "stripe_webhook")

  # A score's read page, by its link (SharedScoresController).
  get("/s/:token", "shared_scores#show", name: "shared_score")
  get("/s/:token/source.ly", "shared_scores#source")
  get("/s/:token/score.pdf", "shared_scores#pdf")
  # The read page's way into the score's room, to listen (#392).
  get("/s/:token/room_ticket", "shared_scores#room_ticket")

  # The MCP server (#460): Claude Code and other MCP clients, by a personal access token.
  post("/mcp", "mcp#handle", name: "mcp")
  get("/mcp", "mcp#stream")
  # OAuth 2.1 for MCP clients (#461, OauthServer): discovery, registration, codes, tokens.
  get("/.well-known/oauth-protected-resource", "oauth_server#protected_resource")
  get("/.well-known/oauth-protected-resource/mcp", "oauth_server#protected_resource")
  get("/.well-known/oauth-authorization-server", "oauth_server#authorization_server")
  post("/oauth/register", "oauth_server#register")
  get("/oauth/authorize", "oauth_server#authorize", name: "oauth_authorize")
  post("/oauth/token", "oauth_server#token")
  post("/oauth/revoke", "oauth_server#revoke")
  # The shared library of sections (#444): open to everyone to read.
  get("/sections", "sections#index", name: "sections")
  get("/sections/search.json", "sections#search", name: "sections_search")
  get("/sections/:id", "sections#show", name: "section")
  get("/sections/:id/data.json", "sections#data", name: "section_data")
  get("/sections/:id/preview.svg", "sections#preview", name: "section_preview")
  get("/sections/:id/play.mid", "sections#midi", name: "section_midi")

  # Accounts (generated by `soli generate auth`, in the app's layout), in
  # English and in French (#471).
  delete("/logout", "sessions#destroy", name: "logout")
  account_routes(true)
  namespace("fr", fn() { account_routes(false) })

  middleware("require_login", fn() {
    get("/app/account", "app/account#show", name: "app_account")
    post("/app/account/password", "app/account#password", name: "app_account_password")
    post("/app/account/two-step", "app/account#two_step", name: "app_account_two_step")
    post("/app/account/two-step/confirm", "app/account#confirm_two_step", name: "app_account_two_step_confirm")
    post("/app/account/two-step/stop", "app/account#stop_two_step", name: "app_account_two_step_stop")
    post("/app/account/ai", "app/account#ai_key", name: "app_account_ai")
    post("/app/account/ai/remove", "app/account#forget_ai_key", name: "app_account_ai_remove")
    # The consent page of an MCP client asking to connect (#461).
    get("/app/oauth/consent", "app/oauth#consent", name: "app_oauth_consent")
    post("/app/oauth/consent", "app/oauth#decide")
    post("/app/account/tokens", "app/account#create_token", name: "app_account_tokens")
    post("/app/account/tokens/:id/revoke", "app/account#revoke_token", name: "app_account_token_revoke")
    post("/app/account/notifications", "app/account#notifications", name: "app_account_notifications")
    post("/app/account/language", "app/account#language", name: "app_account_language")
    # Push notifications on a device (#400): AppPushController, JSON.
    post("/app/account/push", "app/account#push_prefs", name: "app_account_push")
    post("/app/push/subscriptions", "app/push#create", name: "app_push_subscriptions")
    post("/app/push/subscriptions/remove", "app/push#destroy", name: "app_push_subscriptions_remove")
    post("/app/push/test", "app/push#test", name: "app_push_test")
    post("/app/account/export", "app/account#download_data", name: "app_account_export")
    post("/app/account/email", "app/account#change_email", name: "app_account_email")
    post("/app/account/email/cancel", "app/account#cancel_email_change", name: "app_account_email_cancel")
    delete("/app/account", "app/account#destroy")
    # Paying for Pro (#393): to Stripe's Checkout and customer portal.
    post("/app/billing/checkout", "app/billing#checkout", name: "app_billing_checkout")
    post("/app/billing/portal", "app/billing#portal", name: "app_billing_portal")
    get("/app/billing/done", "app/billing#done", name: "app_billing_done")

    # What the app tells each person (#385): the bell, the list, read.
    get("/app/notifications", "app/notifications#index", name: "app_notifications")
    get("/app/notifications/unread", "app/notifications#unread", name: "app_notifications_unread")
    post("/app/notifications/read-all", "app/notifications#mark_all_read", name: "app_notifications_read_all")
    get("/app/notifications/:id/open", "app/notifications#visit", name: "app_notification_open")
    post("/app/notifications/:id/read", "app/notifications#mark_read", name: "app_notification_read")

    get("/app/scores", "app/scores#index", name: "app_scores")
    post("/app/scores", "app/scores#create")
    get("/app/trash", "app/scores#trash", name: "app_trash")
    post("/app/trash/empty", "app/scores#empty_trash", name: "app_trash_empty")
    post("/app/readings", "app/score_readings#create", name: "app_readings")
    get("/app/readings/:id", "app/score_readings#show", name: "app_reading")
    get("/app/readings/:id/events", "app/score_readings#events", name: "app_reading_events")
    # The photo imports, listed and followed (#465, #462).
    get("/app/imports", "app/score_readings#index", name: "app_imports")
    get("/app/imports/:id", "app/score_readings#watch", name: "app_import")
    post("/app/imports/:id/score", "app/score_readings#keep", name: "app_import_score")
    post("/app/imports/:id/retry", "app/score_readings#retry", name: "app_import_retry")
    post("/app/scores/:id/suggestions", "app/score_suggestions#create", name: "app_score_suggestions")
    get("/app/suggestions/:id", "app/score_suggestions#show", name: "app_suggestion")
    get("/app/scores/:id", "app/scores#show", name: "app_score")
    get("/app/scores/:id/room_ticket", "app/scores#room_ticket", name: "app_score_room_ticket")
    get("/app/scores/:id/preview.svg", "app/scores#preview", name: "app_score_preview")
    post("/app/scores/:id/rename", "app/scores#rename", name: "app_score_rename")
    post("/app/scores/:id/duplicate", "app/scores#duplicate", name: "app_score_duplicate")
    post("/app/scores/:id/leave", "app/scores#leave", name: "app_score_leave")
    post("/app/scores/:id/trash", "app/scores#move_to_trash", name: "app_score_trash")
    post("/app/scores/:id/restore", "app/scores#restore", name: "app_score_restore")
    delete("/app/scores/:id", "app/scores#destroy")
    put("/app/scores/:id", "app/scores#update")
    get("/app/scores/:id/share", "app/scores#share", name: "app_score_share")
    post("/app/scores/:id/share", "app/scores#update_sharing")
    post("/app/scores/:id/share/link", "app/scores#new_link", name: "app_score_new_link")
    post("/app/scores/:id/invitations", "app/scores#invite", name: "app_score_invitations")
    delete("/app/scores/:id/invitations/:share_id", "app/scores#uninvite", name: "app_score_invitation")
    post("/app/scores/:id/versions", "app/scores#keep_version", name: "app_score_keep_version")
    get("/app/scores/:id/versions", "app/scores#versions", name: "app_score_versions")
    get("/app/scores/:id/versions/:version_id", "app/scores#version", name: "app_score_version")
    post(
      "/app/scores/:id/versions/:version_id/restore",
      "app/scores#restore_version",
      name: "app_score_restore_version"
    )
    post("/app/scores/:id/versions/:version_id/copy", "app/scores#copy_version", name: "app_score_copy_version")

    # The audio tracks recorded from the microphone (#390), JSON and WAV: AppTakesController.
    get("/app/scores/:id/takes", "app/takes#index", name: "app_score_takes")
    post("/app/scores/:id/takes", "app/takes#create")
    get("/app/scores/:id/takes/:take_id/audio", "app/takes#audio", name: "app_score_take_audio")
    delete("/app/scores/:id/takes/:take_id", "app/takes#destroy")

    # Comments on a score's bars (#385), JSON: AppCommentsController.
    get("/app/scores/:id/comments", "app/comments#index", name: "app_score_comments")
    get("/app/scores/:id/people", "app/comments#people", name: "app_score_people")
    post("/app/scores/:id/comments", "app/comments#create")
    post("/app/scores/:id/comments/:thread_id/replies", "app/comments#reply")
    post("/app/scores/:id/comments/:thread_id/resolve", "app/comments#resolve")
    post("/app/scores/:id/comments/:thread_id/reopen", "app/comments#reopen")
    put("/app/scores/:id/comments/:thread_id/messages/:comment_id", "app/comments#update")
    delete("/app/scores/:id/comments/:thread_id/messages/:comment_id", "app/comments#destroy")

    # The shared library (#444): publishing from the editor (JSON); rating,
    # commenting, reporting and taking away from a section's page (forms).
    post("/app/sections", "app/sections#create", name: "app_sections")
    post("/app/sections/:id/import", "app/sections#add_to_score", name: "app_section_import")
    post("/app/sections/:id/rating", "app/sections#rate", name: "app_section_rating")
    post("/app/sections/:id/comments", "app/sections#comment", name: "app_section_comments")
    post(
      "/app/sections/:id/comments/:comment_id/remove",
      "app/sections#uncomment",
      name: "app_section_comment_remove"
    )
    post("/app/sections/:id/reports", "app/sections#report", name: "app_section_reports")
    post("/app/sections/:id/remove", "app/sections#remove", name: "app_section_remove")

    # An admin without two-step sign-in is sent here by `require_admin`
    # (#544): what to turn on, and where. Anyone else is answered 404.
    get("/admin/two-step", "admin/two_step#show", name: "admin_two_step")

    # The admin section (#399): the accounts, the plans, the payments.
    # Admins only (User#admin?), with two-step on: anyone else is answered 404.
    middleware("require_admin", fn() {
      get("/admin", "admin/dashboard#index", name: "admin")
      get("/admin/customers", "admin/customers#index", name: "admin_customers")
      get("/admin/customers/:id", "admin/customers#show", name: "admin_customer")
      post("/admin/customers/:id/gift", "admin/customers#gift", name: "admin_customer_gift")
      post("/admin/customers/:id/gift/stop", "admin/customers#stop_gift", name: "admin_customer_stop_gift")
      post("/admin/customers/:id/unlock", "admin/customers#unlock", name: "admin_customer_unlock")
      post("/admin/customers/:id/confirm", "admin/customers#confirm", name: "admin_customer_confirm")
      # A customer's score, read only (#626): each read kept as an AdminAction.
      get("/admin/customers/:id/scores/:score_id", "admin/customer_scores#show", name: "admin_customer_score")
      get(
        "/admin/customers/:id/scores/:score_id/versions/:version_id",
        "admin/customer_scores#version",
        name: "admin_customer_score_version"
      )
      get("/admin/payments", "admin/payments#index", name: "admin_payments")
      # The shared library's reports (#444).
      get("/admin/reports", "admin/reports#index", name: "admin_reports")
      post("/admin/reports/:id/hide", "admin/reports#hide", name: "admin_report_hide")
      post("/admin/reports/:id/show", "admin/reports#unhide", name: "admin_report_show")
      post("/admin/reports/:id/remove", "admin/reports#remove", name: "admin_report_remove")
      post("/admin/reports/:id/dismiss", "admin/reports#dismiss", name: "admin_report_dismiss")
      # What the admins did (#544).
      get("/admin/actions", "admin/actions#index", name: "admin_actions")
    })
  })
})
