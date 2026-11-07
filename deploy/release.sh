#!/usr/bin/env bash
#
# The server side of a deploy (#681), run on the server by
# .github/workflows/deploy.yml once the files are uploaded into a release
# directory of their own. Nothing here touches the live site until the
# migrations have passed, and a failure after the switch puts the previous
# release back.
#
# Layout (paths from the environment, defaults for score.solisoft.net):
#
#   $SITES_DIR/$DOMAIN    -> $RELEASES_DIR/<id>  (a symlink; soli-proxy and
#                                                  prod-db.yml use this path)
#   $RELEASES_DIR/<id>/                           one release: the app, plus a
#                                                  copy of app.infos and .env*
#   $BACKUP_DIR/<id>.jsonl.gz                     the database, just before
#                                                  that release's migrations
#
#   <id> is <UTC yyyymmddHHMMSS>-<commit>. The site of the old layout (a
#   real directory) becomes the release 00000000000000-before-releases on the
#   first deploy, swapped with the symlink in one atomic rename.
#
# Commands:
#   deploy <id>        carry app.infos/.env* from the live site into the
#                      release, check the server's soli, snapshot the
#                      database, run the migrations in the release, switch the
#                      symlink, `soli-proxy deploy` (idle slot started on the
#                      new release, health-checked, traffic moved, old slot
#                      stopped), check the site through the proxy; on a
#                      failure after the switch, back to the previous release.
#   rollback [<id>]    back to <id> (default: the newest release before the
#                      live one that has served), carrying the live .env*
#                      along. The database is not touched.
#   restore-db <file> --yes
#                      put a snapshot back into the site's database (drops
#                      and refills the collections it holds). By hand only.
#   status             the live release, the releases, the snapshots.
#
# DRY_RUN=1 prints what would change instead of changing it (the checks that
# only read still run). Tested by tests/deploy/release_test.sh.
set -euo pipefail

SITES_DIR="${SITES_DIR:-/home/rocky/sites}"
DOMAIN="${DOMAIN:-score.solisoft.net}"
APP="${APP:-score}"
PROXY_CONF="${PROXY_CONF:-/home/rocky/proxy.conf}"
RELEASES_DIR="${RELEASES_DIR:-$(dirname "$SITES_DIR")/releases/$DOMAIN}"
BACKUP_DIR="${BACKUP_DIR:-$(dirname "$SITES_DIR")/backups/$DOMAIN}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
KEEP_BACKUPS="${KEEP_BACKUPS:-10}"
MIN_FREE_MB="${MIN_FREE_MB:-1024}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-5}"
HEALTH_SLEEP="${HEALTH_SLEEP:-4}"
DRY_RUN="${DRY_RUN:-0}"
SOLI_VERSION="${SOLI_VERSION:-}"

SITE="$SITES_DIR/$DOMAIN"
# A copy of this script beside the releases, for rollback / restore-db / status
# by hand: it outlives any one release.
TOOL="$RELEASES_DIR/release.sh"
LEGACY_ID="00000000000000-before-releases"
# Written into a release once it has served: only those are rolled back to.
SERVED=".served"
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin"

say() { printf '%s\n' "$*"; }
fail() { printf '::error::%s\n' "$*" >&2; exit 1; }
dry() { [ "$DRY_RUN" = "1" ]; }
# A command that changes something: printed, not run, in a dry run.
run() {
  if dry; then
    say "[dry-run] $*"
  else
    "$@"
  fi
}

# A setting from an .env file, empty when absent. Never printed.
value() { { grep -E "^$1=" "$2" 2>/dev/null || true; } | tail -1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }

# The release the site points at: its directory, or empty for the old layout.
live_release() {
  if [ -L "$SITE" ]; then
    readlink "$SITE"
  fi
}

release_ids() {
  [ -d "$RELEASES_DIR" ] || return 0
  find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*-*' -exec basename {} \; \
    | grep -E '^[0-9]{14}-' | LC_ALL=C sort
}

# All lines of stdin but the last $1.
all_but_last() { awk -v keep="$1" '{ line[NR] = $0 } END { for (i = 1; i <= NR - keep; i++) print line[i] }'; }

has_database() { grep -qE '^SOLIDB_HOST=.+' "$1/.env"; }

