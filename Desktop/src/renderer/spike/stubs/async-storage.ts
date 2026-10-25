// In-memory stand-in for AsyncStorage: the desktop will keep settings in the main process.
const store = new Map<string, string>();
export default {
  getItem: async (k: string) => store.get(k) ?? null,
  setItem: async (k: string, v: string) => void store.set(k, v),
  removeItem: async (k: string) => void store.delete(k),
};
