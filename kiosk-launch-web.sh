#!/bin/bash

URL="https://your-site.com"   # ← change this
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# ── Kill any leftover Chrome from a previous session ────────────────────────
pkill -f "kiosk-chrome-profile" 2>/dev/null
sleep 1

# ── System UI ────────────────────────────────────────────────────────────────
defaults write NSGlobalDomain _HIHideMenuBar -bool true
killall SystemUIServer

defaults write com.apple.dock autohide -bool true
defaults write com.apple.dock autohide-delay -float 1000
defaults write com.apple.dock autohide-time-modifier -float 0
killall Dock
sleep 2

# ── Silence notifications ────────────────────────────────────────────────────
defaults -currentHost write com.apple.notificationcenterui doNotDisturb -bool true
defaults write com.apple.notificationcenterui doNotDisturb -bool true
killall NotificationCenter 2>/dev/null

# ── Prevent display sleep ────────────────────────────────────────────────────
caffeinate -d &
CAFFEINATE_PID=$!

# ── Launch Chrome — close twice quickly to quit ──────────────────────────────
QUIT_WINDOW=4

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
    "$URL"
  ELAPSED=$(( $(date +%s) - START ))
  if [ "$ELAPSED" -lt "$QUIT_WINDOW" ]; then
    break
  fi
  sleep 1
done

# ── Cleanup ──────────────────────────────────────────────────────────────────
kill $CAFFEINATE_PID 2>/dev/null

defaults write NSGlobalDomain _HIHideMenuBar -bool false
killall SystemUIServer
defaults -currentHost write com.apple.notificationcenterui doNotDisturb -bool false
defaults write com.apple.notificationcenterui doNotDisturb -bool false
killall NotificationCenter 2>/dev/null
defaults write com.apple.dock autohide-delay -float 0.5
defaults write com.apple.dock autohide-time-modifier -float 0.5
killall Dock