# Point $SITE at the release directory $1 in one rename: the symlink is
# replaced, or — the first time — swapped with the old layout's directory
# (renameat2 RENAME_EXCHANGE), which then moves into the releases. soli-proxy
# never sees the site missing.
point_site_at() {
  local target="$1" next="$SITES_DIR/.$DOMAIN.next"
  if dry; then
    say "[dry-run] $SITE -> $target"
    return 0
  fi
  if [ -L "$next" ]; then rm -f "$next" || return 1; fi
  if [ -e "$next" ]; then
    say "::error::$next is in the way (a directory left by an interrupted switch?): move it aside by hand"
    return 1
  fi
  ln -s "$target" "$next" || return 1
  python3 - "$next" "$SITE" <<'PY' || { rm -f "$next"; return 1; }
import ctypes, os, sys
new, site = sys.argv[1], sys.argv[2]
if os.path.islink(site) or not os.path.lexists(site):
    os.replace(new, site)
    sys.exit(0)
libc = ctypes.CDLL(None, use_errno=True)
if sys.platform.startswith("linux"):
    done = libc.renameat2(-100, new.encode(), -100, site.encode(), 2)  # AT_FDCWD, RENAME_EXCHANGE
elif sys.platform == "darwin":
    done = libc.renamex_np(new.encode(), site.encode(), 2)  # RENAME_SWAP
else:
    sys.exit("no atomic exchange on " + sys.platform)
if done != 0:
    err = ctypes.get_errno()
    sys.exit("exchange failed: " + os.strerror(err))
PY
  if [ -d "$next" ] && [ ! -L "$next" ]; then
    if [ -e "$RELEASES_DIR/$LEGACY_ID" ]; then
      say "::error::$RELEASES_DIR/$LEGACY_ID exists already; the old site directory is left at $next"
      return 1
    fi
    mv "$next" "$RELEASES_DIR/$LEGACY_ID" || return 1
    touch "$RELEASES_DIR/$LEGACY_ID/$SERVED"
    say "the old layout's directory is now the release $LEGACY_ID"
  fi
}

# Can this filesystem swap a directory with a symlink atomically? Tried on
# two scratch entries beside the site before anything changes.
check_switch_possible() {
  local probe="$SITES_DIR/.$DOMAIN.probe" out
  rm -rf "$probe.dir" "$probe.link"
  mkdir "$probe.dir" && ln -s "$probe.dir" "$probe.link"
  out="$(python3 - "$probe.link" "$probe.dir" <<'PY' 2>&1
import ctypes, sys
libc = ctypes.CDLL(None, use_errno=True)
a, b = sys.argv[1].encode(), sys.argv[2].encode()
if sys.platform.startswith("linux"):
    done = libc.renameat2(-100, a, -100, b, 2)
elif sys.platform == "darwin":
    done = libc.renamex_np(a, b, 2)
else:
    done = -1
sys.exit(0 if done == 0 else 1)
PY
)" || { rm -rf "$probe.dir" "$probe.link"; fail "this filesystem cannot swap the site directory atomically: $out"; }
  rm -rf "$probe.dir" "$probe.link"
}

check_soli() {
  [ -n "$SOLI_VERSION" ] || fail "SOLI_VERSION is not set"
  local installed
  installed="$(soli --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
  say "soli on the server: ${installed:-none} — tested by this run: $SOLI_VERSION"
  [ "$installed" = "$SOLI_VERSION" ] && return 0
  fail "the server runs Soli ${installed:-none}, this run tested $SOLI_VERSION: nothing deployed. \
Install $SOLI_VERSION on the server first (deploy/README.md, \"Soli on the server\"): \
it is shared by every site there."
}

