// React Native's Gradle plugin turns on 16 KB page-size support only for the app module. onnxruntime-react-native builds
// libonnxruntimejsi.so in its own module with NDK 27, which would leave it 4 KB aligned (Play warns about 16 KB devices).
// This adds the same CMake flag to that module.
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
