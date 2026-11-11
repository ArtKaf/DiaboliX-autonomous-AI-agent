#!/bin/sh
set -eu
mkdir -p "$HOME"
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp -ac &
XVFB_PID=$!
trap 'kill "$XVFB_PID" 2>/dev/null || true; exit 0' TERM INT
sleep 1
openbox >/tmp/openbox.log 2>&1 &
xterm -fa 'DejaVu Sans Mono' -fs 12 -title 'DiaboliX workspace' -e sh -c 'cd /workspace; exec /bin/sh' >/tmp/xterm.log 2>&1 &
chromium --no-sandbox --disable-dev-shm-usage --disable-gpu --no-first-run --no-default-browser-check --disable-background-networking --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --user-data-dir=/tmp/chromium file:///workspace/ >/tmp/chromium.log 2>&1 &
wait "$XVFB_PID"