# The database, gzipped JSON lines, before the migrations touch it.
snapshot() {
  local release="$1" id="$2" env free host_url scheme hostport db_host db_port user database out records
  env="$release/.env"
  run mkdir -p "$BACKUP_DIR"
  run chmod 700 "$BACKUP_DIR"
  if [ -d "$BACKUP_DIR" ]; then
    free="$(df -Pm "$BACKUP_DIR" | awk 'NR == 2 { print $4 }')"
    say "free space beside the snapshots: ${free} MB (at least $MIN_FREE_MB needed)"
    [ "$free" -ge "$MIN_FREE_MB" ] || fail "less than $MIN_FREE_MB MB free for the database snapshot: nothing deployed"
  fi
  host_url="$(value SOLIDB_HOST "$env")"
  scheme="${host_url%%://*}"; hostport="${host_url#*://}"; hostport="${hostport%%/*}"
  db_host="${hostport%%:*}"; db_port="${hostport##*:}"; [ "$db_port" = "$db_host" ] && db_port=6745
  user="$(value SOLIDB_USERNAME "$env")"
  database="$(value SOLIDB_DATABASE "$env")"
  [ -n "$database" ] || fail "no SOLIDB_DATABASE in the .env: nothing deployed"
  out="$BACKUP_DIR/$id.jsonl.gz"
  if dry; then
    say "[dry-run] solidb-dump -d $database | gzip > $out"
  else
    # The password reaches solidb-dump through its environment, never argv.
    SOLIDB_PASSWORD="$(value SOLIDB_PASSWORD "$env")" \
      solidb-dump --scheme "$scheme" -H "$db_host" -P "$db_port" -u "$user" -d "$database" \
      | gzip -6 > "$out.part" || { rm -f "$out.part"; fail "the database snapshot failed: nothing deployed"; }
    gzip -t "$out.part" || { rm -f "$out.part"; fail "the database snapshot is not a valid gzip: nothing deployed"; }
    records="$(gunzip -c "$out.part" | wc -l | tr -d ' ')"
    [ "$records" -gt 0 ] || { rm -f "$out.part"; fail "the database snapshot is empty: nothing deployed"; }
    chmod 600 "$out.part"
    mv "$out.part" "$out"
    say "database snapshot: $out ($records records, $(du -h "$out" | cut -f1))"
  fi
  SNAPSHOT="$out"
  # The newest $KEEP_BACKUPS are kept.
  find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.jsonl.gz' 2>/dev/null | LC_ALL=C sort \
    | all_but_last "$KEEP_BACKUPS" | while read -r old; do run rm -f "$old"; done
  say "snapshots kept: $(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.jsonl.gz' 2>/dev/null | wc -l | tr -d ' '), \
$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1 || echo '?') in $BACKUP_DIR"
}

restore_hint() {
  [ -n "${SNAPSHOT:-}" ] || return 0
  say "::warning::The database is NOT restored automatically: the live site kept taking writes during the deploy, \
and a restore would erase them. If the migrations left it unusable, restore the snapshot taken just before them:"
  say "  ssh <user>@<host> '$TOOL restore-db $SNAPSHOT --yes'"
  say "  (any collection the snapshot holds is dropped and refilled; writes made since $(basename "$SNAPSHOT" .jsonl.gz) are lost)"
}

# The site, end to end through soli-proxy with its real hostname: /health
# (the process), /health/deep (its database, its jobs), pages and the engraver,
# and /app answering 200 or sending a visitor to /login.
site_answers() {
  local attempt code codes app ready base="https://$DOMAIN"
  if dry; then
    say "[dry-run] check $base through the proxy"
    return 0
  fi
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    sleep "$HEALTH_SLEEP"
    codes=""
    for path in /health /health/deep / /examples /eui-score/eui_score_web_bg.wasm; do
      code="$(curl -sk -m 8 --resolve "$DOMAIN:443:127.0.0.1" -o /dev/null -w '%{http_code}' "$base$path" || true)"
      codes="$codes${code:-000} "
    done
    app="$(curl -sk -m 8 --resolve "$DOMAIN:443:127.0.0.1" -o /dev/null -w '%{http_code} %{redirect_url}' "$base/app" || true)"
    ready="$(curl -sk -m 8 --resolve "$DOMAIN:443:127.0.0.1" "$base/health/deep" || true)"
    say "attempt $attempt: $codes| /app -> $app | ready: $ready"
    if [ "$codes" = "200 200 200 200 200 " ] && printf '%s' "$ready" | grep -q '"status":"ok"'; then
      case "$app" in
        "200 " | "302 "*/login* | "303 "*/login*) return 0 ;;
      esac
    fi
  done
  return 1
}

proxy_deploy() {
  run soli-proxy deploy -c "$PROXY_CONF" "$APP"
}

