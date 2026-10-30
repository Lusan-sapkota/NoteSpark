// Desktop notifications: task reminders (work with the window closed) and "Save clipboard text".
import { execFile } from 'node:child_process';
import { clipboard, Notification } from 'electron';
import { buildReminders, REMINDER_ID_PREFIX, type ProfileTasks } from '@notespark/core';
import * as notes from '../../../mobile/src/storage/notes';
import * as profiles from '../../../mobile/src/storage/profiles';
import AsyncStorage from '@notespark/node-shims/async-storage';

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
  let readAt = 0;
  let reminders = buildReminders([]);
  const tick = async () => {
    await (await import('./storage')).lockStatus(); // storage has started: profiles converted and the default one open
    const stored = Number(await AsyncStorage.getItem('reminderHour'));
    const chosen = HOURS.includes(stored) ? stored : 9;
    if (notes.getNotesVersion() !== version || chosen !== hour || Date.now() - readAt > RECHECK_MS) {
      version = notes.getNotesVersion();
      hour = chosen;
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
  if (!text) return say('Nothing to save', 'Copy some text first.');
  try {
    if ((await call('getShareTarget')) === 'scratchpad') {
      const pad = (await call('getScratchpad')) as string;
      await call('saveScratchpad', pad.trimEnd() ? `${pad.trimEnd()}\n\n${text}` : text);
      say('Added to scratchpad', text.slice(0, 120));
    } else {
      const now = new Date().toISOString();
      await call('saveNote', { title: text.split('\n')[0].slice(0, 60), content: text, isMarkdown: false, createdAt: now, updatedAt: now });
      say('Note saved', text.slice(0, 120));
    }
  } catch (error) {
    say("Couldn't save the text", error instanceof Error && error.message === 'PROFILE_LOCKED' ? 'Unlock NoteSpark, then try again.' : 'Try again.');
  }
};
