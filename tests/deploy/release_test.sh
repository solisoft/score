#!/usr/bin/env bash
#
# deploy/upload.sh + deploy/release.sh against a server simulated in a temp
# directory (#681): a site of the old layout (a real directory), releases,
# the symlink switch, and every failure — a migration, soli-proxy, the site
# check, a soli of the wrong version — with soli, soli-proxy, solidb-dump and
# curl replaced by stubs that log what they were asked.
#
#   bash tests/deploy/release_test.sh
#
# Run in CI by the `deploy scripts` job of .github/workflows/deploy.yml.
#
# The conditions are strings `check` evals: shellcheck cannot see the
# variables they read.
# shellcheck disable=SC2034
set -uo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/release-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT

passed=0
failed=0
ok() { passed=$((passed + 1)); printf '  ok   %s\n' "$1"; }
# A failure shows the end of what the scripts said last.
ko() { failed=$((failed + 1)); printf '  FAIL %s\n' "$1"; tail -15 "$work/out" 2>/dev/null | sed 's/^/       | /'; }
# check <what> <condition>: $last in the condition is the status of the
# command run just before.
check() { local last=$?; if eval "$2"; then ok "$1"; else ko "$1"; fi; }

# --- the stubs -------------------------------------------------------------
stubs="$work/bin"
mkdir -p "$stubs"
log="$work/calls.log"

cat > "$stubs/soli" <<'SH'
#!/usr/bin/env bash
case "$1" in
  --version) echo "Soli ${STUB_SOLI_VERSION:-2.32.0}" ;;
  db:migrate)
    echo "migrate in $(pwd)" >> "$STUB_LOG"
    [ -f "$(pwd)/MIGRATION_FAILS" ] && { echo "migration 20261107_x failed" >&2; exit 1; }
    echo "migrations: up to date" ;;
  *) exit 2 ;;
esac
SH

cat > "$stubs/soli-proxy" <<'SH'
#!/usr/bin/env bash
# The site's symlink as the proxy would start the idle slot from it.
echo "proxy $1 -> $(readlink "$STUB_SITE")" >> "$STUB_LOG"
if [ -f "$STUB_SITE/PROXY_FAILS" ]; then
  echo "health check never passed" >&2
  exit 1
fi
echo "score deployed successfully"
SH

cat > "$stubs/solidb-dump" <<'SH'
#!/usr/bin/env bash
echo "dump argv: $*" >> "$STUB_LOG"
[ "${SOLIDB_PASSWORD:-}" = "s3cret-db-pass" ] || { echo "no password in the environment" >&2; exit 1; }
[ -n "${STUB_DUMP_FAILS:-}" ] && exit 1
printf '{"_type":"collection","_collection":"users"}\n{"_collection":"users","_key":"1"}\n'
SH

# What the proxy answers: the live release decides (a BROKEN file in it).
cat > "$stubs/curl" <<'SH'
#!/usr/bin/env bash
format=""
while [ $# -gt 0 ]; do
  case "$1" in -w) format="$2"; shift ;; esac
  shift
done
broken=""
[ -f "$STUB_SITE/BROKEN" ] && broken=1
case "$format" in
  "%{http_code}") if [ -n "$broken" ]; then printf 503; else printf 200; fi ;;
  "%{http_code} %{redirect_url}") printf '302 https://score.example/login' ;;
  *) if [ -n "$broken" ]; then printf '{"status":"not ready"}'; else printf '{"status":"ok"}'; fi ;;
