#!/bin/bash
# Runs after the .deb or .rpm is installed or upgraded. Replaces electron-builder's default script, so the first part
# repeats it (command link, sandbox, AppArmor). No dollar-brace in this file except the two template names: electron-builder fills them in.

if type update-alternatives >/dev/null 2>&1; then
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# SUID sandbox only where the kernel has no user namespaces.
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi
if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# AppArmor profile (Ubuntu 23.10+ confines user namespaces); skipped where AppArmor cannot read it (Ubuntu 22.04).
if apparmor_status --enabled > /dev/null 2>&1; then
  APPARMOR_PROFILE_SOURCE='/opt/${sanitizedProductName}/resources/apparmor-profile'
  APPARMOR_PROFILE_TARGET='/etc/apparmor.d/${executable}'
  if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
    cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
    fi
  else
    echo "Skipping the AppArmor profile: this version of AppArmor cannot read it"
  fi
fi

# Our update repository, added once. $1 is "configure" for a .deb and 1 (install) or 2 (upgrade) for an .rpm.
# The marker means: already offered. A user who deleted the source file keeps it deleted through upgrades.
# Uninstalling removes the marker too (see after-remove.sh), so a later fresh install adds it again.
KEY_SRC='/opt/${sanitizedProductName}/resources/notespark-archive-key.asc'
KEY='/usr/share/keyrings/notespark-archive-keyring.asc'
MARKER='/var/lib/notespark/repo-added'
URL='https://packages-notespark.lusansapkota.com.np'
if [ ! -e "$MARKER" ] && [ -f "$KEY_SRC" ]; then
  case "$1" in
    configure)
      mkdir -p /etc/apt/sources.list.d
      mkdir -p /usr/share/keyrings
      cp -f "$KEY_SRC" "$KEY" || exit 1
      cat > /etc/apt/sources.list.d/notespark.sources <<EOF
Types: deb
URIs: $URL/apt
Suites: stable
Components: main
Architectures: amd64
Signed-By: $KEY
EOF
      mkdir -p /var/lib/notespark && : > "$MARKER"
      ;;
    1|2)
      mkdir -p /etc/yum.repos.d
      mkdir -p /usr/share/keyrings
      cp -f "$KEY_SRC" "$KEY" || exit 1
      cat > /etc/yum.repos.d/notespark.repo <<EOF
[notespark]
name=NoteSpark
baseurl=$URL/rpm
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=file://$KEY
EOF
      mkdir -p /var/lib/notespark && : > "$MARKER"
      ;;
  esac
fi
