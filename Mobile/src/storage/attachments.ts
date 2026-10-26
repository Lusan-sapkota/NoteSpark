import AsyncStorage from '@react-native-async-storage/async-storage';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import {
  ATTACHMENT_HASH_RE,
  ATTACHMENT_TOO_LARGE_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  MAX_NOTE_BYTES,
  appendAttachmentLink,
  formatAttachmentLink,
  formatAttachmentSize,
  parseAttachmentLinks,
  referencedHashes,
  removeAttachmentLink,
  sanitizeAttachmentName,
} from '@notespark/core';
import {
  dbName,
  getOpenProfileId,
  getProfileKey,
  openProfileConnection,
  registerAttachmentEncryptionHook,
  withDatabaseLock,
} from './database';

export {
  ATTACHMENT_HASH_RE,
  ATTACHMENT_TOO_LARGE_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  MAX_NOTE_BYTES,
  appendAttachmentLink,
  formatAttachmentLink,
  formatAttachmentSize,
  parseAttachmentLinks,
  referencedHashes,
  removeAttachmentLink,
  sanitizeAttachmentName,
};

export const ATTACHMENT_GRACE_MS = 24 * 60 * 60 * 1000;

const FORMAT_VERSION = 0x01;
const SALT_BYTES = 16;
const HEADER_BYTES = 1 + SALT_BYTES + 4; // version (1) + salt (16) + uint32be plaintext size (4) = 21 bytes
const CHUNK_BYTES = 64 * 1024;
const TAG_BYTES = 16;
const ENCRYPTED_CHUNK_BYTES = CHUNK_BYTES + TAG_BYTES;

const INSTALL_KEY_NAME = 'attachmentKey_install';
const PROFILE_HKDF_INFO = new TextEncoder().encode('notespark-attachment-key-v1');
const BLOB_HKDF_INFO = new TextEncoder().encode('notespark-blob-v1');
const SQLITE_HEADER = 'SQLite format 3\0';

const filesDir = () => `${FileSystem.documentDirectory}note-files/`;
const profileFilesDir = (profileId: string) => `${filesDir()}profile-${profileId}/`;
const tempOpenDir = () => `${FileSystem.cacheDirectory}attachment-open/`;

const randomHex = (byteLength = 8): string => bytesToHex(Crypto.getRandomBytes(byteLength));

const yieldToEventLoop = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

const readRawBytes = async (uri: string): Promise<Uint8Array> => {
  try {
    return await new File(uri).bytes();
  } catch {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
};

const writeRawBytes = async (uri: string, bytes: Uint8Array): Promise<void> => {
  try {
    await new File(uri).write(bytes);
  } catch {
    let bin = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.byteLength; i += step) {
      bin += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.byteLength, i + step)));
    }
    await FileSystem.writeAsStringAsync(uri, btoa(bin), { encoding: FileSystem.EncodingType.Base64 });
  }
};

const writeAtomically = async (dirUri: string, targetUri: string, bytes: Uint8Array): Promise<void> => {
  await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true }).catch(() => {});
  const tmpUri = `${targetUri}.tmp.${randomHex(8)}`;
  try {
    await writeRawBytes(tmpUri, bytes);
    await FileSystem.moveAsync({ from: tmpUri, to: targetUri });
  } catch (error) {
    await FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
    throw error;
  }
};

const sha256HexChunked = async (bytes: Uint8Array): Promise<string> => {
  const hasher = sha256.create();
  let lastYield = Date.now();
  for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BYTES) {
    hasher.update(bytes.subarray(offset, Math.min(bytes.byteLength, offset + CHUNK_BYTES)));
    if (Date.now() - lastYield >= 12) {
      await yieldToEventLoop();
      lastYield = Date.now();
    }
  }
  return bytesToHex(hasher.digest());
};

const getOrCreateInstallKey = async (): Promise<Uint8Array> => {
  let stored = await SecureStore.getItemAsync(INSTALL_KEY_NAME);
  if (!stored || stored.length !== 64) {
    stored = bytesToHex(Crypto.getRandomBytes(32));
    await SecureStore.setItemAsync(INSTALL_KEY_NAME, stored);
  }
  return hexToBytes(stored);
};

