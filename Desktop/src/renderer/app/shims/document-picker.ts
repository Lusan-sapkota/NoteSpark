// expo-document-picker for the desktop: the browser's file picker. Each file is read through a blob address.
export const getDocumentAsync = (options?: { multiple?: boolean }) =>
  new Promise<{ canceled: boolean; assets: { uri: string; name: string; size: number; mimeType?: string }[] | null }>(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = !!options?.multiple;
    input.addEventListener('cancel', () => resolve({ canceled: true, assets: null }));
    input.addEventListener('change', () => {
      const picked = [...(input.files ?? [])];
      resolve(picked.length
        ? { canceled: false, assets: picked.map(f => ({ uri: URL.createObjectURL(f), name: f.name, size: f.size, mimeType: f.type })) }
        : { canceled: true, assets: null });
    });
    input.click();
  });
