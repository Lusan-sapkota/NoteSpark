// Removes onnxruntime's telemetry provider at manifest merge. Absent today; guards future upgrades.
const { withAndroidManifest } = require('expo/config-plugins');

const NAME = 'ai.onnxruntime.TelemetryInitializer';

module.exports = function withNoOrtTelemetry(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    const app = manifest.application[0];
    app.provider = (app.provider ?? []).filter((p) => p.$['android:name'] !== NAME);
    app.provider.push({ $: { 'android:name': NAME, 'tools:node': 'remove' } });
    return cfg;
  });
};