esac
SH
chmod +x "$stubs"/*

# --- a server of the old layout -------------------------------------------
server="$work/home"
sites="$server/sites"
site="$sites/score.example"
releases="$server/releases/score.example"
backups="$server/backups/score.example"
mkdir -p "$site/app" "$site/public"
echo 'name = "score"' > "$site/app.infos"
printf 'APP_ENV=production\nSOLIDB_HOST=http://127.0.0.1:6745\nSOLIDB_DATABASE=score\nSOLIDB_USERNAME=admin\nSOLIDB_PASSWORD=s3cret-db-pass\n' > "$site/.env"
cp "$site/.env" "$site/.env.before-db"
echo "old code" > "$site/app/version.txt"
head -c 200000 /dev/zero > "$site/public/sounds.sf3"

# A checkout to deploy: what CI has after actions/checkout.
checkout="$work/checkout"
make_checkout() {
  rm -rf "$checkout"
  mkdir -p "$checkout/app" "$checkout/public/js" "$checkout/deploy" "$checkout/tests" "$checkout/db"
  cp "$repo/deploy/release.sh" "$repo/deploy/upload.sh" "$checkout/deploy/"
  echo "$1" > "$checkout/app/version.txt"
  head -c 200000 /dev/zero > "$checkout/public/sounds.sf3"
  echo "agent note" > "$checkout/public/js/CLAUDE.md"
  echo 'name = "local"' > "$checkout/app.infos"
  echo "LOCAL=1" > "$checkout/.env"
  echo "spec" > "$checkout/tests/x_spec.sl"
}

env_common=(PATH="$stubs:$PATH" STUB_LOG="$log" STUB_SITE="$site"
  SITES_DIR="$sites" DOMAIN="score.example" APP="score" PROXY_CONF="$server/proxy.conf"
  SOLI_VERSION="2.32.0" HEALTH_SLEEP=0 HEALTH_ATTEMPTS=2 MIN_FREE_MB=1)

n=0
# Sets $id to a new release id.
next_id() {
  n=$((n + 1))
  id="$(printf '2026110712%04d-c0ffee%02d' "$n" "$n")"
}

upload() { (cd "$checkout" && env "${env_common[@]}" LOCAL=1 bash deploy/upload.sh "$1") > "$work/out" 2>&1; }
# release <command…>; deploy <id> [VAR=value…] (extra environment)
release() { env "${env_common[@]}" bash "$repo/deploy/release.sh" "$@" > "$work/out" 2>&1; }
deploy() {
  local id="$1"
  shift
  env "${env_common[@]}" "$@" bash "$repo/deploy/release.sh" deploy "$id" > "$work/out" 2>&1
}
live() { basename "$(readlink "$site")"; }
inode() { ls -di "$1" | awk '{ print $1 }'; }
calls() { grep -c "$1" "$log" 2>/dev/null || true; }
said() { grep -q -- "$1" "$work/out"; }

# --- 1. the first deploy, from the old layout --------------------------------
echo "first deploy: the old layout's directory becomes a release"
make_checkout "v1"
next_id
r1="$id"
upload "$r1"
check "uploaded into its own release" '[ -f "$releases/$r1/app/version.txt" ]'
check "tests/, .env, app.infos and the agent note are not uploaded" \
  '[ ! -e "$releases/$r1/tests" ] && [ ! -e "$releases/$r1/app.infos" ] && [ ! -e "$releases/$r1/public/js/CLAUDE.md" ] && ! grep -q LOCAL "$releases/$r1/.env" 2>/dev/null'
check "an unchanged file is a hard link to the live one, not a copy" \
  '[ "$(inode "$releases/$r1/public/sounds.sf3")" = "$(inode "$site/public/sounds.sf3")" ]'
check "the live site is untouched by the upload" '[ "$(cat "$site/app/version.txt")" = "old code" ] && [ ! -L "$site" ]'
check "an id already uploaded is refused" '! upload "$r1"'
: > "$log"
deploy "$r1"
check "deploy succeeds" '[ $last = 0 ]'
check "the site is now a symlink to the release" '[ -L "$site" ] && [ "$(live)" = "$r1" ]'
check "the site path still serves the new code" '[ "$(cat "$site/app/version.txt")" = "v1" ]'
check "the old directory is kept as a release, served before" \
  '[ "$(cat "$releases/00000000000000-before-releases/app/version.txt")" = "old code" ] && [ -f "$releases/00000000000000-before-releases/.served" ]'
check "nothing is left beside the site" '[ -z "$(ls -A "$sites" | grep -v "^score.example$")" ]'
check "app.infos and every .env carried into the release" \
  'cmp -s "$releases/$r1/.env" "$releases/00000000000000-before-releases/.env" && [ -f "$releases/$r1/.env.before-db" ] && [ -f "$releases/$r1/app.infos" ]'
check "the migrations ran in the new release, before the proxy deploy" \
  '[ "$(grep -n "" "$log" | grep -E "migrate in .*/$r1$" | cut -d: -f1)" -lt "$(grep -n "" "$log" | grep "proxy deploy -> .*/$r1$" | cut -d: -f1)" ]'
