// The main process speaks the language chosen in Settings; 'system' or none follows the computer.
import { app } from 'electron';
import { resolveLanguage, setLanguage } from '@notespark/core';
import AsyncStorage from '@notespark/node-shims/async-storage';

export const syncLanguage = async () => {
  const saved = await AsyncStorage.getItem('language').catch(() => null);
  setLanguage(!saved || saved === 'system' ? resolveLanguage(app.getLocale()) : saved);
};