const deriveFromProfileKey = (profileKeyHex: string): Uint8Array =>
  hkdf(sha256, hexToBytes(profileKeyHex), undefined, PROFILE_HKDF_INFO, 32);

const isDbFileEncryptedOrUnreadable = async (profileId: string): Promise<boolean> => {
  const dbUri = `file://${SQLite.defaultDatabaseDirectory}/${dbName(profileId)}`;
  const info = await FileSystem.getInfoAsync(dbUri).catch(() => ({ exists: false, size: 0 }));
  if (!info.exists || (info.size ?? 0) < 16) return false;
  try {
    const bytes = await readRawBytes(dbUri);
    if (bytes.byteLength < 16) return false;
    for (let i = 0; i < 16; i++) {
      if (bytes[i] !== SQLITE_HEADER.charCodeAt(i)) return true;
    }
    return false;
  } catch {
    return true;
  }
};

const isProfileLockedWithoutKey = async (profileId: string): Promise<boolean> => {
  const pin = await SecureStore.getItemAsync(`profilePin_${profileId}`);
  if (pin) return true;
  const backupsRaw = await AsyncStorage.getItem('profilePinBackups').catch(() => null);
  if (backupsRaw) {
    try {
      const backups = JSON.parse(backupsRaw);
      if (backups?.[profileId]?.stored) return true;
    } catch {}
  }
  return isDbFileEncryptedOrUnreadable(profileId);
};

const getAttachmentKey = async (profileId = getOpenProfileId()): Promise<Uint8Array> => {
  const profileKeyHex = await getProfileKey(profileId);
  if (profileKeyHex && profileKeyHex.length === 64) {
    return deriveFromProfileKey(profileKeyHex);
  }
  if (await isProfileLockedWithoutKey(profileId)) {
    throw new Error('Profile is locked');
  }
  return getOrCreateInstallKey();
};

const makeChunkNonce = (chunkIndex: number): Uint8Array => {
  const nonce = new Uint8Array(12);
  new DataView(nonce.buffer).setUint32(8, chunkIndex >>> 0, false);
  return nonce;
};

const makeChunkAad = (totalPlaintextBytes: number, chunkIndex: number, isFinal: boolean): Uint8Array => {
  const aad = new Uint8Array(10);
  const view = new DataView(aad.buffer);
  aad[0] = FORMAT_VERSION;
  view.setUint32(1, totalPlaintextBytes >>> 0, false);
  view.setUint32(5, chunkIndex >>> 0, false);
  aad[9] = isFinal ? 1 : 0;
  return aad;
};

export const plaintextSizeFromEncryptedSize = (encryptedBytes: number): number | null => {
  if (encryptedBytes < HEADER_BYTES + TAG_BYTES) return null;
  const payloadWithTags = encryptedBytes - HEADER_BYTES;
  if (payloadWithTags === TAG_BYTES) return 0;
  const numChunks = Math.ceil(payloadWithTags / ENCRYPTED_CHUNK_BYTES);
  const plainBytes = payloadWithTags - numChunks * TAG_BYTES;
  if (plainBytes <= 0 || plainBytes > MAX_ATTACHMENT_BYTES) return null;
  if (Math.ceil(plainBytes / CHUNK_BYTES) !== numChunks) return null;
  return plainBytes;
};

