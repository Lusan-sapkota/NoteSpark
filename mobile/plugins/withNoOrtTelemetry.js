// The onnxruntime Android package declares a provider (TelemetryInitializer) that would start Microsoft telemetry
// (mobile.events.data.microsoft.com) at launch. Today it isn't in our manifest, because onnxruntime-react-native only
// extracts the native libraries. This removes it at manifest merge in case a future version starts merging it.
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
