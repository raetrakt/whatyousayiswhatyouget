#!/bin/bash

DIST_DIR="$HOME/Desktop/dist"
PORT=8080
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# ── Kill any leftover server on the port ────────────────────────────────────
lsof -ti:$PORT | xargs kill -9 2>/dev/null

# ── System UI ────────────────────────────────────────────────────────────────
# Auto-hide dock (persists across reboots)
defaults write com.apple.dock autohide -bool true
# Make dock delay so long it effectively never appears on hover
defaults write com.apple.dock autohide-delay -float 1000
defaults write com.apple.dock autohide-time-modifier -float 0
killall Dock

# ── Prevent display sleep ────────────────────────────────────────────────────
caffeinate -d &
CAFFEINATE_PID=$!

# ── Start local HTTP server ──────────────────────────────────────────────────
cd "$DIST_DIR"
python3 -m http.server $PORT &>/dev/null &
SERVER_PID=$!

# Wait for server to be ready
sleep 1

# ── Launch Chrome in kiosk mode ──────────────────────────────────────────────
"$CHROME" \
  --kiosk \
  --no-first-run \
  --disable-session-crashed-bubble \
  --disable-infobars \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --user-data-dir=/tmp/kiosk-chrome-profile \
  "http://localhost:$PORT/dictionary/"

# ── Cleanup after Chrome exits ───────────────────────────────────────────────
kill $SERVER_PID 2>/dev/null
kill $CAFFEINATE_PID 2>/dev/null

# Restore dock to normal behaviour
defaults write com.apple.dock autohide-delay -float 0.5
defaults write com.apple.dock autohide-time-modifier -float 0.5
killall Dock
