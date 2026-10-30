import type { Catalog, Params } from './translate';
import { registerCatalog, translate } from './translate';
import { en } from './locales/en';
import es from './locales/es';
import fr from './locales/fr';
import de from './locales/de';
import pt from './locales/pt';
import hi from './locales/hi';
import ne from './locales/ne';
import bn from './locales/bn';
import id from './locales/id';
import zh from './locales/zh';
import ja from './locales/ja';
import ko from './locales/ko';
import ar from './locales/ar';

registerCatalog('en', en as Catalog);
registerCatalog('es', es);
registerCatalog('fr', fr);
registerCatalog('de', de);
registerCatalog('pt', pt);
registerCatalog('hi', hi);
registerCatalog('ne', ne);
registerCatalog('bn', bn);
registerCatalog('id', id);
registerCatalog('zh', zh);
registerCatalog('ja', ja);
registerCatalog('ko', ko);
registerCatalog('ar', ar);


// A key without its plural suffix is what code passes: 'tasks.count' picks tasks.count_one or tasks.count_other by `count`.
type StripPlural<K extends string> = K extends `${infer B}_${'zero' | 'one' | 'two' | 'few' | 'many' | 'other'}` ? B : K;
export type TKey = StripPlural<keyof typeof en>;

export const t = (key: TKey, params?: Params) => translate(key, params);
export * from './translate';
