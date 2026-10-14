#!/usr/bin/env bash
# Archive Pounce Party and upload it to App Store Connect (it then appears in TestFlight).
#
# Before the first run:
#   1. Sign in to Xcode with an Apple ID on the developer team (Xcode › Settings › Accounts).
#   2. Create the app in App Store Connect with bundle ID com.pounceparty.app.
#
# Usage: TEAM_ID=ABCDE12345 ios/release.sh
set -euo pipefail
cd "$(dirname "$0")"

: "${TEAM_ID:?Set TEAM_ID to the 10-character Team ID shown at developer.apple.com/account}"

# Use the installed Xcode even if xcode-select still points at the Command Line Tools.
if [[ -z "${DEVELOPER_DIR:-}" && "$(xcode-select -p)" == *CommandLineTools* ]]; then
  xcode_app=$(ls -d /Applications/Xcode*.app 2>/dev/null | sort | tail -1)
  export DEVELOPER_DIR="$xcode_app/Contents/Developer"
fi

build_dir="build"
build_number="${BUILD_NUMBER:-$(date +%Y%m%d%H%M)}" # must increase with every upload
rm -rf "$build_dir"
mkdir -p "$build_dir"

xcodebuild archive \
  -project PounceParty.xcodeproj \
  -scheme PounceParty \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$build_dir/PounceParty.xcarchive" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CURRENT_PROJECT_VERSION="$build_number"

sed "s/TEAM_ID/$TEAM_ID/" ExportOptions.plist > "$build_dir/ExportOptions.plist"

xcodebuild -exportArchive \
  -archivePath "$build_dir/PounceParty.xcarchive" \
  -exportOptionsPlist "$build_dir/ExportOptions.plist" \
  -exportPath "$build_dir/export" \
  -allowProvisioningUpdates

echo "Uploaded build $build_number. It shows up in App Store Connect › TestFlight after processing (usually 5–30 minutes)."
