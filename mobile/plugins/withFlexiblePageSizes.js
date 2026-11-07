// RN's Gradle plugin sets the 16 KB page-size flag only for the app module; onnxruntime's module needs it too.
const { withProjectBuildGradle } = require('expo/config-plugins');

const MARKER = '// withFlexiblePageSizes';
const SNIPPET = `
${MARKER}
subprojects { p ->
  p.plugins.withId('com.android.library') {
    if (p.name == 'onnxruntime-react-native') {
      p.android.defaultConfig.externalNativeBuild.cmake.arguments '-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON'
    }
  }
}
`;

module.exports = function withFlexiblePageSizes(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARKER)) cfg.modResults.contents += SNIPPET;
    return cfg;
  });
};
