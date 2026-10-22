# Whether the score-writing app (/app) can run: it keeps its accounts and
# scores in SoliDB, which the documentation site never needed. A server
# without SOLIDB_HOST in its .env serves the site and answers /app with a
# page saying so (AppSetupController), instead of failing on every query.
class AppSetup
  static def ready?
    AppSetup.configured?(getenv("SOLIDB_HOST"))
  end

  # The decision, apart from the environment, so a spec can take both ways.
  static def configured?(host)
    !host.blank?
  end
end
