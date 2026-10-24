# Deploying score.solisoft.net

`.github/workflows/deploy.yml` verifies every push and pull request (fmt,
lint, boot, suite with ≥ 90 % coverage) and, on `main`, deploys to the
server through soli-proxy. The server is set up once, by hand.

## On the server (once)

```bash
mkdir -p /home/rocky/sites/score.solisoft.net
cd /home/rocky/sites/score.solisoft.net

cat > app.infos <<'INFOS'
name = "score"
domain = "score.solisoft.net"
start_script = "soli serve . --port $PORT --workers $WORKERS --strict-port"
workers = 2
stop_script = ""
health_check = "/health"
graceful_timeout = 30
port_range_start = 20000
port_range_end = 30000
INFOS

cat > .env <<'ENV'
APP_ENV=production
APP_URL=https://score.solisoft.net
SOLI_APP_HOSTS=score.solisoft.net
ENV
```

- DNS: `score.solisoft.net` → the server (soli-proxy gets the certificate).
- Soli on the server must be ≥ 2.26.0 (the `eui_score_*` builtins); the
  workflow pins and tests 2.28.2 and warns when the server differs.
- The app (`/app`: accounts, saved scores) needs SoliDB. Until the `.env`
  below names one, the site works and `/app` answers with its set-up page.
  To open it, create a database and a user on the server's SoliDB, then add:

  ```bash
  cat >> .env <<'ENV'
  SOLIDB_HOST=http://127.0.0.1:6745
  SOLIDB_DATABASE=score
  SOLIDB_USERNAME=score
  SOLIDB_PASSWORD=<its password>
  # Sessions go to the same SoliDB (config/application.sl), shared by both
  # workers and both slots. The secret still signs the app's cookies.
  SOLI_SESSION_SECRET=<openssl rand -hex 32>
  # Password reset and email confirmation mails.
  SOLI_MAIL_DELIVERY_METHOD=smtp
  SOLI_SMTP_HOST=…
  SOLI_SMTP_PORT=587
  SOLI_SMTP_USER=…
  SOLI_SMTP_PASS=…
  SOLI_SMTP_FROM=EUI Score <no-reply@solisoft.net>
  ENV
  ```

  The next deploy runs the migrations (`soli db:migrate up`) before it
  switches slots, then fails unless `/health/deep` answers 200 and `/app`
  answers 200 or a redirect to `/login`.

It is `/health/deep`, not `/health/ready`: soli-proxy answers `/health/ready` itself (a plain `OK`) before the request reaches the app, so a check there proves nothing about the database.

## Client addresses (the per-address limits)

The sign-in, sign-up and reset throttle (`AUTH_ATTEMPTS_PER_IP`, 15 in 5
minutes) and the account e-mails' limit (`AUTH_EMAILS_PER_IP`, 20 an hour)
count requests per client address (`client_ip(req)`, the rate limiter). The
app only sees soli-proxy, on `127.0.0.1`: **without the lines below, every
visitor is the same address**, and 15 sign-ins or 20 e-mails in the window
lock everyone out.

A request reaches the app through Cloudflare, then soli-proxy. Cloudflare
puts the visitor's address in `CF-Connecting-IP` (and appends it to
`X-Forwarded-For`); soli-proxy connects from `127.0.0.1`. So:

```bash
cat >> .env <<'ENV'
# Read forwarded headers, only from soli-proxy on this host.
SOLI_TRUST_PROXY=1
SOLI_TRUSTED_PROXIES=127.0.0.1,::1
# The visitor's address, as Cloudflare sends it (read before X-Forwarded-For).
SOLI_CLIENT_IP_HEADER=cf-connecting-ip
ENV
```

Then `soli-proxy restart -c /home/rocky/proxy.conf score`.

- `CF-Connecting-IP` is only as good as the guarantee that requests come
  through Cloudflare: a client reaching the server's address directly can set
  it to anything, and gets a fresh identity per request. Allow ports 80/443
  to Cloudflare's ranges only (https://www.cloudflare.com/ips/), or, if the
  site is ever served without Cloudflare, drop `SOLI_CLIENT_IP_HEADER`: the
  address is then the right-most `X-Forwarded-For` entry, the one soli-proxy
  adds.
- The counts live in each worker process's memory: a deploy or a restart
  starts them again, and with two workers a client may get up to twice the
  limit. The AI caps and the invitations' cap are kept in the database
  instead, and survive both.
- `prod-db.yml`'s `inspect` action reports the three as `<set>`/`<unset>`.

## Health, errors and alerts

