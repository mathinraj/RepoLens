#!/usr/bin/env bash
# Package RepoLens-extension/ into one zip per store:
#   dist/repolens-<version>-chrome.zip  (Chrome Web Store)
#   dist/repolens-<version>-edge.zip    (Microsoft Edge Add-ons)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/RepoLens-extension"
OUT="$ROOT/dist"
STORES=(chrome edge)

VERSION="$(node -p "require('$SRC/manifest.json').version")"

echo "Running tests…"
for t in "$SRC"/shared/*.test.js; do
  node "$t" > /dev/null
done

if grep -rIl --exclude='*.min.js' --exclude='*.test.js' -E 'localhost|127\.0\.0\.1' "$SRC" > /dev/null; then
  echo "error: localhost reference found in extension source" >&2
  exit 1
fi

if ! grep -q "^  STORE: 'chrome',$" "$SRC/shared/constants.js"; then
  echo "error: expected \"  STORE: 'chrome',\" in shared/constants.js" >&2
  exit 1
fi

mkdir -p "$OUT"
rm -f "$OUT"/repolens-*.zip
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

for store in "${STORES[@]}"; do
  dir="$STAGE/$store"
  zip="$OUT/repolens-$VERSION-$store.zip"
  mkdir -p "$dir"
  (cd "$SRC" && tar cf - --exclude='*.test.js' --exclude='.DS_Store' --exclude='*.map' .) | (cd "$dir" && tar xf -)
  sed -i.bak "s/^  STORE: 'chrome',$/  STORE: '$store',/" "$dir/shared/constants.js" && rm "$dir/shared/constants.js.bak"
  (cd "$dir" && zip -qr -X "$zip" .)
  echo "Built $zip ($(du -h "$zip" | cut -f1))"
done
