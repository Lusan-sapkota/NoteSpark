// Browser file picker; the editor stores the picked picture as an attachment, read from this local blob address.
export const launchImageLibraryAsync = (_options?: unknown) =>
  new Promise<{ canceled: boolean; assets: { uri: string; fileName: string; fileSize: number }[] | null }>(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.addEventListener('cancel', () => resolve({ canceled: true, assets: null }));
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve({ canceled: true, assets: null });
      resolve({ canceled: false, assets: [{ uri: URL.createObjectURL(file), fileName: file.name, fileSize: file.size }] });
    });
    input.click();
  });
