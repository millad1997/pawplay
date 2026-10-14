#!/usr/bin/env bash
# Capture App Store screenshots of the real app in the iOS Simulator.
# Uses the debug-only `-shot <screen>-<game>` launch argument (see ios/PounceParty/GameWebView.swift).
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${DEVELOPER_DIR:-}" && "$(xcode-select -p)" == *CommandLineTools* ]]; then
  export DEVELOPER_DIR="$(ls -d /Applications/Xcode*.app | sort | tail -1)/Contents/Developer"
fi

derived="${DERIVED_DATA:-ios/build/screenshots-dd}"
app="$derived/Build/Products/Debug-iphonesimulator/PounceParty.app"
xcodebuild -quiet -project ios/PounceParty.xcodeproj -scheme PounceParty -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$derived" build

# folder | simulator name
devices=(
  "iphone-6.9|iPhone 17 Pro Max"
  "iphone-6.3|iPhone 17 Pro"
  "ipad-13|iPad Pro 13-inch (M5)"
)
# file name | shot | seconds to wait
# Home goes last so it shows the "Last game" line left by the finish shot.
shots=(
  "1-fish|play-fish|18"
  "2-mouse|play-mouse|18"
  "3-butterfly|play-butterfly|18"
  "5-setup|setup-mouse|7"
  "6-finish|finish-butterfly|7"
  "4-home|home-fish|7"
)

for device in "${devices[@]}"; do
  folder="${device%%|*}"
  name="${device#*|}"
  [[ -n "${ONLY:-}" && "$ONLY" != "$folder" ]] && continue # e.g. ONLY=ipad-13
  udid=$(xcrun simctl list devices available -j | python3 -c "
import json, sys
name = sys.argv[1]
for runtime, devs in json.load(sys.stdin)['devices'].items():
    for d in devs:
        if d['name'] == name:
            print(d['udid']); raise SystemExit
" "$name")
  echo "== $name ($udid)"
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b >/dev/null
  sleep 10 # let first-boot banners and the display settle
  xcrun simctl ui "$udid" appearance light
  xcrun simctl uninstall "$udid" com.pounceparty.app 2>/dev/null || true
  xcrun simctl install "$udid" "$app"
  rm -rf "appstore/screenshots/$folder"
  mkdir -p "appstore/screenshots/$folder"
  for s in "${shots[@]}"; do
    IFS='|' read -r file shot wait <<<"$s"
    xcrun simctl terminate "$udid" com.pounceparty.app 2>/dev/null || true
    xcrun simctl launch "$udid" com.pounceparty.app -shot "$shot" >/dev/null
    sleep "$wait"
    out="appstore/screenshots/$folder/$file.png"
    for attempt in 1 2 3 4 5; do
      xcrun simctl io "$udid" screenshot "$out" >/dev/null 2>&1 && break
      sleep 2
    done
    # App Store screenshots must not have an alpha channel.
    if sips -g hasAlpha "$out" | grep -q "yes"; then
      sips -s format jpeg -s formatOptions 100 "$out" --out "$out.jpg" >/dev/null
      sips -s format png "$out.jpg" --out "$out" >/dev/null
      rm "$out.jpg"
    fi
    echo "   $out $(sips -g pixelWidth -g pixelHeight "$out" | awk '/pixel/{printf "%s ", $2}')"
  done
  xcrun simctl terminate "$udid" com.pounceparty.app 2>/dev/null || true
  xcrun simctl shutdown "$udid" 2>/dev/null || true
done
