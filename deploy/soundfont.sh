#!/usr/bin/env bash
# Fetches the players' sounds, MuseScore_General.sf3 (38 MB, MIT — see
# public/soundfonts/MuseScore_General_License.txt), into public/soundfonts/.
#
# Too heavy for git: the deploy workflow runs this before its rsync, and a
# local checkout runs it once. Does nothing when the file is already there
# and right.
set -euo pipefail

URL="https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3"
SHA256="5b85b6c2c61d10b2b91cddd41efcce7b25cd31c8271d511c73afafbef20b6fa3"
DEST="$(cd "$(dirname "$0")/.." && pwd)/public/soundfonts/MuseScore_General.sf3"

ok() { [ -f "$DEST" ] && echo "$SHA256  $DEST" | sha256sum -c --status; }

if ok; then
  echo "MuseScore_General.sf3 is there"
  exit 0
fi
curl -fsSL --retry 3 "$URL" -o "$DEST.part"
mv "$DEST.part" "$DEST"
ok || { rm -f "$DEST"; echo "MuseScore_General.sf3: checksum mismatch" >&2; exit 1; }
echo "MuseScore_General.sf3 fetched"
