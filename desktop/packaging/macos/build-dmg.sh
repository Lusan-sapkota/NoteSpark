#!/bin/bash
# Builds the macOS disk image for one chip, retrying: hdiutil's eject is flaky on GitHub's macOS runners.
#   bash packaging/macos/build-dmg.sh arm64|x64      (run from desktop/, after the electron-vite build)
set -u
ARCH=${1:?arm64 or x64}
for i in 1 2 3; do
  npx electron-builder --mac dmg --"$ARCH" && exit 0
  echo "dmg attempt $i failed (hdiutil is flaky on runners)"; sleep 20
done
exit 1
