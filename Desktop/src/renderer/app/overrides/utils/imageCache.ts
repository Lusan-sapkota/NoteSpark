// Same shape as the phone's imageCache; pictures load straight from their address, phone file paths show "gone".
// ponytail: no on-disk cache; web pictures are not loaded at all (the page's security policy blocks them).
import { useCallback, useState } from 'react';

export const isWebImage = (uri: string) => /^https?:\/\//i.test(uri);
export const keepDeviceImage = async (uri: string) => uri;
export const pruneImageCache = async (_noteContents: string[]) => {};

export type CachedImage = {
  src: string | null;
  status: 'loading' | 'ready' | 'gone' | 'failed';
  retry: () => void;
  onError: () => void;
};

export const useCachedImage = (uri: string): CachedImage => {
  const [status, setStatus] = useState<CachedImage['status']>('ready');
  const retry = useCallback(() => setStatus('ready'), []);
  const onError = useCallback(() => setStatus(isWebImage(uri) ? 'failed' : 'gone'), [uri]);
  return { src: status === 'ready' ? uri : null, status, retry, onError };
};
