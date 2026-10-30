// Write-then-share only: files are kept in memory and sharing downloads them (see sharing.ts).
export const cacheDirectory = 'cache://';
export const EncodingType = { UTF8: 'utf8', Base64: 'base64' } as const;

export const files = new Map<string, string | Uint8Array>();
export const writeAsStringAsync = async (uri: string, text: string, _options?: unknown) => { files.set(uri, text); };
export const writeBytes = (uri: string, bytes: Uint8Array) => { files.set(uri, bytes); };
export const deleteAsync = async (uri: string, _options?: unknown) => { files.delete(uri); };
