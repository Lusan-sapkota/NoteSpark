// Yjs (through lib0) picks its client ids with crypto.getRandomValues, which Hermes doesn't have, and lib0's own
// react-native entry wants a package that isn't installed. metro.config.js points lib0/webcrypto here instead.
const { getRandomValues } = require('expo-crypto');

module.exports = { getRandomValues, subtle: undefined };
