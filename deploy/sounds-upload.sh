#!/usr/bin/env bash
#
# Uploads the built-in orchestra's banks (#1040) to the server, once: the
# files scripts/sounds/build.py made and the manifest in this checkout
# (public/soundfonts/orchestra.json) names. Run by hand, from the
# repository's root, when the manifest changes — a deploy never carries
# them (a hundred megabytes, not in git).
#
#   HOST=<the server> deploy/sounds-upload.sh
#   SCORE_SOUNDS_DIR=/data/sounds/dist HOST=… deploy/sounds-upload.sh
#
# Environment: HOST (the server; LOCAL=1 copies on this machine instead,
# for tests), DEPLOY_USER (rocky — not $USER: run by hand, that is whoever
# sits at this machine), SITES_DIR (/home/rocky/sites), DOMAIN
# (score.solisoft.net), SOUNDS_DIR (on the server: beside the sites,
# shared/<domain>/sounds), SCORE_SOUNDS_DIR (here:
# ~/.cache/score-sounds/dist).
#
# What it does:
#   1. checks every file here against the manifest's digest — a wrong or
#      missing one stops it before anything is sent;
#   2. rsyncs them into $SOUNDS_DIR (a file already there is not sent again:
#      a name carries its digest, a file never changes);
#   3. on the server, checks the digests again, then links into the live
#      release those its own manifest names — so the sounds are served at
#      once, whether this runs before or after the deploy that brings the
#      manifest. deploy/release.sh links them into every release after.
#
# Nothing is deleted on the server: a release to roll back to keeps its
# links. An old bank no manifest names can be removed from $SOUNDS_DIR by
# hand; the releases that link it keep their copy until they are pruned.
set -euo pipefail

SITES_DIR="${SITES_DIR:-/home/rocky/sites}"
DOMAIN="${DOMAIN:-score.solisoft.net}"
SOUNDS_DIR="${SOUNDS_DIR:-$(dirname "$SITES_DIR")/shared/$DOMAIN/sounds}"
from="${SCORE_SOUNDS_DIR:-$HOME/.cache/score-sounds/dist}"
manifest="public/soundfonts/orchestra.json"
[ -f "$manifest" ] || { echo "run from the repository's root: $manifest is not here" >&2; exit 1; }

list="$(mktemp)"
sums="$(mktemp)"
trap 'rm -f "$list" "$sums"' EXIT
python3 -c 'import json, sys
for i in json.load(open(sys.argv[1]))["instruments"]: print(i["sha256"] + "  " + i["file"])' "$manifest" > "$sums"
cut -d' ' -f3 "$sums" > "$list"
(cd "$from" && sha256sum -c --quiet "$sums") || { echo "the files in $from are not those the manifest names: scripts/sounds/build.py" >&2; exit 1; }
echo "$(wc -l < "$list" | tr -d ' ') banks, $(cd "$from" && du -ch $(cat "$list") | tail -1 | cut -f1), checked against the manifest"

if [ "${LOCAL:-0}" = "1" ]; then
  on_server() { bash -s -- "$@"; }
  target="$SOUNDS_DIR/"
  mkdir -p "$SOUNDS_DIR"
else
  : "${HOST:?the server: HOST=… deploy/sounds-upload.sh}"
  login="${DEPLOY_USER:-rocky}@$HOST"
  on_server() { ssh "$login" bash -s -- "$@"; }
  target="$login:$SOUNDS_DIR/"
  ssh "$login" "mkdir -p '$SOUNDS_DIR'"
fi

rsync -rt --partial --ignore-existing --files-from="$list" --info=progress2 "$from/" "$target"

# On the server: the digests once more, then the live release's links.
on_server "$SOUNDS_DIR" "$SITES_DIR/$DOMAIN" < <(cat <<'REMOTE'
set -euo pipefail
sounds="$1"
site="$2"
sums="$(mktemp)"
trap 'rm -f "$sums"' EXIT
cat > "$sums" <<'SUMS'
REMOTE
cat "$sums"
cat <<'REMOTE'
SUMS
(cd "$sounds" && sha256sum -c --quiet "$sums")
echo "on the server: $(wc -l < "$sums" | tr -d ' ') banks in $sounds, digests right"
manifest="$site/public/soundfonts/orchestra.json"
if [ ! -f "$manifest" ]; then
  echo "the live release has no manifest yet: the next deploy links the banks"
  exit 0
fi
mkdir -p "$site/public/soundfonts/orchestra"
linked=0
missing=0
while IFS= read -r file; do
  if [ -f "$sounds/$file" ]; then
    [ -f "$site/public/soundfonts/orchestra/$file" ] || ln "$sounds/$file" "$site/public/soundfonts/orchestra/$file" 2>/dev/null || cp -p "$sounds/$file" "$site/public/soundfonts/orchestra/$file"
    linked=$((linked + 1))
  else
    missing=$((missing + 1))
  fi
done < <(grep -oE '"file": *"[a-z0-9-]+\.[0-9a-f]{16}\.sf3"' "$manifest" | grep -oE '[a-z0-9-]+\.[0-9a-f]{16}\.sf3')
echo "live release: $linked banks served"
if [ "$missing" -gt 0 ]; then
  echo "$missing banks the live manifest names are not uploaded: it is another manifest than this checkout's (deploy, or upload from the commit that is live)"
fi
REMOTE
)
