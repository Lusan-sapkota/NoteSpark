#!/bin/bash
# Run inside a clean Ubuntu container with the package folder mounted at /pkg (see .github/workflows/release.yml).
# Install, keep-it-removed on upgrade, remove, reinstall, purge. Exits non-zero on the first failed check.
export DEBIAN_FRONTEND=noninteractive
P=/pkg/NoteSpark-linux-x64.deb
SRC=/etc/apt/sources.list.d/notespark.sources
KEY=/usr/share/keyrings/notespark-archive-keyring.asc
MARK=/var/lib/notespark/repo-added
fail() { echo "FAIL: $*"; exit 1; }
has() { [ -e "$1" ] || fail "missing $1"; }
gone() { [ ! -e "$1" ] || fail "still there: $1"; }

apt-get update -qq >/dev/null 2>&1
apt-get install -y -qq "$P" >/tmp/i.log 2>&1 || { tail -20 /tmp/i.log; fail "install"; }
for f in /usr/bin/notespark /opt/NoteSpark/notespark "$SRC" "$KEY" "$MARK"; do has "$f"; done
grep -q "^Signed-By: $KEY" "$SRC" || fail "source has no Signed-By"
grep -q '^URIs: https://packages-notespark.lusansapkota.com.np/apt' "$SRC" || fail "source URL"
cmp -s /opt/NoteSpark/resources/notespark-archive-key.asc "$KEY" || fail "installed key differs from the packaged key"
echo ok: install adds the source once

mkdir -p /root/.config/notespark-desktop && echo mynote > /root/.config/notespark-desktop/note.db
rm "$SRC"
dpkg -i "$P" >/dev/null 2>&1 || fail "reinstall over itself"
gone "$SRC"; has /usr/bin/notespark
echo ok: a source the user deleted stays deleted on upgrade

apt-get remove -y -qq notespark >/dev/null 2>&1 || fail "remove"
for f in /usr/bin/notespark /opt/NoteSpark/notespark "$SRC" "$KEY" "$MARK"; do gone "$f"; done
[ "$(cat /root/.config/notespark-desktop/note.db)" = mynote ] || fail "remove touched the user's notes"
echo ok: remove cleans up and leaves notes alone

dpkg -i "$P" >/dev/null 2>&1 || fail "fresh install after remove"
has "$SRC"
echo ok: a fresh install after remove adds the source again

apt-get purge -y -qq notespark >/dev/null 2>&1 || fail "purge"
gone "$SRC"; gone "$MARK"; has /root/.config/notespark-desktop/note.db
echo ok: purge cleans up
