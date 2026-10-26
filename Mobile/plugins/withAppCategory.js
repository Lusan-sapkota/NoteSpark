// Sets android:appCategory on <application> so launchers can group the app.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withAppCategory(config, category = 'productivity') {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults.manifest.application[0].$['android:appCategory'] = category;
    return cfg;
  });
};
