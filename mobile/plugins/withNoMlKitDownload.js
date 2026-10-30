// expo-camera's manifest asks Google Play services to download an ML Kit module ("barcode_ui") for the system code
// scanner, which NoteSpark never opens. Scanning uses the barcode decoder bundled in the app, so the entry is removed
// at manifest merge and the camera screen causes no download.
const { withAndroidManifest } = require('expo/config-plugins');

const NAME = 'com.google.mlkit.vision.DEPENDENCIES';

module.exports = function withNoMlKitDownload(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    const app = manifest.application[0];
    app['meta-data'] = (app['meta-data'] ?? []).filter((m) => m.$['android:name'] !== NAME);
    app['meta-data'].push({ $: { 'android:name': NAME, 'tools:node': 'remove' } });
    return cfg;
  });
};