const encryptBytes = async (plaintext: Uint8Array, masterKey: Uint8Array): Promise<Uint8Array> => {
  if (plaintext.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(ATTACHMENT_TOO_LARGE_MESSAGE);
  }
  const salt = Crypto.getRandomBytes(SALT_BYTES);
  const fileKey = hkdf(sha256, masterKey, salt, BLOB_HKDF_INFO, 32);
  const totalPlain = plaintext.byteLength;
  const totalChunks = totalPlain === 0 ? 1 : Math.ceil(totalPlain / CHUNK_BYTES);
  const totalEncrypted = HEADER_BYTES + totalPlain + totalChunks * TAG_BYTES;

  const out = new Uint8Array(totalEncrypted);
  out[0] = FORMAT_VERSION;
  out.set(salt, 1);
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(1 + SALT_BYTES, totalPlain >>> 0, false);

  let writeOffset = HEADER_BYTES;
  let lastYield = Date.now();
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_BYTES;
    const end = Math.min(totalPlain, start + CHUNK_BYTES);
    const chunk = plaintext.subarray(start, end);
    const isFinal = i === totalChunks - 1;
    const cipher = chacha20poly1305(fileKey, makeChunkNonce(i), makeChunkAad(totalPlain, i, isFinal));
    const sealed = cipher.encrypt(chunk);
    out.set(sealed, writeOffset);
    writeOffset += sealed.byteLength;
    if ((i & 7) === 7 && Date.now() - lastYield >= 12) {
      await yieldToEventLoop();
      lastYield = Date.now();
    }
  }
  fileKey.fill(0);
  return out;
};

const decryptBytes = async (encrypted: Uint8Array, masterKey: Uint8Array): Promise<Uint8Array> => {
  if (encrypted.byteLength < HEADER_BYTES + TAG_BYTES) {
    throw new Error('Attachment is corrupt or truncated');
  }
  if (encrypted[0] !== FORMAT_VERSION) {
    throw new Error('Unsupported attachment format version');
  }
  const salt = encrypted.subarray(1, 1 + SALT_BYTES);
  const view = new DataView(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength);
  const totalPlain = view.getUint32(1 + SALT_BYTES, false);
  if (totalPlain > MAX_ATTACHMENT_BYTES) {
    throw new Error(ATTACHMENT_TOO_LARGE_MESSAGE);
  }
  const totalChunks = totalPlain === 0 ? 1 : Math.ceil(totalPlain / CHUNK_BYTES);
  const expectedLength = HEADER_BYTES + totalPlain + totalChunks * TAG_BYTES;
  if (encrypted.byteLength !== expectedLength) {
    throw new Error('Attachment is corrupt or truncated');
  }

  const fileKey = hkdf(sha256, masterKey, salt, BLOB_HKDF_INFO, 32);
  const out = new Uint8Array(totalPlain);
  let readOffset = HEADER_BYTES;
  let writeOffset = 0;
  let lastYield = Date.now();
  try {
    for (let i = 0; i < totalChunks; i++) {
      const plainLen = totalPlain === 0 ? 0 : i === totalChunks - 1 ? totalPlain - i * CHUNK_BYTES : CHUNK_BYTES;
      const sealedLen = plainLen + TAG_BYTES;
      const sealed = encrypted.subarray(readOffset, readOffset + sealedLen);
      readOffset += sealedLen;
      const isFinal = i === totalChunks - 1;
      const cipher = chacha20poly1305(fileKey, makeChunkNonce(i), makeChunkAad(totalPlain, i, isFinal));
      const plain = cipher.decrypt(sealed);
      out.set(plain, writeOffset);
      writeOffset += plain.byteLength;
      if ((i & 7) === 7 && Date.now() - lastYield >= 12) {
        await yieldToEventLoop();
        lastYield = Date.now();
      }
    }
  } finally {
    fileKey.fill(0);
  }
  return out;
};

const canDecryptFileWithKey = async (uri: string, key: Uint8Array, expectedHash: string): Promise<boolean> => {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return false;
    const encrypted = await readRawBytes(uri);
    const plain = await decryptBytes(encrypted, key);
    return (await sha256HexChunked(plain)) === expectedHash;
  } catch {
    return false;
  }
};

export type AddAttachmentInput =
  | { bytes: Uint8Array; name: string; size?: number }
  | { uri: string; name: string; size?: number };

