#!/bin/bash
# Runs after the .deb or .rpm is removed or upgraded. $1 is remove, purge or upgrade for a .deb, 0 (erase) or 1 (upgrade) for an .rpm.
# An upgrade must not undo what the new version's after-install just did (an .rpm runs the new one first).
case "$1" in
  upgrade|failed-upgrade|abort-install|abort-upgrade|disappear|1) exit 0 ;;
esac

if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi

# Uninstalling takes our repository with it. The user's notes and settings are never touched.
rm -f /etc/apt/sources.list.d/notespark.sources /etc/yum.repos.d/notespark.repo /usr/share/keyrings/notespark-archive-keyring.asc /var/lib/notespark/repo-added
rmdir /var/lib/notespark 2>/dev/null || true
exit 0
