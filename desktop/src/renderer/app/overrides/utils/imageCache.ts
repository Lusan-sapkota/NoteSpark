// Same shape as the phone's imageCache; pictures load straight from their address, stored pictures (attachment:<hash>) from their stored copy.
// ponytail: no on-disk cache. Web pictures are only requested once "Show web images" is on (the window's request filter checks it too).
import { useCallback, useEffect, useState } from 'react';
import { attachmentImageHash, attachmentImageLoader } from '@notespark/core';
import { readAttachment } from '../storage/attachments';
import { isWebImagesOn } from '../../../../../../mobile/src/utils/webImages';

export const isWebImage = (uri: string) => /^https?:\/\//i.test(uri);
const loadAttachmentImage = attachmentImageLoader(readAttachment);
export const keepDeviceImage = async (uri: string) => uri;
export const pruneImageCache = async (_noteContents: string[]) => {};

export type CachedImage = {
  src: string | null;
  status: 'loading' | 'ready' | 'gone' | 'failed' | 'off';
  retry: () => void;
  onError: () => void;
};

export const useCachedImage = (uri: string): CachedImage => {
  const web = isWebImage(uri);
  const stored = attachmentImageHash(uri);
  const [status, setStatus] = useState<CachedImage['status']>(web || stored ? 'loading' : 'ready');
  const [shown, setShown] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (stored) {
      let active = true;
      setStatus('loading');
      loadAttachmentImage(stored).then(src => { if (!active) return; setShown(src); setStatus(src ? 'ready' : 'failed'); });
      return () => { active = false; };
    }
    if (!web) return;
    let active = true;
    isWebImagesOn().then(on => active && setStatus(on ? 'ready' : 'off'));
    return () => { active = false; };
  }, [web, stored, uri, attempt]);
  const retry = useCallback(() => setAttempt(a => a + 1), []);
  const onError = useCallback(() => setStatus(isWebImage(uri) ? 'failed' : 'gone'), [uri]);
  return { src: status === 'ready' ? (stored ? shown : uri) : null, status, retry, onError };
};