export const addAttachment = async (
  input: AddAttachmentInput,
  profileId: string = getOpenProfileId()
): Promise<{ hash: string; size: number; name: string }> => {
  if (typeof input.size === 'number' && input.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(ATTACHMENT_TOO_LARGE_MESSAGE);
  }
  let bytes: Uint8Array;
  if ('bytes' in input && input.bytes instanceof Uint8Array) {
    bytes = input.bytes;
  } else if ('uri' in input && input.uri) {
    const info = await FileSystem.getInfoAsync(input.uri).catch(() => null);
    if (info?.exists && typeof info.size === 'number' && info.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(ATTACHMENT_TOO_LARGE_MESSAGE);
    }
    bytes = await readRawBytes(input.uri);
  } else {
    throw new Error('Invalid attachment input');
  }

  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(ATTACHMENT_TOO_LARGE_MESSAGE);
  }

  const name = sanitizeAttachmentName(input.name);
  const hash = await sha256HexChunked(bytes);
  const profileKeyHex = await getProfileKey(profileId);
  const isProtected = Boolean(profileKeyHex && profileKeyHex.length === 64);
  const key = await getAttachmentKey(profileId);

  const targetDir = isProtected ? profileFilesDir(profileId) : filesDir();
  const targetPath = `${targetDir}${hash}`;

  try {
    if (await canDecryptFileWithKey(targetPath, key, hash)) {
      return { hash, size: bytes.byteLength, name };
    }
    const encrypted = await encryptBytes(bytes, key);
    await writeAtomically(targetDir, targetPath, encrypted);
    return { hash, size: bytes.byteLength, name };
  } finally {
    key.fill(0);
  }
};