check "one proxy deploy, no second restart" '[ "$(calls "^proxy")" = 1 ]'
check "a snapshot named after the release, private" \
  '[ -f "$backups/$r1.jsonl.gz" ] && [ "$(gunzip -c "$backups/$r1.jsonl.gz" | wc -l | tr -d " ")" = 2 ] && [ "$(ls -l "$backups/$r1.jsonl.gz" | cut -c1-10)" = "-rw-------" ]'
check "the database password never on a command line or in the log" \
  '! grep -q s3cret "$log" && ! grep -q s3cret "$work/out"'
check "the release is marked as served, the tool installed beside the releases" \
  '[ -f "$releases/$r1/.served" ] && [ -x "$releases/release.sh" ]'

# --- 2. a .env edit on the live site travels to the next release -----------
echo "second deploy: symlink to symlink, the live .env carried along"
printf 'SOLI_CSRF_TOKENS=require\n' >> "$site/.env"   # as prod-db.yml does, through the site path
make_checkout "v2"
next_id
r2="$id"
upload "$r2"
check "the upload links against the live release through the symlink" \
  '[ "$(inode "$releases/$r2/public/sounds.sf3")" = "$(inode "$releases/$r1/public/sounds.sf3")" ]'
deploy "$r2"
check "deploy succeeds" '[ $last = 0 ] && [ "$(live)" = "$r2" ]'
check "the edit made through the site path is in the new release" 'grep -q SOLI_CSRF_TOKENS "$releases/$r2/.env"'

# --- 3. a failed migration: no switch -----------------------------------------
echo "a failed migration leaves the live site alone"
make_checkout "v3"
touch "$checkout/MIGRATION_FAILS"
next_id
r3="$id"
upload "$r3"
: > "$log"
deploy "$r3"
check "deploy fails" '[ $last != 0 ]'
check "the site still points at the previous release" '[ "$(live)" = "$r2" ]'
check "soli-proxy was never called" '[ "$(calls "^proxy")" = 0 ]'
check "the snapshot was taken before, and the log says how to restore it" \
  '[ -f "$backups/$r3.jsonl.gz" ] && said "restore-db $backups/$r3.jsonl.gz --yes" && said "NOT restored automatically"'
check "the failed release is not marked as served" '[ ! -f "$releases/$r3/.served" ]'

# --- 4. soli-proxy cannot start the new release ------------------------------
echo "soli-proxy refuses the new release: back to the previous one"
make_checkout "v4"
touch "$checkout/PROXY_FAILS"
next_id
r4="$id"
upload "$r4"
: > "$log"
deploy "$r4"
check "deploy fails" '[ $last != 0 ]'
check "the site points at the previous release again" '[ "$(live)" = "$r2" ]'
check "the previous release was deployed again through the proxy" \
  '[ "$(calls "proxy deploy -> .*/$r4$")" = 1 ] && [ "$(calls "proxy deploy -> .*/$r2$")" = 1 ]'
check "the log says the previous release serves again" 'said "serves again"'

# --- 5. the new release starts but the site check fails ----------------------
echo "the site does not answer after the switch: back to the previous one"
make_checkout "v5"
touch "$checkout/BROKEN"
next_id
r5="$id"
upload "$r5"
: > "$log"
deploy "$r5"
check "deploy fails" '[ $last != 0 ]'
check "the site points at the previous release again" '[ "$(live)" = "$r2" ] && [ ! -f "$site/BROKEN" ]'
check "the previous release came back through the proxy" '[ "$(calls "proxy deploy -> .*/$r2$")" = 1 ]'
check "the log says how to restore the snapshot" 'said "restore-db $backups/$r5.jsonl.gz --yes"'

