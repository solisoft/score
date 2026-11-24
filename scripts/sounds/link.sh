#!/usr/bin/env bash
# Puts the built-in orchestra's banks (#1040) where this checkout serves
# them, public/soundfonts/orchestra/ (not in git): the files the manifest
# (public/soundfonts/orchestra.json) names, from where scripts/sounds/build.py
# wrote them — as hard links when it can, copies when it cannot.
#
#   scripts/sounds/link.sh                       # from ~/.cache/score-sounds/dist
#   SCORE_SOUNDS_DIR=/data/sounds/dist scripts/sounds/link.sh
#
# A file's name carries its digest, and it is checked: a wrong file is not
# linked. Without the banks the players use the General MIDI sounds.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
from="${SCORE_SOUNDS_DIR:-$HOME/.cache/score-sounds/dist}"
to="$root/public/soundfonts/orchestra"
manifest="$root/public/soundfonts/orchestra.json"
[ -d "$from" ] || { echo "$from: no such directory — run scripts/sounds/build.py first" >&2; exit 1; }
mkdir -p "$to"

missing=0
while IFS=$'\t' read -r file sha; do
  if [ ! -f "$from/$file" ]; then
    echo "missing: $from/$file" >&2
    missing=1
    continue
  fi
  echo "$sha  $from/$file" | sha256sum -c --status || { echo "$file: not the file the manifest names" >&2; exit 1; }
  [ -f "$to/$file" ] || ln "$from/$file" "$to/$file" 2>/dev/null || cp "$from/$file" "$to/$file"
done < <(python3 -c 'import json,sys
for i in json.load(open(sys.argv[1]))["instruments"]: print(i["file"], i["sha256"], sep="\t")' "$manifest")

# What the manifest no longer names goes.
for old in "$to"/*.sf3; do
  [ -e "$old" ] || continue
  grep -qF "\"$(basename "$old")\"" "$manifest" || rm -f "$old"
done
echo "$(find "$to" -name '*.sf3' | wc -l) banks in public/soundfonts/orchestra/ ($(du -sh "$to" | cut -f1))"
exit $missing