- `/health` is liveness (the process answers; soli-proxy's slot check).
  `/health/deep` is readiness: 200 when the database answers a one-row read
  and no job waits more than 30 minutes past its time, else 503 with
  `{"status":"not ready","problems":[…]}` (`database not configured`,
  `database unreachable`, `job queue unreadable`, `N job(s) waiting past
  their time`). The details go to the site's log, not the page.
- `.github/workflows/uptime.yml` probes `/health/deep` every 15 minutes from
  GitHub; a failed run is mailed by GitHub to whoever receives Actions
  notifications for the repository (Settings › Notifications › Actions).
- Mail that fails to leave (confirmation, password reset, invitations) is
  logged as `[WARN] <purpose> email could not be sent error=…`.

The error tracker (`/__soli/errors`, also `/__soli/jobs` and
`/__soli/slow_queries`) records every 500 already, but answers 404 in
production until credentials are set, and nobody is told of a new error until
a destination is set. Add to the server's `.env`
(`/home/rocky/sites/score.solisoft.net/.env`), then redeploy or
`soli-proxy restart -c /home/rocky/proxy.conf score`:

```bash
cat >> .env <<'ENV'
# /__soli/errors, /__soli/jobs, /__soli/slow_queries: Basic auth for a
# browser, the token as "Authorization: Bearer …" for scripts.
SOLI_ADMIN_USER=ops
SOLI_ADMIN_PASSWORD=<openssl rand -hex 24>
SOLI_ADMIN_TOKEN=<openssl rand -hex 32>
# Who hears of a new, regressed or spiking error, or a new slow query.
# Either or both; comma-separated lists.
SOLI_NOTIFY_EMAILS=<your address>
SOLI_NOTIFY_WEBHOOKS=<a Slack / Teams / Discord / Google Chat incoming webhook URL>
# Optional: the sender (default SOLI_SMTP_FROM) and the links' base URL
# (default https:// + the first SOLI_APP_HOSTS).
SOLI_NOTIFY_FROM=EUI Score alerts <no-reply@solisoft.net>
SOLI_NOTIFY_URL=https://score.solisoft.net
ENV
chmod 600 .env
```

`SOLI_ERRORS_USER` / `SOLI_ERRORS_PASSWORD` / `SOLI_ERRORS_TOKEN` gate
`/__soli/errors` alone, if the jobs and slow-query pages should stay closed.
Notification e-mails go through the app's own SMTP settings (`SOLI_SMTP_*`
above). See `docs/observability.md` (Error tracking, Notifications).
Actions › production database › Run workflow › `inspect` reports which of
these are set (`<set>` / `<unset>`, never their values).
- The players' sounds, `public/soundfonts/MuseScore_General.sf3` (38 MB),
  are not in git: the workflow fetches them with `deploy/soundfont.sh`
  before its rsync. A local checkout runs that script once.

## On GitHub (once)

| Name | Kind | Value |
|---|---|---|
| `DEPLOY_HOST` | secret | the server's address |
| `SSH_DEPLOY_KEY` | secret | a private key allowed to log in as the deploy user |
| `SSH_KNOWN_HOSTS` | secret | `ssh-keyscan <host>` output |
| `DEPLOY_USER`, `DEPLOY_SITES_DIR`, `DEPLOY_PROXY_CONF`, `DEPLOY_DOMAIN`, `DEPLOY_APP` | variables | only if the defaults (`rocky`, `/home/rocky/sites`, `/home/rocky/proxy.conf`, `score.solisoft.net`, `score`) are wrong |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL` | `production` secrets | the Pro plan's payments (#393): `bin/stripe-setup` makes the product, prices and webhook in Stripe and sets these (the key with `--set-key`); Actions › production database › `stripe` puts them in the server's `.env` |

## Payments (the Pro plan)

Without `STRIPE_SECRET_KEY` and both prices the site works as before: the
Pricing page and the account show the plans, and Upgrade says payments are not
open yet. In order:

1. `STRIPE_SECRET_KEY=sk_live_… bin/stripe-setup --set-key` (from a checkout,
   with `gh` signed in): prints only `prod_…`, `price_…` and `we_…` ids, and
   sets the four secrets above. Run it again any time: it finds what it made.
   `--recreate-webhook` replaces the endpoint, and its secret, if that secret
   is lost.
2. Actions › production database › Run workflow › `stripe`: the four values go
   to the server's `.env` over SSH's input, the site restarts, and the step
   checks `/health/deep` and that `/webhooks/stripe` refuses an unsigned event.
3. In Stripe's dashboard: turn on the customer portal (Settings › Billing ›
   Customer portal), allowing cancellation and the switch between the two
   prices.

The prices shown on the site are in `app/services/plan.sl` (`PLAN_PRICES`),
the amounts Stripe charges in `bin/stripe-setup`: change both together.

## The browser engraver

`public/eui-score/` is built from the `eui-score` crate by `wasm/build.sh`
(needs the EUI checkout beside this one, the `wasm32-unknown-unknown`
target and `wasm-bindgen-cli` 0.2.126) and committed: rebuild it when the
engraver changes, and commit the three files.

## Locally

`proxy/sites/score.solisoft.test` links to this project and `app.infos`
here names it `score.solisoft.test`: soli-proxy serves it at
https://score.solisoft.test.
