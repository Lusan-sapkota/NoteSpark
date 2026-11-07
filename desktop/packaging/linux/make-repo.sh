#!/bin/bash
# Builds the signed apt and dnf repository from release files.
#   SIGN_FP=<key fingerprint> PASSFILE=<file with the passphrase> make-repo.sh <out dir> <dir with the .deb and .rpm of one version>...
# Each version dir holds NoteSpark-linux-x64.deb and NoteSpark-linux-x64.rpm. Pass the newest versions only: whatever is not
# passed is not in the output, so pruning old versions is the caller's choice. The output is plain files to upload as they are:
#   apt/pool, apt/dists/stable (Release, InRelease, Release.gpg), rpm/*.rpm, rpm/repodata (repomd.xml.asc), notespark-archive-key.asc
# GNUPGHOME must hold the signing (sub)key. Needs gpg, dpkg-deb, apt-ftparchive, rpm (rpmsign) and createrepo_c.
set -euo pipefail
OUT=${1:?out dir}; shift
[ $# -ge 1 ] || { echo "give at least one version dir"; exit 1; }
: "${SIGN_FP:?}" "${PASSFILE:?}"
KEYFILE="$(cd "$(dirname "$0")" && pwd)/notespark-archive-key.asc"

[ -z "$(ls -A "$OUT" 2>/dev/null)" ] || { echo "$OUT is not empty"; exit 1; }
mkdir -p "$OUT/apt/pool/main/n/notespark" "$OUT/apt/dists/stable/main/binary-amd64" "$OUT/rpm"
g() { gpg --batch --yes --pinentry-mode loopback --passphrase-file "$PASSFILE" --default-key "$SIGN_FP" "$@"; }

for d in "$@"; do
  deb="$d/NoteSpark-linux-x64.deb"; rpmf="$d/NoteSpark-linux-x64.rpm"
  [ -f "$deb" ] && [ -f "$rpmf" ] || { echo "$d needs both the .deb and the .rpm"; exit 1; }
  cp "$deb" "$OUT/apt/pool/main/n/notespark/notespark_$(dpkg-deb -f "$deb" Version)_amd64.deb"
  cp "$rpmf" "$OUT/rpm/notespark-$(rpm -qp --nosignature --qf '%{VERSION}-%{RELEASE}' "$rpmf").x86_64.rpm"
done

# apt: index of the pool, then a signed Release (InRelease for new apt, Release.gpg for old).
( cd "$OUT/apt"
  apt-ftparchive packages pool > dists/stable/main/binary-amd64/Packages
  gzip -9k dists/stable/main/binary-amd64/Packages
  cd dists/stable
  apt-ftparchive -o APT::FTPArchive::Release::Origin=NoteSpark -o APT::FTPArchive::Release::Label=NoteSpark \
    -o APT::FTPArchive::Release::Suite=stable -o APT::FTPArchive::Release::Codename=stable \
    -o APT::FTPArchive::Release::Architectures=amd64 -o APT::FTPArchive::Release::Components=main release . > Release
  g --clearsign -o InRelease Release
  g --armor --detach-sign -o Release.gpg Release )

# rpm: sign every package, index them, sign the index (repo_gpgcheck).
for r in "$OUT"/rpm/*.rpm; do
  rpmsign --addsign --define "__gpg $(command -v gpg)" --define "_gpg_name $SIGN_FP" --define "_gpg_sign_cmd_extra_args --pinentry-mode loopback --passphrase-file $PASSFILE" "$r" >/dev/null
done
createrepo_c --quiet "$OUT/rpm"
g --armor --detach-sign -o "$OUT/rpm/repodata/repomd.xml.asc" "$OUT/rpm/repodata/repomd.xml"

cp "$KEYFILE" "$OUT/notespark-archive-key.asc"
echo "built $OUT: $(ls "$OUT"/apt/pool/main/n/notespark | wc -l) deb, $(ls "$OUT"/rpm/*.rpm | wc -l) rpm"
