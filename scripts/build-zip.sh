#!/usr/bin/env bash
# Package the extension into one zip per store:
#   dist/repolens-<version>-chrome.zip   (Chrome Web Store)       from RepoLens-extension/
#   dist/repolens-<version>-edge.zip     (Microsoft Edge Add-ons) from RepoLens-extension/
#   dist/repolens-<version>-firefox.zip  (Firefox Add-ons)        from RepoLens-firefox/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/RepoLens-extension"
FIREFOX="$ROOT/RepoLens-firefox"
OUT="$ROOT/dist"
STORES=(chrome edge)

VERSION="$(node -p "require('$SRC/manifest.json').version")"
FIREFOX_VERSION="$(node -p "require('$FIREFOX/manifest.json').version")"

if [[ "$VERSION" != "$FIREFOX_VERSION" ]]; then
  echo "error: version mismatch: RepoLens-extension is $VERSION, RepoLens-firefox is $FIREFOX_VERSION" >&2
  exit 1
fi

echo "Running tests…"
for t in "$SRC"/shared/*.test.js; do
  node "$t" > /dev/null
done

for dir in "$SRC" "$FIREFOX"; do
  if grep -rIl --exclude='*.min.js' --exclude='*.test.js' -E 'localhost|127\.0\.0\.1' "$dir" > /dev/null; then
    echo "error: localhost reference found in $(basename "$dir")" >&2
    exit 1
  fi
done

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

zip="$OUT/repolens-$VERSION-firefox.zip"
(cd "$FIREFOX" && zip -qr -X "$zip" . -x '*.DS_Store' -x '*.test.js' -x '*.map')
echo "Built $zip ($(du -h "$zip" | cut -f1))"