# After a failure past the switch: the previous release comes back, through
# the same blue-green path (its slot started, checked, then traffic moved).
roll_back_to() {
  local previous="$1"
  say "::group::back to $(basename "$previous")"
  if ! point_site_at "$previous"; then
    say "::error::$SITE could not be pointed back at $previous: do it by hand (ln -sfn, then soli-proxy deploy)"
  elif proxy_deploy && site_answers; then
    say "the previous release $(basename "$previous") serves again"
  else
    say "::error::the previous release did not come back cleanly either: \
ssh <user>@<host> 'soli-proxy logs -c $PROXY_CONF $APP' (the slot that served before a failed proxy deploy keeps serving)"
  fi
  say "::endgroup::"
}

prune_releases() {
  local live="$1" previous="$2"
  release_ids | all_but_last "$KEEP_RELEASES" | while read -r id; do
    [ "$RELEASES_DIR/$id" = "$live" ] && continue
    [ "$RELEASES_DIR/$id" = "$previous" ] && continue
    run rm -rf "${RELEASES_DIR:?}/$id"
  done
}

lock() {
  if command -v flock >/dev/null 2>&1 && ! dry; then
    mkdir -p "$RELEASES_DIR"
    exec 9> "$RELEASES_DIR/.lock"
    flock -n 9 || fail "another deploy holds $RELEASES_DIR/.lock"
  fi
}

cmd_deploy() {
  local id="${1:-}" release previous carried=()
  [ -n "$id" ] || fail "usage: release.sh deploy <release id>"
  [[ "$id" =~ ^[0-9]{14}-[0-9A-Za-z._-]+$ ]] || fail "not a release id: $id"
  release="$RELEASES_DIR/$id"
  lock
  [ -d "$release" ] || fail "$release is missing: upload the files first"
  [ -e "$SITE" ] || fail "$SITE is missing: the site is set up by hand once (deploy/README.md)"
  previous="$(live_release)"
  [ "$previous" != "$release" ] || fail "$id is already the live release"
  [ -f "$SITE/app.infos" ] && [ -f "$SITE/.env" ] \
    || fail "$SITE must hold app.infos and .env — see deploy/README.md"
  say "site: $SITE -> ${previous:-a directory (the layout before releases; switched over by this deploy)}"
  say "new release: $release"

  say "::group::checks"
  check_soli
  [ -n "$previous" ] || check_switch_possible
  say "::endgroup::"
  run install -m 0755 "$release/deploy/release.sh" "$TOOL"

  # What lives only on the server travels with each release: the proxy's
  # app.infos and the .env (prod-db.yml edits the live one; it is copied
  # again on the next deploy). Copies, not symlinks: a `mv .env.next .env`
  # in the site would otherwise replace a link with a file in one release.
  for f in "$SITE"/app.infos "$SITE"/.env "$SITE"/.env.*; do
    [ -f "$f" ] || continue
    run cp -p "$f" "$release/"
    carried+=("$(basename "$f")")
  done
  say "carried from the live site: ${carried[*]}"
  run rm -f "$release/public/js/CLAUDE.md"

  SNAPSHOT=""
  if has_database "$SITE"; then
    say "::group::database snapshot"
    snapshot "$SITE" "$id"
    say "::endgroup::"
    say "::group::migrations (in the new release; the live site still runs the previous code)"
    if dry; then
      say "[dry-run] (cd $release && soli db:migrate up)"
    elif ! (cd "$release" && soli db:migrate up); then
      say "::error::the migrations failed: the live site was not switched and still runs $(basename "${previous:-$SITE}")"
      restore_hint
      exit 1
    fi
    say "::endgroup::"
  else
    say "::notice::no SOLIDB_HOST in the server's .env: no snapshot, no migrations (/app shows its set-up page)"
  fi

  say "::group::switch"
  # soli-proxy has not been asked yet: whatever the symlink says, the running
  # slot still serves the previous code.
  point_site_at "$release" || fail "the switch to $id failed (above): check where $SITE points, then soli-proxy deploy"
  # The old layout's directory has just become a release.
  [ -n "$previous" ] || previous="$RELEASES_DIR/$LEGACY_ID"
  say "::endgroup::"

  say "::group::soli-proxy deploy (idle slot on the new release, health check, traffic moved, old slot stopped)"
  if ! proxy_deploy; then
    say "::error::soli-proxy could not start the new release (its traffic never moved)"
    say "::endgroup::"
    roll_back_to "$previous"
    restore_hint
    exit 1
  fi
  say "::endgroup::"

  say "::group::the site through the proxy"
  if ! site_answers; then
    say "::error::the site does not answer through the proxy, or is not ready"
    curl -sk -m 8 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/health/deep" >&2 || true
    say "::endgroup::"
    roll_back_to "$previous"
    restore_hint
    exit 1
  fi
  say "::endgroup::"

  run touch "$release/$SERVED"
  prune_releases "$release" "$previous"
  say "deployed $id (previous: $(basename "$previous")${SNAPSHOT:+, snapshot $SNAPSHOT})"
  say "to go back: ssh <user>@<host> '$TOOL rollback'  (code only; the database stays as it is)"
}

