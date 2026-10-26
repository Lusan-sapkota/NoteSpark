// expo-sharing for the desktop: "share" saves the file. The desktop window asks where; a browser downloads it.
import { files } from './file-system';

const mime: Record<string, string> = { json: 'application/json', zip: 'application/zip', pdf: 'application/pdf', md: 'text/markdown', txt: 'text/plain', html: 'text/html' };

export const isAvailableAsync = async () => true;
export const shareAsync = async (uri: string, _options?: unknown) => {
  const data = files.get(uri);
  if (data === undefined) throw new Error('Nothing to save');
  const name = uri.split('/').pop() ?? 'notespark';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data as BlobPart], { type: mime[name.split('.').pop() ?? ''] ?? 'application/octet-stream' }));
  a.download = name;
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); files.delete(uri); }, 10_000);
};
