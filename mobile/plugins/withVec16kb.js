// Uses our 16 KB aligned vec.so (vendor/sqlite-vec, see its README) over expo-sqlite's 4 KB one.
// shortcut: remove this plugin and vendor/ once expo-sqlite ships 16 KB aligned vec.so files.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// withVec16kb';
const SNIPPET = `
${MARKER}
android.sourceSets.main.jniLibs.srcDirs += [file("$rootDir/../vendor/sqlite-vec")]
`;

module.exports = function withVec16kb(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARKER)) cfg.modResults.contents += SNIPPET;
    return cfg;
  });
};
