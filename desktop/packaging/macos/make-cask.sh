#!/bin/bash
# Prints the Homebrew cask for a release, using the checksums the release workflow publishes.
#   make-cask.sh v1.2.0 > Casks/notespark.rb        (reads SHA256SUMS from the GitHub release)
#   SUMS=./SHA256SUMS make-cask.sh v1.2.0            (reads a local copy instead)
set -euo pipefail
TAG=${1:?tag, for example v1.2.0}
VERSION=${TAG#v}
SUMS=${SUMS:-$(mktemp)}
[ -s "$SUMS" ] || gh release download "$TAG" -R Lusan-sapkota/NoteSpark -p SHA256SUMS -O "$SUMS" --clobber
sum() { awk -v f="$1" '$2 == f {print $1}' "$SUMS" | head -1; }
ARM=$(sum NoteSpark-macos-arm64.dmg); X64=$(sum NoteSpark-macos-x64.dmg)
[ ${#ARM} -eq 64 ] && [ ${#X64} -eq 64 ] || { echo "SHA256SUMS has no hash for both .dmg files" >&2; exit 1; }
cat <<EOF
cask "notespark" do
  arch arm: "arm64", intel: "x64"

  version "$VERSION"
  sha256 arm:   "$ARM",
         intel: "$X64"

  url "https://github.com/Lusan-sapkota/NoteSpark/releases/download/v#{version}/NoteSpark-macos-#{arch}.dmg"
  name "NoteSpark"
  desc "Fast, offline-first notes"
  homepage "http://notespark.lusansapkota.com.np/"

  app "NoteSpark.app"

  # The app is not signed or notarized by Apple (ad-hoc signature only): without this macOS blocks the first start.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/NoteSpark.app"]
  end
end
EOF
