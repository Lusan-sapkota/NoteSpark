// Sets android:appCategory on <application> so launchers that group apps can file NoteSpark correctly.
// Allowed values: accessibility, audio, game, image, maps, news, productivity, social, video.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withAppCategory(config, category = 'productivity') {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults.manifest.application[0].$['android:appCategory'] = category;
    return cfg;
  });
};
