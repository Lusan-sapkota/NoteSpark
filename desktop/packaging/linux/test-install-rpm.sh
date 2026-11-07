#!/bin/bash
# Run inside a clean Fedora container with the package folder mounted at /pkg (see .github/workflows/release.yml).
P=/pkg/NoteSpark-linux-x64.rpm
REPO=/etc/yum.repos.d/notespark.repo
KEY=/usr/share/keyrings/notespark-archive-keyring.asc
MARK=/var/lib/notespark/repo-added
fail() { echo "FAIL: $*"; exit 1; }
has() { [ -e "$1" ] || fail "missing $1"; }
gone() { [ ! -e "$1" ] || fail "still there: $1"; }

dnf install -y -q --setopt=max_parallel_downloads=20 "$P" >/tmp/i.log 2>&1 || { tail -20 /tmp/i.log; fail "install"; }
for f in /usr/bin/notespark /opt/NoteSpark/notespark "$REPO" "$KEY" "$MARK"; do has "$f"; done
grep -q '^gpgcheck=1' "$REPO" && grep -q '^repo_gpgcheck=1' "$REPO" || fail "repo file does not check signatures"
grep -q "^gpgkey=file://$KEY" "$REPO" || fail "repo file key"
grep -q '^baseurl=https://packages-notespark.lusansapkota.com.np/rpm' "$REPO" || fail "repo URL"
cmp -s /opt/NoteSpark/resources/notespark-archive-key.asc "$KEY" || fail "installed key differs from the packaged key"
echo ok: install adds the repo once

mkdir -p /root/.config/notespark-desktop && echo mynote > /root/.config/notespark-desktop/note.db
rm "$REPO"
rpm -U --replacepkgs --nosignature "$P" >/tmp/u.log 2>&1 || { cat /tmp/u.log; fail "upgrade"; }
gone "$REPO"; has /usr/bin/notespark
echo ok: a repo file the user deleted stays deleted on upgrade, and the command link survives

dnf remove -y -q notespark >/dev/null 2>&1 || fail "remove"
for f in /usr/bin/notespark /opt/NoteSpark/notespark "$REPO" "$KEY" "$MARK"; do gone "$f"; done
[ "$(cat /root/.config/notespark-desktop/note.db)" = mynote ] || fail "remove touched the user's notes"
echo ok: remove cleans up and leaves notes alone

dnf install -y -q --setopt=max_parallel_downloads=20 "$P" >/dev/null 2>&1 || fail "fresh install after remove"
has "$REPO"
echo ok: a fresh install after remove adds the repo again
