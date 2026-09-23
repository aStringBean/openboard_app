#!/usr/bin/env bash
# Chrome ships Web Bluetooth disabled by default on Linux, and passing the flag
# to an already-running Chrome does nothing — the URL is just forwarded to the
# existing process. So this uses its own profile directory to guarantee a fresh
# instance that actually has the feature on. The profile persists, so the board
# stays paired between runs.
set -euo pipefail

URL="${1:-http://localhost:8080/prototypes/calibration-web/index.html}"
PROFILE="${OPENBOARD_CHROME_PROFILE:-$HOME/.cache/openboard-chrome-profile}"

for BROWSER in google-chrome-stable google-chrome chromium; do
  if command -v "$BROWSER" >/dev/null 2>&1; then
    echo "launching $BROWSER with Web Bluetooth enabled"
    echo "profile: $PROFILE"
    exec "$BROWSER" \
      --user-data-dir="$PROFILE" \
      --enable-features=WebBluetooth \
      --no-first-run \
      --no-default-browser-check \
      "$URL"
  fi
done

echo "no Chrome or Chromium found on PATH" >&2
exit 1
