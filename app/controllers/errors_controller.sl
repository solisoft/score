# The page of an address nothing answers (#1034): the last route of
# config/routes.sl takes every GET no other route took, so the 404 is a page
# of the site, in its layout, its language (/fr/… in French: the
# set_site_locale middleware has run) and with the visitor's own links.
# What the framework answers itself — a `find` miss, `forbidden()`, a
# failure — is app/views/errors/<status>.html.slv, the same card.
class ErrorsController < Controller
  # GET /*path — any address no other route answers: the 404 page
  def not_found
    @error_status = 404
    @title = SiteText.t("error_pages.e404.title")
    @description = SiteText.t("error_pages.e404.lede")
    @indexable = false
    @signed = !current_user().nil?
    render("errors/show", {}, {"status": 404})
  end

  # GET /error-pages/:status
  # GET /fr/error-pages/:status — routed in the test environment only: the
  # page the framework renders for that status, as a failure would get it
  def sample
    code = params["status"].to_i
    halt(404, "Not found") unless getenv("APP_ENV") == "test" && code >= 400 && code < 600

    ErrorPageSample.http_status = code
    throw ErrorPageSample.new("A sample of the #{code} page")
  end
end
