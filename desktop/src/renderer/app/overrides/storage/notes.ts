// Stands in for mobile/src/storage/notes.ts in the desktop renderer: the real module runs in the main process.
import type * as Real from '../../../../../../mobile/src/storage/notes';
import { storageProxy } from '../../bridge';

// Same idea as changesNotes on the phone: bumped after every write, so screens can skip a reload.
let notesVersion = 0;
export const getNotesVersion = () => notesVersion;

// Notes written by a paired device arrive in the main process; it tells the window.
const remoteListeners = new Set<() => void>();
window.notespark?.onNotesRemote(() => { notesVersion++; remoteListeners.forEach(l => l()); });
export const onRemoteApplied = (listener: () => void) => {
  remoteListeners.add(listener);
  return () => void remoteListeners.delete(listener);
};
const writes = new Set(['saveNote', 'updateNote', 'moveNoteToBin', 'restoreNote', 'emptyBin', 'deleteNote', 'setNotePinned', 'setNoteArchived', 'setNoteStyle', 'moveAllNotesToBin', 'restoreBatch', 'deleteAllNotesForever', 'importNotes', 'saveScratchpad', 'toggleTaskInNote', 'restoreTaskLine', 'deleteTaskLine', 'insertTaskLine', 'addTaskToNote']);

const api = storageProxy<typeof Real>('notes', [
  'getNotes', 'getNotesWithLinks', 'getNoteById', 'getDraft', 'saveDraft', 'clearDraft', 'getScratchpad', 'saveScratchpad',
  'getShareTarget', 'setShareTarget', 'getScratchpadNote', 'saveNote', 'getNoteVersions', 'updateNote', 'moveNoteToBin',
  'restoreNote', 'getBinNotes', 'emptyBin', 'deleteNote', 'setNotePinned', 'setNoteArchived', 'setNoteStyle', 'toggleTaskInNote',
  'restoreTaskLine', 'deleteTaskLine', 'insertTaskLine', 'addTaskToNote', 'moveAllNotesToBin', 'restoreBatch', 'deleteAllNotesForever', 'exportNotesAsJson', 'importNotes', 'getReviewData', 'addReviews', 'getSettingsData', 'addSettings',
] as const, name => { if (writes.has(name)) notesVersion++; });

export const {
  getNotes, getNotesWithLinks, getNoteById, getDraft, saveDraft, clearDraft, getScratchpad, saveScratchpad, getShareTarget,
  setShareTarget, getScratchpadNote, saveNote, getNoteVersions, updateNote, moveNoteToBin, restoreNote, getBinNotes, emptyBin,
  deleteNote, setNotePinned, setNoteArchived, setNoteStyle, toggleTaskInNote, restoreTaskLine, deleteTaskLine, insertTaskLine, addTaskToNote, moveAllNotesToBin, restoreBatch,
  deleteAllNotesForever, exportNotesAsJson, importNotes, getReviewData, addReviews, getSettingsData, addSettings,
} = api;

export const SCRATCHPAD_ID = 0; // same value as the phone's module
export type { ShareTarget, ImportMode, EditorDraft } from '../../../../../../mobile/src/storage/notes';
