// expo-image-picker for the desktop: the browser's file picker, then the picture is stored by the main process
// and the note gets its address (/images/<id>.png), which works in the window and the web view.
import { invoke } from '../bridge';

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export const launchImageLibraryAsync = (_options?: unknown) =>
  new Promise<{ canceled: boolean; assets: { uri: string }[] | null }>(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.addEventListener('cancel', () => resolve({ canceled: true, assets: null }));
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve({ canceled: true, assets: null });
      try {
        const uri = await invoke<string>('images:save', { data: await toBase64(file) });
        resolve({ canceled: false, assets: [{ uri }] });
      } catch (e) {
        window.alert(String((e as Error).message).replace(/^Error invoking remote method 'backend': Error: /, ''));
        resolve({ canceled: true, assets: null });
      }
    });
    input.click();
  });
