// @expo/vector-icons only needs to register its icon font. The FontFace API does that without expo-modules-core
// and without inline <style> (the CSP has no 'unsafe-inline').
const loaded = new Set<string>();
export const isLoaded = (name: string) => loaded.has(name);
export const loadAsync = async (fonts: string | Record<string, string>) => {
  if (typeof fonts === 'string') return;
  await Promise.all(Object.entries(fonts).map(async ([name, url]) => {
    if (loaded.has(name)) return;
    const face = new FontFace(name, `url(${url})`);
    document.fonts.add(await face.load());
    loaded.add(name);
  }));
};
// Only used by getImageSource, which the desktop never calls; declared so the bundler doesn't warn.
export const renderToImageAsync = undefined;
