# The framework's error page of any status, for the specs of the error
# pages (#1034): ErrorsController#sample sets the status and throws it, and
# the request answers with app/views/errors/<status>.html.slv. Routed in
# the test environment only.
class ErrorPageSample < DomainError
  static http_status: Int = 500
end