cmd_rollback() {
  local wanted="${1:-}" live target id
  lock
  live="$(live_release)"
  [ -n "$live" ] || fail "$SITE is not a release symlink yet: nothing to roll back to"
  if [ -n "$wanted" ]; then
    target="$RELEASES_DIR/$wanted"
  else
    target=""
    for id in $(release_ids); do
      [ "$RELEASES_DIR/$id" = "$live" ] && break
      [ -f "$RELEASES_DIR/$id/$SERVED" ] && target="$RELEASES_DIR/$id"
    done
  fi
  [ -n "$target" ] && [ -d "$target" ] || fail "no release to go back to (${wanted:-none older than $(basename "$live")})"
  [ "$target" != "$live" ] || fail "$(basename "$target") is already live"
  say "from $(basename "$live") back to $(basename "$target") (the database is not touched)"
  for f in "$live"/.env "$live"/.env.*; do
    [ -f "$f" ] && run cp -p "$f" "$target/"
  done
  point_site_at "$target" || fail "the switch to $(basename "$target") failed: nothing changed"
  proxy_deploy || { point_site_at "$live"; fail "soli-proxy could not start $(basename "$target"): $(basename "$live") is live again"; }
  site_answers || say "::warning::$(basename "$target") is live but the site does not answer as it should"
}

cmd_restore_db() {
  local file="${1:-}" confirm="${2:-}" env host_url scheme hostport db_host db_port database plain
  [ -f "$file" ] || fail "usage: release.sh restore-db <snapshot.jsonl.gz> --yes"
  [ "$confirm" = "--yes" ] || fail "restoring drops and refills the collections in $file: add --yes"
  env="$SITE/.env"
  has_database "$SITE" || fail "no SOLIDB_HOST in $env"
  host_url="$(value SOLIDB_HOST "$env")"
  scheme="${host_url%%://*}"; hostport="${host_url#*://}"; hostport="${hostport%%/*}"
  db_host="${hostport%%:*}"; db_port="${hostport##*:}"; [ "$db_port" = "$db_host" ] && db_port=6745
  database="$(value SOLIDB_DATABASE "$env")"
  plain="$(mktemp "${TMPDIR:-/tmp}/restore.XXXXXX")"
  RESTORE_TMP="$plain"
  trap 'rm -f "${RESTORE_TMP:-}"' EXIT
  chmod 600 "$plain"
  gunzip -c "$file" > "$plain"
  say "restoring $file into $database"
  SOLIDB_PASSWORD="$(value SOLIDB_PASSWORD "$env")" \
    run solidb-restore --scheme "$scheme" -H "$db_host" -P "$db_port" -u "$(value SOLIDB_USERNAME "$env")" \
    -i "$plain" -d "$database" --drop
  say "restored; restart the app: soli-proxy restart -c $PROXY_CONF $APP"
}

cmd_status() {
  say "site: $SITE -> $(live_release || true)"
  say "releases in $RELEASES_DIR:"
  local live id
  live="$(live_release || true)"
  for id in $(release_ids); do
    if [ "$RELEASES_DIR/$id" = "$live" ]; then
      say "  $id  (live)"
    elif [ -f "$RELEASES_DIR/$id/$SERVED" ]; then
      say "  $id  (served before: rollback target)"
    else
      say "  $id  (never served)"
    fi
  done
  say "snapshots in $BACKUP_DIR:"
  find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.jsonl.gz' 2>/dev/null | LC_ALL=C sort | sed 's/^/  /'
}

case "${1:-}" in
  deploy) shift; cmd_deploy "$@" ;;
  rollback) shift; cmd_rollback "$@" ;;
  restore-db) shift; cmd_restore_db "$@" ;;
  status) cmd_status ;;
  *) fail "usage: release.sh deploy <id> | rollback [<id>] | restore-db <file> --yes | status" ;;
esac
