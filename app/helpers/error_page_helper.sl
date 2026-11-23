# The error pages (#1034): which words and which figure a status gets.
# ErrorsController says the same of a 404 in a controller (helpers are not
# seen from controllers): change both together.

# The statuses with words of their own under `error_pages.` in the locales;
# any other 4xx reads `e4xx`, any other 5xx `e5xx`.
def error_page_key(status)
  code = status.to_i
  if [400, 401, 403, 404, 405, 408, 409, 410, 413, 422, 429, 500, 502, 503, 504].includes?(code)
    return "e#{code}"
  end

  code >= 500 ? "e5xx" : "e4xx"
end

# The engraved figure (app/views/errors/_figure_*.html.slv): a bar's rest
# for what the visitor asked, a wrong note for what failed here, the
# intermission while the site is away.
def error_page_figure(status)
  code = status.to_i
  return "rest" if code < 500
  return "break" if [502, 503, 504].includes?(code)

  "wrong"
end
