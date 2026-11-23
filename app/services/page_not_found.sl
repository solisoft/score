# A page that is not there (#1034), raised from an action: the request
# answers 404 with the site's error page (app/views/errors/404.html.slv), as
# a `find` miss does, where `halt(404, …)` answers a line of plain text.
# Its message is for the log of whoever reads the code, not for the page.
class PageNotFound < DomainError
  static http_status: Int = 404
end
