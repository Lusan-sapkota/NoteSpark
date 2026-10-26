const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Shared pure code lives outside this folder (../packages/core, ../packages/sync), imported as @notespark/core and
// @notespark/sync. Yjs is installed in packages/sync, so the phone, the tests and the desktop all use one copy.
const core = path.resolve(__dirname, '../packages/core');
const sync = path.resolve(__dirname, '../packages/sync');
config.watchFolders = [...(config.watchFolders ?? []), core, sync];
config.resolver.extraNodeModules = { '@notespark/core': core, '@notespark/sync': sync };

// Hermes has no crypto.getRandomValues (see shims/lib0-webcrypto.js).
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) =>
  moduleName === 'lib0/webcrypto'
    ? { type: 'sourceFile', filePath: path.resolve(__dirname, 'shims/lib0-webcrypto.js') }
    : (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);

// The bundled search model and its vocabulary (assets/models/).
config.resolver.assetExts.push('onnx', 'txt');

module.exports = config;
