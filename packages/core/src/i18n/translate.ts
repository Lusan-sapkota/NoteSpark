// The translator: pure, no React Native. Catalogs are flat objects of key -> text with {name} placeholders.
// Plural keys end in _zero, _one, _two, _few, _many or _other and are picked with the `count` param.
export type Params = Record<string, string | number>;
export type Catalog = Record<string, string>;

export const LANGUAGES = [
  { code: 'en', name: 'English', rtl: false },
  { code: 'es', name: 'Español', rtl: false },
  { code: 'fr', name: 'Français', rtl: false },
  { code: 'de', name: 'Deutsch', rtl: false },
  { code: 'pt', name: 'Português (Brasil)', rtl: false },
  { code: 'hi', name: 'हिन्दी', rtl: false },
  { code: 'ne', name: 'नेपाली', rtl: false },
  { code: 'bn', name: 'বাংলা', rtl: false },
  { code: 'id', name: 'Bahasa Indonesia', rtl: false },
  { code: 'zh', name: '简体中文', rtl: false },
  { code: 'ja', name: '日本語', rtl: false },
  { code: 'ko', name: '한국어', rtl: false },
  { code: 'ar', name: 'العربية', rtl: true },
] as const;
export type LanguageCode = (typeof LANGUAGES)[number]['code'];

const catalogs = new Map<string, Catalog>();
let current: string = 'en';

export const registerCatalog = (code: string, catalog: Catalog) => { catalogs.set(code, catalog); };
export const setLanguage = (code: string) => { current = catalogs.has(code) ? code : 'en'; };
export const getLanguage = () => current;
export const isRtl = (code: string = current) => LANGUAGES.some(l => l.code === code && l.rtl);

// A device locale tag ("pt-BR", "zh-Hans-CN", "in") to a language we have, else English.
export const resolveLanguage = (locale: string | null | undefined): LanguageCode => {
  const parts = (locale ?? '').toLowerCase().replace(/_/g, '-').split('-');
  const base = parts[0] === 'in' ? 'id' : parts[0];
  if (base === 'zh' && parts.some(p => ['hant', 'tw', 'hk', 'mo'].includes(p))) return 'en'; // Traditional Chinese isn't included
  return LANGUAGES.find(l => l.code === base)?.code ?? 'en';
};

const fill = (text: string, params?: Params) => text.replace(/\{(\w+)\}/g, (whole, name: string) => (params && name in params ? String(params[name]) : whole));

export const translate = (key: string, params?: Params): string => {
  const own = catalogs.get(current);
  const base = catalogs.get('en');
  if (params && typeof params.count === 'number') {
    const rule = new Intl.PluralRules(current).select(params.count);
    const shown = { ...params, count: new Intl.NumberFormat(current).format(params.count) };
    for (const c of [own, base]) for (const k of [`${key}_${rule}`, `${key}_other`]) if (c && k in c) return fill(c[k], shown);
  }
  for (const c of [own, base]) if (c && key in c) return fill(c[key], params);
  return key;
};
