const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Shared pure code lives outside this folder (../packages/core), imported as @notespark/core.
const core = path.resolve(__dirname, '../packages/core');
config.watchFolders = [...(config.watchFolders ?? []), core];
config.resolver.extraNodeModules = { '@notespark/core': core };

// The bundled search model and its vocabulary (assets/models/).
config.resolver.assetExts.push('onnx', 'txt');

module.exports = config;
