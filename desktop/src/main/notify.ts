// Desktop notifications: task reminders (work with the window closed) and "Save clipboard text".
import { execFile } from 'node:child_process';
import { clipboard, Notification } from 'electron';
import { buildReminders, getLanguage, REMINDER_ID_PREFIX, t, type ProfileTasks } from '@notespark/core';
import * as notes from '../../../mobile/src/storage/notes';
import * as profiles from '../../../mobile/src/storage/profiles';
import AsyncStorage from '@notespark/node-shims/async-storage';
import { syncLanguage } from './language';

const say = (title: string, body: string, onClick?: () => void) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  if (onClick) n.on('click', onClick);
  // Some Linux desktops refuse Electron's notification call; notify-send reaches the same service (no click action).
  if (process.platform === 'linux') n.on('failed', () => execFile('notify-send', ['--app-name=NoteSpark', title, body], () => {}));
  n.show();
};

const FIRED_KEY = 'remindersFired';
const HOURS = [7, 8, 9, 12, 17, 20];
const RECHECK_MS = 30 * 60_000;

// Checks every minute, reading notes only on change, a new hour or after 30 minutes; missed reminders fire once that day.
export const startReminders = (open: () => void) => {
  let version = -1;
  let hour = -1;
  let language = '';
  let readAt = 0;
  let reminders = buildReminders([]);
  const tick = async () => {
    await syncLanguage();
    await (await import('./storage')).lockStatus(); // storage has started: profiles converted and the default one open
    const stored = Number(await AsyncStorage.getItem('reminderHour'));
    const chosen = HOURS.includes(stored) ? stored : 9;
    if (notes.getNotesVersion() !== version || chosen !== hour || getLanguage() !== language || Date.now() - readAt > RECHECK_MS) {
      version = notes.getNotesVersion();
      hour = chosen;
      language = getLanguage(); // titles are in the chosen language
      readAt = Date.now();
      const all: ProfileTasks[] = [];
      for (const p of await profiles.getProfiles()) {
        try {
          all.push({ id: p.id, name: p.name, locked: await profiles.hasProfilePin(p.id), notes: await profiles.readProfileNotes(p.id, { withScratchpad: true }) });
        } catch {}
      }
      const now = new Date();
      reminders = buildReminders(all, chosen, new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, -1));
    }
    const now = Date.now();
    const fired = new Set<string>(JSON.parse((await AsyncStorage.getItem(FIRED_KEY)) ?? '[]'));
    const due = reminders.filter(r => r.date.getTime() <= now && !fired.has(r.id));
    if (!due.length) return;
    due.forEach(r => { fired.add(r.id); say(r.title, r.body, open); });
    await AsyncStorage.setItem(FIRED_KEY, JSON.stringify([...fired].filter(id => id.startsWith(REMINDER_ID_PREFIX) && reminders.some(r => r.id === id))));
  };
  const run = () => tick().catch(error => console.warn('Task reminders failed:', error));
  // Not at start-up: the window gets the first seconds.
  setTimeout(run, 10_000).unref();
  setInterval(run, 60_000).unref();
};

// The clipboard text goes where the "Text shared to NoteSpark" setting says: the scratchpad, or a new note.
export const saveClipboard = async (call: (fn: string, ...args: unknown[]) => Promise<any>) => {
  const text = (await clipboard.readText()).trim();
  if (!text) return say(t('desktop.nothingToSave'), t('desktop.copyTextFirst'));
  try {
    if ((await call('getShareTarget')) === 'scratchpad') {
      const pad = (await call('getScratchpad')) as string;
      await call('saveScratchpad', pad.trimEnd() ? `${pad.trimEnd()}\n\n${text}` : text);
      say(t('desktop.addedToScratchpad'), text.slice(0, 120));
    } else {
      const now = new Date().toISOString();
      await call('saveNote', { title: text.split('\n')[0].slice(0, 60), content: text, isMarkdown: false, createdAt: now, updatedAt: now });
      say(t('desktop.noteSaved'), text.slice(0, 120));
    }
  } catch (error) {
    say(t('desktop.saveTextFailed'), error instanceof Error && error.message === 'PROFILE_LOCKED' ? t('desktop.unlockThenTryAgain') : t('desktop.tryAgainShort'));
  }
};
