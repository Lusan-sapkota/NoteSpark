#!/bin/bash
# Writes the three winget manifest files for a release, using the checksums the release workflow publishes.
#   make-winget-manifest.sh v1.2.0 <out dir>              (reads SHA256SUMS from the GitHub release)
#   SUMS=./SHA256SUMS make-winget-manifest.sh v1.2.0 out  (reads a local copy instead)
# Submit the files to microsoft/winget-pkgs under manifests/l/LusanSapkota/NoteSpark/<version>/ (see the owner's runbook).
set -euo pipefail
TAG=${1:?tag, for example v1.2.0}; OUT=${2:?out dir}
VERSION=${TAG#v}; ID=LusanSapkota.NoteSpark; SCHEMA=1.28.0
SUMS=${SUMS:-$(mktemp)}
[ -s "$SUMS" ] || gh release download "$TAG" -R Lusan-sapkota/NoteSpark -p SHA256SUMS -O "$SUMS" --clobber
HASH=$(awk '$2 == "NoteSpark-windows-x64.exe" {print toupper($1)}' "$SUMS" | head -1)
[ ${#HASH} -eq 64 ] || { echo "SHA256SUMS has no hash for NoteSpark-windows-x64.exe" >&2; exit 1; }
mkdir -p "$OUT"

cat > "$OUT/$ID.yaml" <<EOF
# yaml-language-server: \$schema=https://aka.ms/winget-manifest.version.$SCHEMA.schema.json
PackageIdentifier: $ID
PackageVersion: $VERSION
DefaultLocale: en-US
ManifestType: version
ManifestVersion: $SCHEMA
EOF

cat > "$OUT/$ID.installer.yaml" <<EOF
# yaml-language-server: \$schema=https://aka.ms/winget-manifest.installer.$SCHEMA.schema.json
PackageIdentifier: $ID
PackageVersion: $VERSION
InstallerLocale: en-US
InstallerType: nullsoft
Scope: user
InstallModes:
- interactive
- silent
- silentWithProgress
UpgradeBehavior: install
Installers:
- Architecture: x64
  InstallerUrl: https://github.com/Lusan-sapkota/NoteSpark/releases/download/$TAG/NoteSpark-windows-x64.exe
  InstallerSha256: $HASH
ManifestType: installer
ManifestVersion: $SCHEMA
EOF

cat > "$OUT/$ID.locale.en-US.yaml" <<EOF
# yaml-language-server: \$schema=https://aka.ms/winget-manifest.defaultLocale.$SCHEMA.schema.json
PackageIdentifier: $ID
PackageVersion: $VERSION
PackageLocale: en-US
Publisher: Lusan Sapkota
PublisherUrl: https://github.com/Lusan-sapkota
PackageName: NoteSpark
PackageUrl: https://notespark.lusansapkota.com.np/
License: GPL-3.0
LicenseUrl: https://github.com/Lusan-sapkota/NoteSpark/blob/main/LICENSE
ShortDescription: Fast, offline-first notes and ideas, with no account and no internet connection needed.
Moniker: notespark
Tags:
- notes
- markdown
- offline
- note-taking
ReleaseNotesUrl: https://github.com/Lusan-sapkota/NoteSpark/releases/tag/$TAG
ManifestType: defaultLocale
ManifestVersion: $SCHEMA
EOF
echo "wrote $OUT/$ID.yaml, $ID.installer.yaml, $ID.locale.en-US.yaml"
