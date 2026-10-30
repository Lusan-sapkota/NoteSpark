export type { Note, NoteVersion } from '@notespark/core';

export type RootStackParamList = {
  // binnedNoteId: set by the note page after moving a note to the bin; tag: a tag tapped on the note page.
  Home: { binnedNoteId?: number; tag?: string } | undefined;
  // title / text: prefill for a new note (from a [[link]], or text shared from another app).
  // draft: reopen the unsaved text kept by the editor (see getDraft).
  // template: the text is a template, so it counts as the starting point (an untouched one leaves no note); markdown: its format.
  Editor: { noteId?: string; title?: string; text?: string; draft?: boolean; template?: boolean; markdown?: boolean } | undefined;
  NoteView: { noteId: string; find?: string } | undefined; // find: text to find in the note on open
  Settings: { message?: string } | undefined; // message: snackbar after the profile form closes
  ProfileLock: { profileId?: string } | undefined; // no id: new profile
  ImportExport: undefined;
  About: undefined;
  Privacy: undefined;
  Tasks: undefined;
  Scratchpad: { append?: string } | undefined; // append: shared text to add at the end
  Bin: undefined;
  Ask: undefined; // passages from your notes for a question
  Landscape: undefined; // the notebook grouped by meaning
  Review: undefined; // review cards
  Tidy: undefined; // link suggestions and possible duplicates
};