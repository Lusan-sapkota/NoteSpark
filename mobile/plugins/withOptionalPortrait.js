// ML Kit's scanner activities are locked to portrait, so Play infers a hard
// android.hardware.screen.portrait requirement and hides the app from landscape-only
// devices. The app itself rotates freely: mark the feature optional.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withOptionalPortrait(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const features = (manifest['uses-feature'] ??= []);
    const name = 'android.hardware.screen.portrait';
    if (!features.some((f) => f.$['android:name'] === name)) {
      features.push({ $: { 'android:name': name, 'android:required': 'false' } });
    }
    return cfg;
  });
};
