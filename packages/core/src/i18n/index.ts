import { Catalog, Params, registerCatalog, translate } from './translate';
import { en } from './locales/en';

registerCatalog('en', en as Catalog);

// A key without its plural suffix is what code passes: 'tasks.count' picks tasks.count_one or tasks.count_other by `count`.
type StripPlural<K extends string> = K extends `${infer B}_${'zero' | 'one' | 'two' | 'few' | 'many' | 'other'}` ? B : K;
export type TKey = StripPlural<keyof typeof en>;

export const t = (key: TKey, params?: Params) => translate(key, params);
export * from './translate';
