import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { I18nManager, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isRtl, LanguageCode, resolveLanguage, setLanguage, t } from '@notespark/core';

// 'system' follows the phone or computer; otherwise the language the person picked in Settings.
export type LanguagePreference = 'system' | LanguageCode;
const KEY = 'language';

export const deviceLocale = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().locale; } catch { return 'en'; }
};
const languageFor = (preference: LanguagePreference): LanguageCode => (preference === 'system' ? resolveLanguage(deviceLocale()) : preference);

interface I18nValue {
  t: typeof t;
  language: LanguageCode;
  preference: LanguagePreference;
  // Resolves to true when the layout direction changed and the phone app must restart to apply it.
  setPreference: (preference: LanguagePreference) => Promise<boolean>;
}
const I18nContext = createContext<I18nValue>({ t, language: 'en', preference: 'system', setPreference: async () => false });

// Phone: the layout direction is the system's, forced and applied at the next start. Desktop and web: the page direction, at once.
const applyDirection = (language: LanguageCode): boolean => {
  const rtl = isRtl(language);
  if (typeof document !== 'undefined') {
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
    return false;
  }
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  return true;
};

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preference, setPreferenceState] = useState<LanguagePreference>('system');
  const [language, setLanguageState] = useState<LanguageCode>('en');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .catch(() => null)
      .then(saved => {
        const pref = (saved as LanguagePreference | null) ?? 'system';
        const code = languageFor(pref);
        setLanguage(code);
        applyDirection(code);
        setPreferenceState(pref);
        setLanguageState(code);
        setLoaded(true);
      });
  }, []);

  const setPreference = useCallback(async (pref: LanguagePreference) => {
    const code = languageFor(pref);
    setLanguage(code);
    const restart = applyDirection(code);
    setPreferenceState(pref);
    setLanguageState(code);
    await (pref === 'system' ? AsyncStorage.removeItem(KEY) : AsyncStorage.setItem(KEY, pref)).catch(() => {});
    return restart;
  }, []);

  const value = useMemo(() => ({ t, language, preference, setPreference }), [language, preference, setPreference]);
  // Desktop and web: react-native-web flips left and right styles below an element with dir="rtl" (the page's own dir only mirrors flex rows).
  const web = typeof document !== 'undefined';
  return (
    <I18nContext.Provider value={value}>
      {!loaded ? null : web ? <View style={{ flex: 1 }} {...({ dir: isRtl(language) ? 'rtl' : 'ltr' } as object)}>{children}</View> : children}
    </I18nContext.Provider>
  );
};

// Components use this so they redraw when the language changes; code outside components can import `t` from '@notespark/core'.
export const useI18n = () => useContext(I18nContext);
