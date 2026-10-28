#!/usr/bin/env bash
# Launch test for the release APK on a running Android emulator (used by
# .github/workflows/release.yml). Installs the APK, opens MatIQ, waits for the
# sign-in screen, opens sign-up, and fails on a crash or if nothing renders.
# Screenshots, the visible text and logcat go to the output folder; small
# JPEG previews are also printed to the log between BEGIN/END markers.
#
#   scripts/android-launch-test.sh <folder with the .apk> <output folder>
set -euo pipefail

apk=$(ls "$1"/*.apk | head -n 1)
out=$2
pkg=app.matiq.mobile
mkdir -p "$out"

ui_dump() {
  adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1 && adb pull /sdcard/ui.xml "$out/ui.xml" > /dev/null 2>&1
}

wait_for_text() { # <text> <seconds>
  local deadline=$((SECONDS + $2)) last_status=0
  while [ $SECONDS -lt $deadline ]; do
    if ui_dump; then
      grep -q "text=\"$1\"" "$out/ui.xml" && return 0
      # A slow CI emulator can show "<app> isn't responding" for the launcher.
      if grep -q 'text="Wait"' "$out/ui.xml"; then echo "  dismissing a system 'not responding' dialog"; tap_text "Wait" || true; fi
    fi
    if [ $((SECONDS - last_status)) -ge 15 ]; then status_line; last_status=$SECONDS; fi
    sleep 2
  done
  return 1
}

tap_text() { # taps the centre of the first element showing <text>
  local bounds
  bounds=$(grep -o "text=\"$1\"[^>]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"" "$out/ui.xml" | head -n 1 | grep -o '\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]')
  [ -n "$bounds" ] || return 1
  read -r x1 y1 x2 y2 <<< "$(echo "$bounds" | tr -c '0-9' ' ')"
  adb shell input tap $(((x1 + x2) / 2)) $(((y1 + y2) / 2))
}

shot() { # <name>: full screenshot plus a small preview in the log
  adb exec-out screencap -p > "$out/$1.png"
  local magick
  magick=$(command -v magick || command -v convert || true)
  if [ -n "$magick" ]; then
    echo "----- BEGIN SCREENSHOT $1 -----"
    "$magick" "$out/$1.png" -resize 300x -quality 55 jpg:- | base64 -w 120
    echo "----- END SCREENSHOT $1 -----"
  fi
}

visible_text() {
  grep -o 'text="[^"]\+"' "$out/ui.xml" | sed 's/^text="//; s/"$//' | head -n 40
}

status_line() { # what is in front, and is MatIQ alive
  local focus pid
  focus=$(adb shell dumpsys window 2> /dev/null | grep -m 1 -o 'mCurrentFocus=[^ ]* [^ ]* [^}]*' || true)
  pid=$(adb shell pidof "$pkg" 2> /dev/null || true)
  echo "  [$((SECONDS - started))s] ${focus:-no focus} | MatIQ pid: ${pid:-not running}"
}

crashed() {
  adb logcat -d > "$out/logcat.txt"
  grep -E "FATAL EXCEPTION|ReactNativeJS.*(Error|Exception)" "$out/logcat.txt" | head -n 20
}

started=$SECONDS
# System "not responding" dialogs for other apps would cover MatIQ on a slow emulator.
adb shell settings put global hide_error_dialogs 1 || true

echo "Installing $(basename "$apk")"
adb install -r -g "$apk"
adb logcat -c

echo "Opening MatIQ"
adb shell am start -W -n "$pkg/.MainActivity" | grep -E 'Status|TotalTime|WaitTime' || true
sleep 5
shot splash
status_line

status=0
if wait_for_text "Sign in" 180; then
  echo "Sign-in screen is showing:"
  visible_text
  shot sign-in
  if tap_text "Create an account" && wait_for_text "Create account" 30; then
    echo "Sign-up screen is showing:"
    visible_text
    shot sign-up
  else
    echo "::error::Could not open the sign-up screen"
    status=1
  fi
else
  echo "::error::The sign-in screen did not appear within 3 minutes"
  ui_dump || true
  echo "Visible text:"
  visible_text || true
  shot stuck
  echo "React Native log:"
  adb logcat -d -s ReactNative:V ReactNativeJS:V AndroidRuntime:E expo:V | tail -n 60 || true
  status=1
fi

if ! adb shell pidof "$pkg" > /dev/null; then
  echo "::error::MatIQ is not running any more"
  status=1
fi
if [ -n "$(crashed)" ]; then
  echo "::error::Crash or JavaScript error in logcat:"
  crashed
  status=1
fi

# The launcher icon, as people see it in the app drawer.
adb shell input keyevent KEYCODE_HOME
sleep 2
adb shell input swipe 540 1900 540 400 300
sleep 3
shot app-drawer

exit $status
