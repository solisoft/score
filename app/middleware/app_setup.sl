# The score-writing app keeps its accounts and scores in SoliDB. On a server
# with no database configured, its routes answer with /app/setup, which says
# so, instead of failing on their first query. See AppSetup.

# order: 30
# scope_only: true

def require_app_database(req)
  return req if AppSetup.ready?

  redirect("/app/setup")
end
