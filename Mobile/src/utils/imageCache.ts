import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

// Web images in notes are downloaded once into app storage (not the OS cache, which Android may clear),
// so they keep showing offline and survive the original link going dead. A cached image is removed only
// when no note uses it anymore and it hasn't been viewed for 30 days (checked at app start).
const CACHE_DIR = `${FileSystem.documentDirectory}image-cache/`;
const INDEX_KEY = 'imageCacheIndex'; // { [fileName]: last viewed, ms }
const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_MS = 30 * DAY_MS;

export const isWebImage = (uri: string) => /^https?:\/\//i.test(uri);

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
      index = JSON.parse((await AsyncStorage.getItem(INDEX_KEY)) ?? '{}') ?? {};
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

// ready: cached file path. gone: the server says the image doesn't exist (or isn't an image).
// failed: couldn't reach it (offline, timeout, storage full); worth retrying later.
type Result = { status: 'ready'; path: string } | { status: 'gone' | 'failed' };

const inflight = new Map<string, Promise<Result>>();

const download = async (url: string, name: string): Promise<Result> => {
  const path = CACHE_DIR + name;
  const part = `${path}.part`;
  try {
    if ((await FileSystem.getInfoAsync(path)).exists) {
      await markViewed(name);
      return { status: 'ready', path };
    }
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true }).catch(() => {});
    // Download beside the final name and move it in only when complete, so a killed app never leaves a half file.
    const res = await FileSystem.downloadAsync(url, part);
    const type = Object.entries(res.headers ?? {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? '';
    const lowerType = type.toLowerCase();
    // Some servers label images as octet-stream; those are kept and the image view decides.
    const notAnImage = !!lowerType && !lowerType.startsWith('image/') && !lowerType.startsWith('application/octet-stream');
    if (res.status < 200 || res.status >= 300 || notAnImage) {
      await FileSystem.deleteAsync(part, { idempotent: true });
      // Server errors, timeouts and rate limits are temporary; anything else means the image isn't there.
      const temporary = res.status >= 500 || res.status === 408 || res.status === 429;
      return { status: temporary ? 'failed' : 'gone' };
    }
    await FileSystem.moveAsync({ from: part, to: path });
    await markViewed(name);
    return { status: 'ready', path };
  } catch {
    await FileSystem.deleteAsync(part, { idempotent: true }).catch(() => {});
    return { status: 'failed' };
  }
};

const getCachedImage = (url: string): Promise<Result> => {
  const name = fileNameFor(url);
  let job = inflight.get(name);
  if (!job) {
    job = download(url, name).finally(() => inflight.delete(name));
    inflight.set(name, job);
  }
  return job;
};

// Drops a cached file the image view couldn't decode, so the next try downloads it fresh.
const forgetCachedImage = (url: string) =>
  FileSystem.deleteAsync(CACHE_DIR + fileNameFor(url), { idempotent: true }).catch(() => {});

// Images picked from the phone are copied here: the picker's own copy sits in the OS cache, which Android may clear.
const DEVICE_DIR = `${FileSystem.documentDirectory}note-images/`;

export const keepDeviceImage = async (uri: string): Promise<string> => {
  await FileSystem.makeDirectoryAsync(DEVICE_DIR, { intermediates: true }).catch(() => {});
  const ext = uri.match(/\.(png|jpe?g|gif|webp|heic)$/i)?.[1]?.toLowerCase() ?? 'jpg';
  const path = `${DEVICE_DIR}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
  await FileSystem.copyAsync({ from: uri, to: path });
  return path;
};

// Removes copied phone images no note or version mentions. A week's grace keeps images in unsaved drafts.
const pruneDeviceImages = async (allText: string) => {
  for (const name of await FileSystem.readDirectoryAsync(DEVICE_DIR).catch(() => [] as string[])) {
    if (allText.includes(name)) continue;
    const info = await FileSystem.getInfoAsync(DEVICE_DIR + name);
    if (info.exists && Date.now() - info.modificationTime * 1000 > 7 * DAY_MS) {
      await FileSystem.deleteAsync(DEVICE_DIR + name, { idempotent: true });
    }
  }
};

// Called once at app start with every note's text. Keeps any image a note still uses; removes the rest
// once unviewed for 30 days, plus leftover partial downloads.
export const pruneImageCache = async (noteContents: string[]) => {
  try {
    await pruneDeviceImages(noteContents.join('\n'));
    const used = new Set<string>();
    for (const content of noteContents) {
      for (const m of content.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)|\[Image: ([^\]]+)\]/g)) {
        const uri = (m[1] ?? m[2]).trim();
        if (isWebImage(uri)) used.add(fileNameFor(uri));
      }
    }
    const idx = await loadIndex();
    const files = await FileSystem.readDirectoryAsync(CACHE_DIR).catch(() => [] as string[]);
    const kept: Record<string, number> = {};
    for (const name of files) {
      const stale = Date.now() - (idx[name] ?? 0) > KEEP_MS;
      if (name.endsWith('.part') || (!used.has(name) && stale)) {
        await FileSystem.deleteAsync(CACHE_DIR + name, { idempotent: true });
      } else {
        kept[name] = idx[name] ?? Date.now();
      }
    }
    index = kept;
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(kept));
  } catch {}
};

export type CachedImage = {
  src: string | null;
  status: 'loading' | 'ready' | 'gone' | 'failed';
  retry: () => void;
  // Call from the Image's onError: the file (or device image) couldn't be shown.
  onError: () => void;
};

// Device images (file://, content://, data:) pass straight through; web images resolve to their cached copy.
export const useCachedImage = (uri: string): CachedImage => {
  const web = isWebImage(uri);
  const [state, setState] = useState<{ src: string | null; status: CachedImage['status'] }>(
    web ? { src: null, status: 'loading' } : { src: uri, status: 'ready' }
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!web) {
      setState({ src: uri, status: 'ready' });
      return;
    }
    let active = true;
    setState({ src: null, status: 'loading' });
    getCachedImage(uri).then(result => {
      if (!active) return;
      setState(result.status === 'ready' ? { src: result.path, status: 'ready' } : { src: null, status: result.status });
    });
    return () => {
      active = false;
    };
  }, [uri, web, attempt]);

  const retry = useCallback(() => setAttempt(a => a + 1), []);
  const onError = useCallback(() => {
    if (web) forgetCachedImage(uri);
    setState({ src: null, status: 'failed' });
  }, [uri, web]);

  return { ...state, retry, onError };
};
