// Stands in for mobile/src/storage/notes.ts in the desktop renderer: the real module runs in the main process.
import type * as Real from '../../../../../../mobile/src/storage/notes';
import { storageProxy } from '../../bridge';

// Same idea as changesNotes on the phone: bumped after every write, so screens can skip a reload.
let notesVersion = 0;
export const getNotesVersion = () => notesVersion;
const writes = new Set(['saveNote', 'updateNote', 'moveNoteToBin', 'restoreNote', 'emptyBin', 'deleteNote', 'setNotePinned', 'setNoteArchived', 'moveAllNotesToBin', 'restoreBatch', 'deleteAllNotesForever', 'importNotes', 'saveScratchpad', 'toggleTaskInNote', 'restoreTaskLine', 'deleteTaskLine', 'insertTaskLine']);

const api = storageProxy<typeof Real>('notes', [
  'getNotes', 'getNotesWithLinks', 'getNoteById', 'getDraft', 'saveDraft', 'clearDraft', 'getScratchpad', 'saveScratchpad',
  'getShareTarget', 'setShareTarget', 'getScratchpadNote', 'saveNote', 'getNoteVersions', 'updateNote', 'moveNoteToBin',
  'restoreNote', 'getBinNotes', 'emptyBin', 'deleteNote', 'setNotePinned', 'setNoteArchived', 'toggleTaskInNote',
  'restoreTaskLine', 'deleteTaskLine', 'insertTaskLine', 'moveAllNotesToBin', 'restoreBatch', 'deleteAllNotesForever', 'exportNotesAsJson', 'importNotes',
] as const, name => { if (writes.has(name)) notesVersion++; });

export const {
  getNotes, getNotesWithLinks, getNoteById, getDraft, saveDraft, clearDraft, getScratchpad, saveScratchpad, getShareTarget,
  setShareTarget, getScratchpadNote, saveNote, getNoteVersions, updateNote, moveNoteToBin, restoreNote, getBinNotes, emptyBin,
  deleteNote, setNotePinned, setNoteArchived, toggleTaskInNote, restoreTaskLine, deleteTaskLine, insertTaskLine, moveAllNotesToBin, restoreBatch,
  deleteAllNotesForever, exportNotesAsJson, importNotes,
} = api;

export const SCRATCHPAD_ID = 0; // same value as the phone's module
export type { ShareTarget, ImportMode, EditorDraft } from '../../../../../../mobile/src/storage/notes';
