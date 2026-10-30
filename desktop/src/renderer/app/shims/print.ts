// The main process prints the page to a PDF, which is then shared (saved).
import { invoke } from '../bridge';
import { writeBytes } from './file-system';

export const printToFileAsync = async ({ html }: { html: string }) => {
  const base64 = await invoke<string>('pdf:render', { html });
  const uri = `cache://notespark-history-${Date.now()}.pdf`;
  writeBytes(uri, Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
  return { uri };
};
