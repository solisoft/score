#!/usr/bin/env bash
#
# Upload this checkout into a release directory of its own on the server
# (#681), run from the repository's root by .github/workflows/deploy.yml.
# The live site is not touched: deploy/release.sh switches to it later.
#
#   deploy/upload.sh <release id>
#
# Environment: USER, HOST (the server; LOCAL=1 copies on this machine
# instead, for tests), SITES_DIR, DOMAIN, RELEASES_DIR (default: beside
# SITES_DIR, releases/<domain>).
#
# --link-dest: a file unchanged since the live release (the 38 MB of sounds,
# most of the app) is a hard link to it, not a second copy. --checksum,
# because a fresh checkout gives every file a new mtime. Hard links are safe:
# rsync and the deploy only ever replace a file, never write into one.
set -euo pipefail

id="${1:-}"
[[ "$id" =~ ^[0-9]{14}-[0-9A-Za-z._-]+$ ]] || { echo "usage: deploy/upload.sh <yyyymmddHHMMSS-commit>" >&2; exit 1; }
: "${SITES_DIR:?}" "${DOMAIN:?}"
RELEASES_DIR="${RELEASES_DIR:-$(dirname "$SITES_DIR")/releases/$DOMAIN}"
release="$RELEASES_DIR/$id"

if [ "${LOCAL:-0}" = "1" ]; then
  on_server() { bash -c "$1"; }
  target="$release/"
else
  : "${USER:?}" "${HOST:?}"
  on_server() { ssh "$USER@$HOST" "$1"; }
  target="$USER@$HOST:$release/"
fi

# A new directory every time: an id already there is refused, never reused.
on_server "set -e; mkdir -p '$RELEASES_DIR'; mkdir '$release'"

# The exclusions keep out what lives only on the server (carried over by
# release.sh) and what has no business there (the Rust crate, tests, agent
# notes). public/ is served as is: an agent note `soli update docs` writes
# back into public/js/ must never reach it (#544).
rsync -rlz --checksum --link-dest="$SITES_DIR/$DOMAIN/" \
  --exclude='.git/' --exclude='.github/' --exclude='.claude/' \
  --exclude='wasm/' --exclude='tests/' --exclude='coverage/' --exclude='tmp/' \
  --exclude='.env' --exclude='.env.*' --exclude='app.infos' --exclude='restart.txt' \
  --exclude='/public/js/CLAUDE.md' \
  ./ "$target"

echo "uploaded into $release"