# --- 6. the server runs another soli -----------------------------------------
echo "a soli of another version on the server stops the deploy before anything"
make_checkout "v6"
next_id
r6="$id"
upload "$r6"
: > "$log"
before="$(ls "$backups" | wc -l)"
deploy "$r6" STUB_SOLI_VERSION=2.31.0
check "deploy fails" '[ $last != 0 ]'
check "it says which versions" 'said "runs Soli 2.31.0, this run tested 2.32.0"'
check "no snapshot, no migration, no switch" \
  '[ "$(ls "$backups" | wc -l)" = "$before" ] && [ "$(calls migrate)" = 0 ] && [ "$(live)" = "$r2" ]'

# --- 7. a snapshot that fails --------------------------------------------------
echo "a failed snapshot stops the deploy before the migrations"
: > "$log"
deploy "$r6" STUB_DUMP_FAILS=1
check "deploy fails, nothing migrated, nothing switched, no partial file" \
  '[ $last != 0 ] && [ "$(calls migrate)" = 0 ] && [ "$(live)" = "$r2" ] && [ ! -e "$backups/$r6.jsonl.gz.part" ]'

# --- 8. a dry run changes nothing ---------------------------------------------
echo "a dry run changes nothing"
make_checkout "v6b"
next_id
r6="$id"
upload "$r6"
: > "$log"
before="$(ls "$backups" | wc -l)"
deploy "$r6" DRY_RUN=1
check "dry run succeeds" '[ $last = 0 ]'
check "it lists the changes it would make" 'said "\[dry-run\] .*score.example -> .*$r6" && said "\[dry-run\] solidb-dump"'
check "no switch, no snapshot, no migration, no proxy, nothing carried" \
  '[ "$(live)" = "$r2" ] && [ "$(ls "$backups" | wc -l)" = "$before" ] && [ ! -s "$log" ] && [ ! -e "$releases/$r6/.env" ]'

# --- 9. refusals ----------------------------------------------------------------
echo "refusals"
deploy "$r2"
check "the live release cannot be deployed again" '[ $last != 0 ] && said "already the live release"'
deploy "20261107000000-nothere"
check "a release that was not uploaded is refused" '[ $last != 0 ] && said "upload the files first"'
deploy "../../etc"
check "an id that is not a release id is refused" '[ $last != 0 ] && said "not a release id"'

# --- 10. a site without a database: no snapshot, no migrations ----------------
echo "a site without a database"
grep -v SOLIDB_HOST "$site/.env" > "$site/.env.next" && mv "$site/.env.next" "$site/.env"
make_checkout "v7"
next_id
r7="$id"
upload "$r7"
: > "$log"
deploy "$r7"
check "deploy succeeds, no dump, no migration" '[ $last = 0 ] && [ "$(live)" = "$r7" ] && [ "$(calls dump)" = 0 ] && [ "$(calls migrate)" = 0 ]'
printf 'SOLIDB_HOST=http://127.0.0.1:6745\n' >> "$site/.env"

# --- 11. pruning ----------------------------------------------------------------
echo "only the newest releases and snapshots are kept"
for v in 8 9 10; do
  make_checkout "v$v"
  next_id
id="$id"
  upload "$id"
  deploy "$id" KEEP_RELEASES=3 KEEP_BACKUPS=2
done
check "the last deploy succeeds" '[ $last = 0 ] && [ "$(live)" = "$id" ]'
check "3 releases kept" '[ "$(find "$releases" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d " ")" = 3 ]'
check "2 snapshots kept, the newest" '[ "$(ls "$backups" | wc -l | tr -d " ")" = 2 ] && [ -f "$backups/$id.jsonl.gz" ]'

# --- 12. rollback by hand ---------------------------------------------------------
echo "rollback by hand"
live_before="$(live)"
printf 'LATEST_SECRET=1\n' >> "$site/.env"
: > "$log"
release rollback
check "rollback succeeds" '[ $last = 0 ]'
check "back to the release served before" '[ "$(live)" != "$live_before" ] && [ -f "$releases/$(live)/.served" ]'
check "the live .env came along" 'grep -q LATEST_SECRET "$releases/$(live)/.env"'
check "through the proxy" '[ "$(calls "^proxy")" = 1 ]'
release status
check "status lists the live release" 'said "$(live)  (live)"'

echo
echo "$passed passed, $failed failed"
[ "$failed" = 0 ]
