const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The bundled search model and its vocabulary (assets/models/).
config.resolver.assetExts.push('onnx', 'txt');

module.exports = config;