export const readAttachment = async (
  hash: string,
  profileId: string = getOpenProfileId()
): Promise<Uint8Array> => {
  const normalized = hash.toLowerCase();
  if (!ATTACHMENT_HASH_RE.test(normalized)) {
    throw new Error(`Invalid attachment hash: ${hash}`);
  }
  const profileKeyHex = await getProfileKey(profileId);
  const isProtected = Boolean(profileKeyHex && profileKeyHex.length === 64);
  const key = await getAttachmentKey(profileId);
  try {
    const candidates = isProtected
      ? [`${profileFilesDir(profileId)}${normalized}`, `${filesDir()}${normalized}`]
      : [`${filesDir()}${normalized}`, `${profileFilesDir(profileId)}${normalized}`];
    const existing: string[] = [];
    for (const c of candidates) {
      if ((await FileSystem.getInfoAsync(c)).exists) existing.push(c);
    }
    if (existing.length === 0) {
      throw new Error(`Attachment not found: ${normalized}`);
    }
    let lastError: unknown;
    for (const candidate of existing) {
      try {
        const encrypted = await readRawBytes(candidate);
        const plain = await decryptBytes(encrypted, key);
        const actualHash = await sha256HexChunked(plain);
        if (actualHash !== normalized) {
          throw new Error('Attachment hash mismatch');
        }
        return plain;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error(`Could not read attachment: ${normalized}`);
  } finally {
    key.fill(0);
  }
};

export const hasAttachment = async (
  hash: string,
  profileId: string = getOpenProfileId()
): Promise<boolean> => {
  const normalized = hash.toLowerCase();
  if (!ATTACHMENT_HASH_RE.test(normalized)) return false;
  const scopedInfo = await FileSystem.getInfoAsync(`${profileFilesDir(profileId)}${normalized}`).catch(() => ({ exists: false }));
  if (scopedInfo.exists) return true;
  const mainInfo = await FileSystem.getInfoAsync(`${filesDir()}${normalized}`).catch(() => ({ exists: false }));
  return mainInfo.exists;
};

export const getAttachmentMeta = async (
  hash: string,
  profileId: string = getOpenProfileId()
): Promise<{ hash: string; size: number; mtimeMs: number } | null> => {
  const normalized = hash.toLowerCase();
  if (!ATTACHMENT_HASH_RE.test(normalized)) return null;
  for (const path of [`${profileFilesDir(profileId)}${normalized}`, `${filesDir()}${normalized}`]) {
    const info = await FileSystem.getInfoAsync(path).catch(() => null);
    if (info?.exists) {
      const size = plaintextSizeFromEncryptedSize(info.size ?? 0);
      if (size === null) return null;
      return { hash: normalized, size, mtimeMs: Math.round((info.modificationTime ?? 0) * 1000) };
    }
  }
  return null;
};

export const openAttachmentTemp = async (
  hash: string,
  displayName: string,
  profileId: string = getOpenProfileId()
): Promise<{ uri: string; cleanup: () => Promise<void> }> => {
  const plain = await readAttachment(hash, profileId);
  const safeName = sanitizeAttachmentName(displayName);
  const slotDir = `${tempOpenDir()}${randomHex(8)}/`;
  const targetUri = `${slotDir}${safeName}`;
  await FileSystem.makeDirectoryAsync(slotDir, { intermediates: true });
  await writeRawBytes(targetUri, plain);
  const cleanup = async () => {
    await FileSystem.deleteAsync(slotDir, { idempotent: true }).catch(() => {});
  };
  return { uri: targetUri, cleanup };
};

export const clearAttachmentTempDir = async (): Promise<void> => {
  await FileSystem.deleteAsync(tempOpenDir(), { idempotent: true }).catch(() => {});
};

export const listAttachments = async (
  profileId: string = getOpenProfileId()
): Promise<{ hash: string; size: number; mtimeMs: number }[]> => {
  const byHash = new Map<string, { hash: string; size: number; mtimeMs: number }>();
  for (const dir of [filesDir(), profileFilesDir(profileId)]) {
    const entries = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
    for (const name of entries) {
      if (!ATTACHMENT_HASH_RE.test(name)) continue;
      const info = await FileSystem.getInfoAsync(`${dir}${name}`).catch(() => null);
      if (!info?.exists || info.isDirectory) continue;
      const size = plaintextSizeFromEncryptedSize(info.size ?? 0);
      if (size === null) continue;
      byHash.set(name, {
        hash: name,
        size,
        mtimeMs: Math.round((info.modificationTime ?? 0) * 1000),
      });
    }
  }
  return [...byHash.values()].sort((a, b) => a.hash.localeCompare(b.hash));
};

export const copyAttachmentsForTransfer = async (
  hashes: Iterable<string>,
  fromProfileId: string,
  toProfileId: string
): Promise<void> => {
  const list = [...new Set([...hashes].map(h => h.toLowerCase()).filter(h => ATTACHMENT_HASH_RE.test(h)))];
  if (list.length === 0) return;
  for (const hash of list) {
    if (!(await hasAttachment(hash, fromProfileId))) continue;
    const plain = await readAttachment(hash, fromProfileId);
    await addAttachment({ bytes: plain, name: hash }, toProfileId);
  }
};

export const deleteProfileAttachments = async (profileId: string): Promise<void> => {
  await FileSystem.deleteAsync(profileFilesDir(profileId), { idempotent: true }).catch(() => {});
};

const extractHashesFromOpenConn = async (conn: SQLite.SQLiteDatabase, out: Set<string>): Promise<void> => {
  const hasNotes = await conn.getFirstAsync<{ name?: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notes'"
  );
  if (hasNotes?.name) {
    const rows = await conn.getAllAsync<{ content: string }>('SELECT content FROM notes');
    for (const h of referencedHashes(rows)) out.add(h);
  }
  const hasVersions = await conn.getFirstAsync<{ name?: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'note_versions'"
  );
  if (hasVersions?.name) {
    const versions = await conn.getAllAsync<{ content: string }>('SELECT content FROM note_versions');
    for (const h of referencedHashes(versions)) out.add(h);
  }
  const hasScratchpad = await conn.getFirstAsync<{ name?: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scratchpad'"
  );
  if (hasScratchpad?.name) {
    const pad = await conn.getAllAsync<{ content: string }>('SELECT content FROM scratchpad');
    for (const h of referencedHashes(pad)) out.add(h);
  }
  const hasCrdt = await conn.getFirstAsync<{ name?: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'crdt_updates'"
  );
  if (hasCrdt?.name) {
    const updates = await conn.getAllAsync<{ update: Uint8Array }>('SELECT "update" FROM crdt_updates');
    const decoder = new TextDecoder('utf-8', { fatal: false });
    for (const row of updates) {
      if (row.update) {
        for (const h of referencedHashes([decoder.decode(row.update)])) out.add(h);
      }
    }
  }
};

// Re-encrypts a profile's attachments when setProfileEncryption converts a profile between plain and PIN-protected.
registerAttachmentEncryptionHook(async (profileId, conn, oldKeyHex, newKeyHex) => {
  const mainDir = filesDir();
  const scopedDir = profileFilesDir(profileId);
  if (!(await FileSystem.getInfoAsync(mainDir)).exists) return;

  const profileHashes = new Set<string>();
  await extractHashesFromOpenConn(conn, profileHashes);

  const oldKey = oldKeyHex && oldKeyHex.length === 64 ? deriveFromProfileKey(oldKeyHex) : await getOrCreateInstallKey();
  const newKey = newKeyHex && newKeyHex.length === 64 ? deriveFromProfileKey(newKeyHex) : await getOrCreateInstallKey();
  try {
    if (newKeyHex) {
      // Converting to protected: encrypt referenced attachments into profile-scoped directory.
      for (const hash of profileHashes) {
        const srcUri = `${mainDir}${hash}`;
        const dstUri = `${scopedDir}${hash}`;
        if (!(await FileSystem.getInfoAsync(srcUri)).exists) continue;
        try {
          const plain = await decryptBytes(await readRawBytes(srcUri), oldKey);
          const reencrypted = await encryptBytes(plain, newKey);
          await writeAtomically(scopedDir, dstUri, reencrypted);
        } catch {}
      }
    } else {
      // Converting to plain: decrypt profile-scoped attachments back to main directory with install key.
      const scopedEntries = await FileSystem.readDirectoryAsync(scopedDir).catch(() => [] as string[]);
      for (const name of scopedEntries) {
        if (!ATTACHMENT_HASH_RE.test(name)) continue;
        const srcUri = `${scopedDir}${name}`;
        const dstUri = `${mainDir}${name}`;
        try {
          const plain = await decryptBytes(await readRawBytes(srcUri), oldKey);
          if (!(await canDecryptFileWithKey(dstUri, newKey, name))) {
            const reencrypted = await encryptBytes(plain, newKey);
            await writeAtomically(mainDir, dstUri, reencrypted);
          }
          await FileSystem.deleteAsync(srcUri, { idempotent: true });
        } catch {}
      }
    }
  } finally {
    oldKey.fill(0);
    newKey.fill(0);
  }
});

const collectAllProfileIds = async (): Promise<string[]> => {
  const ids = new Set<string>();
  const storedRaw = await AsyncStorage.getItem('profiles');
  if (storedRaw) {
    const parsed = JSON.parse(storedRaw) as { id: string }[];
    for (const p of parsed) {
      if (p?.id) ids.add(p.id);
    }
  }
  const dbDirUri = `file://${SQLite.defaultDatabaseDirectory}`;
  const dbFiles = await FileSystem.readDirectoryAsync(dbDirUri).catch(() => [] as string[]);
  for (const file of dbFiles) {
    if (file === 'notespark.db') {
      ids.add('default');
    } else {
      const m = file.match(/^notespark-(.+)\.db$/);
      if (m && !file.endsWith('.old') && !file.endsWith('.new')) {
        ids.add(m[1]);
      }
    }
  }
  return [...ids];
};

const collectHashesFromProfileDb = async (profileId: string, out: Set<string>): Promise<void> => {
  if ((await isProfileLockedWithoutKey(profileId)) && !(await getProfileKey(profileId))) {
    throw new Error(`Profile ${profileId} is locked`);
  }
  const dbUri = `file://${SQLite.defaultDatabaseDirectory}/${dbName(profileId)}`;
  const dbInfo = await FileSystem.getInfoAsync(dbUri);
  if (!dbInfo.exists) {
    // If a stored profile has a PIN or backup entry but its DB file is missing/unreadable, abort pruning.
    const pin = await SecureStore.getItemAsync(`profilePin_${profileId}`);
    if (pin) throw new Error(`Protected profile ${profileId} database is missing`);
    return;
  }

  await withDatabaseLock(async () => {
    const conn = await openProfileConnection(profileId, { useNewConnection: true });
    try {
      // Must verify the connection can read the notes table; if notes table is missing in an existing DB, check sqlite_master.
      const hasNotes = await conn.getFirstAsync<{ name?: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notes'"
      );
      if (hasNotes?.name) {
        const notes = await conn.getAllAsync<{ content: string }>('SELECT content FROM notes');
        for (const h of referencedHashes(notes)) out.add(h);
      }
      const hasVersions = await conn.getFirstAsync<{ name?: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'note_versions'"
      );
      if (hasVersions?.name) {
        const versions = await conn.getAllAsync<{ content: string }>('SELECT content FROM note_versions');
        for (const h of referencedHashes(versions)) out.add(h);
      }
      const hasScratchpad = await conn.getFirstAsync<{ name?: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scratchpad'"
      );
      if (hasScratchpad?.name) {
        const pad = await conn.getAllAsync<{ content: string }>('SELECT content FROM scratchpad');
        for (const h of referencedHashes(pad)) out.add(h);
      }
      const hasCrdt = await conn.getFirstAsync<{ name?: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'crdt_updates'"
      );
      if (hasCrdt?.name) {
        const updates = await conn.getAllAsync<{ update: Uint8Array }>('SELECT "update" FROM crdt_updates');
        const decoder = new TextDecoder('utf-8', { fatal: false });
        for (const row of updates) {
          if (row.update) {
            const decoded = decoder.decode(row.update);
            for (const h of referencedHashes([decoded])) out.add(h);
          }
        }
      }
    } finally {
      await conn.closeAsync();
    }
  });
};

// Scans every profile (notes, trashed notes, versions, scratchpad, CRDT updates) and deletes unreferenced
// attachment files older than 24 hours. Aborts without deleting anything if any profile DB cannot be read.
export const pruneAttachments = async (nowMs: number = Date.now()): Promise<number> => {
  const rootInfo = await FileSystem.getInfoAsync(filesDir()).catch(() => null);
  if (!rootInfo?.exists) return 0;

  const used = new Set<string>();
  try {
    const profileIds = await collectAllProfileIds();
    for (const profileId of profileIds) {
      await collectHashesFromProfileDb(profileId, used);
    }
  } catch {
    // Any unreadable or locked profile aborts pruning completely so no in-use attachment is ever deleted.
    return 0;
  }

  let deleted = 0;
  const scanDir = async (dirUri: string) => {
    const entries = await FileSystem.readDirectoryAsync(dirUri).catch(() => [] as string[]);
    for (const entry of entries) {
      const fullUri = `${dirUri}${entry}`;
      const info = await FileSystem.getInfoAsync(fullUri).catch(() => null);
      if (!info?.exists) continue;
      if (info.isDirectory) {
        if (entry.startsWith('profile-')) {
          await scanDir(`${fullUri}/`);
        }
        continue;
      }
      const mtimeMs = (info.modificationTime ?? 0) * 1000;
      const ageMs = nowMs - mtimeMs;
      if (entry.includes('.tmp.')) {
        if (ageMs >= ATTACHMENT_GRACE_MS) {
          await FileSystem.deleteAsync(fullUri, { idempotent: true });
          deleted++;
        }
        continue;
      }
      if (!ATTACHMENT_HASH_RE.test(entry)) continue;
      if (used.has(entry.toLowerCase())) continue;
      if (ageMs >= ATTACHMENT_GRACE_MS) {
        await FileSystem.deleteAsync(fullUri, { idempotent: true });
        deleted++;
      }
    }
  };

  await scanDir(filesDir());
  return deleted;
};
