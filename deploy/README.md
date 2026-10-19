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
- No database: the site has no models.
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

## The browser engraver

`public/eui-score/` is built from the `eui-score` crate by `wasm/build.sh`
(needs the EUI checkout beside this one, the `wasm32-unknown-unknown`
target and `wasm-bindgen-cli` 0.2.126) and committed: rebuild it when the
engraver changes, and commit the three files.

## Locally

`proxy/sites/score.solisoft.test` links to this project and `app.infos`
here names it `score.solisoft.test`: soli-proxy serves it at
https://score.solisoft.test.
