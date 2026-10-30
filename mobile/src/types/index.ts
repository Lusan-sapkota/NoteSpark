export type { Note, NoteVersion } from '@notespark/core';

export type RootStackParamList = {
  // binnedNoteId: set by the note page after moving a note to the bin; tag: a tag tapped on the note page.
  Home: { binnedNoteId?: number; tag?: string } | undefined;
  // title / text: prefill for a new note (from a [[link]], or text shared from another app).
  // draft: reopen the unsaved text kept by the editor (see getDraft).
  Editor: { noteId?: string; title?: string; text?: string; draft?: boolean } | undefined;
  NoteView: { noteId: string; find?: string } | undefined; // find: text to find in the note on open
  Settings: { message?: string } | undefined; // message: snackbar after the profile form closes
  ProfileLock: { profileId?: string } | undefined; // no id: new profile
  ImportExport: undefined;
  About: undefined;
  Privacy: undefined;
  Tasks: undefined;
  Scratchpad: { append?: string } | undefined; // append: shared text to add at the end
  Bin: undefined;
};