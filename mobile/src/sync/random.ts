// Hermes has no crypto.getRandomValues and @noble reads it when it loads, so import this module before anything from
// @notespark/sync-protocol. (Yjs gets the same function through shims/lib0-webcrypto.js.)
import { getRandomValues } from 'expo-crypto';

const g = globalThis as { crypto?: { getRandomValues?: unknown } };
if (typeof g.crypto?.getRandomValues !== 'function') g.crypto = { ...g.crypto, getRandomValues };
