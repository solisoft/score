#!/usr/bin/env bash
# Builds the browser module into public/eui-score/, where the site serves it
# and any page can load it. Needs the wasm32 target and wasm-bindgen 0.2.126:
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-bindgen-cli --version 0.2.126 --locked
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../public/eui-score"
cargo build --manifest-path "$here/Cargo.toml" --release --target wasm32-unknown-unknown
wasm-bindgen --target web --no-typescript --out-dir "$out" \
  "$here/target/wasm32-unknown-unknown/release/eui_score_web.wasm"
if command -v wasm-opt >/dev/null; then
  wasm-opt -Oz -o "$out/eui_score_web_bg.wasm" "$out/eui_score_web_bg.wasm"
fi
# The WebAssembly's own digest: the site's asset version is made from it
# and from the JavaScript (app/services/score_assets.sl).
sha256sum "$out/eui_score_web_bg.wasm" | cut -c1-16 > "$out/wasm.version"
ls -l "$out"
