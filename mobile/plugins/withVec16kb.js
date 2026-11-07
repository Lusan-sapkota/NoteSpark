// expo-sqlite ships a prebuilt sqlite-vec (vec.so) that is only 4 KB aligned, which Play flags for 16 KB devices.
// vendor/sqlite-vec/<abi>/vec.so is the same sqlite-vec v0.1.7-alpha.2 rebuilt with -Wl,-z,max-page-size=16384
// (see vendor/sqlite-vec/README.md). The app's own jniLibs take priority over the library's copy at merge time.
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
