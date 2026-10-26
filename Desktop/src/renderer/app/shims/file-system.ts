// expo-file-system/legacy for the desktop renderer, just for "write a file, then share it": the file is kept in memory
// and sharing it (see sharing.ts) downloads it.
export const cacheDirectory = 'cache://';
export const EncodingType = { UTF8: 'utf8', Base64: 'base64' } as const;

export const files = new Map<string, string | Uint8Array>();
export const writeAsStringAsync = async (uri: string, text: string, _options?: unknown) => { files.set(uri, text); };
export const writeBytes = (uri: string, bytes: Uint8Array) => { files.set(uri, bytes); };
export const deleteAsync = async (uri: string, _options?: unknown) => { files.delete(uri); };
