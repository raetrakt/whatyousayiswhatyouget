#!/bin/bash

DIST_DIR="$HOME/kiosk"
PORT=8080
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# ── Kill any leftover processes from a previous session ─────────────────────
# Kill any Chrome instance using the kiosk profile (handles red-X close)
pkill -f "kiosk-chrome-profile" 2>/dev/null
sleep 1
# Kill any leftover server on the port
lsof -ti:$PORT | xargs kill -9 2>/dev/null

# ── System UI ────────────────────────────────────────────────────────────────
# Hide menu bar system-wide (takes effect immediately)
defaults write NSGlobalDomain _HIHideMenuBar -bool true
killall SystemUIServer

# ── Silence notifications (Do Not Disturb) ───────────────────────────────────
# Sequoia / Sonoma: Focus store
defaults -currentHost write com.apple.notificationcenterui doNotDisturb -bool true
# Legacy path (Ventura and earlier)
defaults write com.apple.notificationcenterui doNotDisturb -bool true
killall NotificationCenter 2>/dev/null

# Auto-hide dock; delay so long it effectively never appears on hover
defaults write com.apple.dock autohide -bool true
defaults write com.apple.dock autohide-delay -float 1000
defaults write com.apple.dock autohide-time-modifier -float 0
killall Dock
# Wait for Dock to fully restart with new settings before Chrome opens
sleep 2

# ── Prevent display sleep ────────────────────────────────────────────────────
caffeinate -d &
CAFFEINATE_PID=$!

# ── Start local HTTP server ──────────────────────────────────────────────────
cd "$DIST_DIR"
python3 -m http.server $PORT &>/dev/null &
SERVER_PID=$!

# Wait for server to be ready
sleep 1

# ── Launch Chrome in kiosk mode, auto-relaunch if closed ─────────────────────
# Closing Chrome once (red-X or Cmd+Q) auto-relaunches it, so accidental
# closes recover on their own. To QUIT: close Chrome twice in a row quickly
# (close it, wait for it to reopen, close it again within a few seconds).
QUIT_WINDOW=4   # seconds; a second close within this window quits

while true; do
  START=$(date +%s)
  "$CHROME" \
    --kiosk \
    --no-first-run \
    --disable-session-crashed-bubble \
    --disable-infobars \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    --user-data-dir=/tmp/kiosk-chrome-profile \
    "http://localhost:$PORT/dictionary/"
  ELAPSED=$(( $(date +%s) - START ))
  # If Chrome was closed again very soon after relaunching, treat as quit
  if [ "$ELAPSED" -lt "$QUIT_WINDOW" ]; then
    break
  fi
  sleep 1
done

# ── Cleanup after quit ───────────────────────────────────────────────────────
kill $SERVER_PID 2>/dev/null
kill $CAFFEINATE_PID 2>/dev/null

# Restore menu bar, notifications and dock to normal behaviour
defaults write NSGlobalDomain _HIHideMenuBar -bool false
killall SystemUIServer
defaults -currentHost write com.apple.notificationcenterui doNotDisturb -bool false
defaults write com.apple.notificationcenterui doNotDisturb -bool false
killall NotificationCenter 2>/dev/null
defaults write com.apple.dock autohide-delay -float 0.5
defaults write com.apple.dock autohide-time-modifier -float 0.5
killall Dock
