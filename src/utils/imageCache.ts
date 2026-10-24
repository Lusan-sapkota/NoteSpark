import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

// Web images in notes are downloaded once into app storage (not the OS cache, which Android may clear),
// so they keep showing offline. An image not viewed for 30 days is removed at the next app start.
const CACHE_DIR = `${FileSystem.documentDirectory}image-cache/`;
const INDEX_KEY = 'imageCacheIndex'; // { [fileName]: last viewed, ms }
const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_MS = 30 * DAY_MS;

const isWebImage = (uri: string) => /^https?:\/\//i.test(uri);

// ponytail: two 32-bit string hashes name the file; a collision would show the wrong image. Use SHA-256 (expo-crypto) if that ever matters.
const fileNameFor = (url: string) => {
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    fnv = Math.imul(fnv ^ c, 16777619);
    djb = (Math.imul(djb, 33) + c) | 0;
  }
  const ext = url.match(/\.(png|jpe?g|gif|webp)(?:[?#]|$)/i)?.[1]?.toLowerCase() ?? 'img';
  return `${(fnv >>> 0).toString(36)}${(djb >>> 0).toString(36)}.${ext}`;
};

let index: Record<string, number> | null = null;
const loadIndex = async () => {
  if (!index) {
    try {
      index = JSON.parse((await AsyncStorage.getItem(INDEX_KEY)) ?? '{}');
    } catch {
      index = {};
    }
  }
  return index!;
};

const markViewed = async (name: string) => {
  const idx = await loadIndex();
  if (Date.now() - (idx[name] ?? 0) < DAY_MS) return; // once a day per image is enough
  idx[name] = Date.now();
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(idx)).catch(() => {});
};

const inflight = new Map<string, Promise<string | null>>();

// Local path of the cached copy, downloading it first if needed. Null if it can't be fetched.
const getCachedImage = (url: string): Promise<string | null> => {
  const name = fileNameFor(url);
  const path = CACHE_DIR + name;
  let job = inflight.get(name);
  if (!job) {
    job = (async () => {
      try {
        if (!(await FileSystem.getInfoAsync(path)).exists) {
          await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true }).catch(() => {});
          const res = await FileSystem.downloadAsync(url, path);
          if (res.status < 200 || res.status >= 300) {
            await FileSystem.deleteAsync(path, { idempotent: true });
            return null;
          }
        }
        await markViewed(name);
        return path;
      } catch {
        await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
        return null;
      } finally {
        inflight.delete(name);
      }
    })();
    inflight.set(name, job);
  }
  return job;
};

// Deletes cached images not viewed for 30 days. Called once at app start.
export const pruneImageCache = async () => {
  try {
    const idx = await loadIndex();
    const files = await FileSystem.readDirectoryAsync(CACHE_DIR).catch(() => [] as string[]);
    const kept: Record<string, number> = {};
    for (const name of files) {
      if (Date.now() - (idx[name] ?? 0) > KEEP_MS) {
        await FileSystem.deleteAsync(CACHE_DIR + name, { idempotent: true });
      } else {
        kept[name] = idx[name];
      }
    }
    index = kept;
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(kept));
  } catch {}
};

// Device images pass straight through. Web images resolve to their cached copy, or to the web address
// if the download fails. Null while a first download is in progress.
export const useCachedImage = (uri: string) => {
  const [src, setSrc] = useState<string | null>(isWebImage(uri) ? null : uri);
  useEffect(() => {
    if (!isWebImage(uri)) {
      setSrc(uri);
      return;
    }
    let active = true;
    setSrc(null);
    getCachedImage(uri).then(local => {
      if (active) setSrc(local ?? uri);
    });
    return () => {
      active = false;
    };
  }, [uri]);
  return src;
};
