// react-native-background-actions keeps sync running while the app is closed, as an Android foreground service of
// type "data sync". Android 14+ needs that type declared on the service and its permission in the manifest.
// The service starts only while a profile's sync is on, and only if the person allowed notifications.
const { withAndroidManifest } = require('expo/config-plugins');

const SERVICE = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';
const PERMISSIONS = ['android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_DATA_SYNC'];

module.exports = function withSyncService(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    manifest['uses-permission'] = manifest['uses-permission'] ?? [];
    for (const name of PERMISSIONS) {
      if (!manifest['uses-permission'].some((p) => p.$['android:name'] === name)) manifest['uses-permission'].push({ $: { 'android:name': name } });
    }
    const app = manifest.application[0];
    app.service = (app.service ?? []).filter((s) => s.$['android:name'] !== SERVICE);
    app.service.push({ $: { 'android:name': SERVICE, 'android:foregroundServiceType': 'dataSync', 'tools:node': 'merge' } });
    return cfg;
  });
};
