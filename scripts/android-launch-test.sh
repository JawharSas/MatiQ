#!/usr/bin/env bash
# Launch test for the release APK on a running Android emulator (used by
# .github/workflows/release.yml). Installs the APK, opens MatIQ, waits for the
# sign-in screen, opens sign-up and scrolls to its end, and fails on a crash or
# if nothing renders.
# Accessibility on the real device: every tappable control on both screens
# must have a label for TalkBack, and the sign-in screen is checked at 200%
# font size and in landscape.
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

unlabelled_controls() { # tappable MatIQ elements with no text or description, on themselves or inside
  python3 - "$out/ui.xml" <<'PY'
import sys, xml.etree.ElementTree as ET
def labelled(node):
    if (node.get('text') or '').strip() or (node.get('content-desc') or '').strip():
        return True
    return any(labelled(child) for child in node)
for node in ET.parse(sys.argv[1]).getroot().iter('node'):
    if node.get('package') == 'app.matiq.mobile' and node.get('clickable') == 'true' and not labelled(node):
        print(f"  {node.get('class')} at {node.get('bounds')}")
PY
}

check_labels() { # <screen name>
  local missing
  missing=$(unlabelled_controls)
  if [ -n "$missing" ]; then
    echo "::error::Controls without a label for TalkBack on the $1 screen:"
    echo "$missing"
    status=1
  else
    echo "Every control on the $1 screen has a label."
  fi
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
  check_labels sign-in
  # uiautomator only lists what is on screen, so the form is checked in two
  # halves: the top (title, Google, fields) and, after scrolling, the bottom
  # (birth month, the "I agree" box, Create account and Cancel).
  if tap_text "Create an account" && wait_for_text "Create your account" 30; then
    echo "Sign-up screen is showing:"
    visible_text
    shot sign-up
    check_labels sign-up
    adb shell input swipe 540 1900 540 500 400
    sleep 1
    adb shell input swipe 540 1900 540 500 400
    if wait_for_text "Create account" 20; then
      echo "End of the sign-up form:"
      visible_text
      shot sign-up-end
      check_labels "sign-up (end of the form)"
    else
      echo "::error::The end of the sign-up form (Create account) did not appear"
      shot sign-up-stuck
      status=1
    fi
  else
    echo "::error::Could not open the sign-up screen"
    shot sign-up-stuck
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

# 200% font size (WCAG 1.4.4) and landscape (WCAG 1.3.4) on the sign-in screen.
if [ "$status" -eq 0 ]; then
  adb shell settings put system font_scale 2.0
  adb shell am force-stop "$pkg"
  adb shell am start -W -n "$pkg/.MainActivity" > /dev/null
  if wait_for_text "Sign in" 120 && grep -q 'text="Continue with Google"' "$out/ui.xml"; then
    echo "Sign-in screen at 200% font size:"
    visible_text
    shot sign-in-large-text
  else
    echo "::error::The sign-in screen did not render at 200% font size"
    shot large-text-stuck
    status=1
  fi
  adb shell settings put system font_scale 1.0
  adb shell settings put system accelerometer_rotation 0
  adb shell settings put system user_rotation 1
  sleep 4
  if ui_dump && grep -q 'text="Sign in"' "$out/ui.xml"; then
    echo "Sign-in screen in landscape:"
    shot sign-in-landscape
  else
    echo "::error::The sign-in screen did not render in landscape"
    status=1
  fi
  adb shell settings put system user_rotation 0
  sleep 2
fi

# The launcher icon, as people see it in the app drawer.
adb shell input keyevent KEYCODE_HOME
sleep 2
adb shell input swipe 540 1900 540 400 300
sleep 3
shot app-drawer

exit $status
