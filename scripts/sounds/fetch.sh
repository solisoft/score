#!/usr/bin/env bash
# Fetches what scripts/sounds/build.py makes the built-in orchestra from
# (#1040), into ~/.cache/score-sounds (3 GB of archives, 4 GB unpacked —
# never /tmp, never git):
#
#   - VSCO 2 Community Edition 1.1.0 (Versilian Studios, CC0 1.0);
#   - Salamander Grand Piano V3 (Alexander Holm, CC BY 3.0), at one commit;
#   - a Python environment with numpy and soundfile (libsndfile writes the
#     Ogg Vorbis of an SF3).
#
# The addresses and the checksums are scripts/sounds/catalog.py's: one place.
# Does nothing for what is already there and right.
#
#   scripts/sounds/fetch.sh            # then scripts/sounds/build.py
#   SCORE_SOUNDS_SRC=/data/sounds scripts/sounds/fetch.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="${SCORE_SOUNDS_SRC:-$HOME/.cache/score-sounds}"
mkdir -p "$root/src"

python3 - "$here" <<'PY' | while IFS=$'\t' read -r dir url sha; do
import sys
sys.path.insert(0, sys.argv[1])
from catalog import SOURCES
for s in SOURCES.values():
    print(s["dir"], s["url"], s["sha256"], sep="\t")
PY
  archive="$root/src/$dir.tar.gz"
  ok() { [ -f "$archive" ] && echo "$sha  $archive" | sha256sum -c --status; }
  if ! ok; then
    echo "fetching $url"
    curl -fL --retry 3 -o "$archive.part" "$url"
    mv "$archive.part" "$archive"
    ok || { echo "$archive: checksum mismatch" >&2; exit 1; }
  fi
  if [ ! -f "$root/$dir/.unpacked-$sha" ]; then
    rm -rf "${root:?}/$dir"
    mkdir -p "$root/$dir"
    tar -xzf "$archive" -C "$root/$dir" --strip-components=1
    touch "$root/$dir/.unpacked-$sha"
  fi
  echo "$dir is there"
done

if [ ! -x "$root/venv/bin/python" ]; then
  if command -v uv >/dev/null; then
    uv venv -q "$root/venv"
    uv pip install -q --python "$root/venv/bin/python" -r "$here/requirements.txt"
  else
    python3 -m venv "$root/venv"
    "$root/venv/bin/pip" install -q -r "$here/requirements.txt"
  fi
fi
echo "ready: $root/venv/bin/python scripts/sounds/build.py"
