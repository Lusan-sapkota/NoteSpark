// Same shape as the phone's Mobile/src/utils/imageCache.ts. Web pictures load straight from their address (the phone
// keeps a copy for offline use); pictures that point at files on the phone fail and show the "gone" state.
// ponytail: no on-disk cache yet; revisit with the editor in phase 3.
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
