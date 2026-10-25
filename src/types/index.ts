export interface Note {
  id: number;
  title: string;
  content: string;
  isMarkdown: boolean;
  isPinned: boolean;
  isArchived: boolean; // hidden from Home (except the Archived filter) and Tasks, still exported
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null; // set while the note is in the bin
}

export interface NoteVersion {
  id: number;
  noteId: number;
  title: string;
  content: string;
  isMarkdown: boolean;
  savedAt: string; // when this version was replaced
}

export type RootStackParamList = {
  // binnedNoteId: set by the note page after moving a note to the bin; tag: a tag tapped on the note page.
  Home: { binnedNoteId?: number; tag?: string } | undefined;
  // title / text: prefill for a new note (from a [[link]], or text shared from another app).
  // draft: reopen the unsaved text kept by the editor (see getDraft).
  Editor: { noteId?: string; title?: string; text?: string; draft?: boolean } | undefined;
  NoteView: { noteId: string } | undefined;
  Settings: { message?: string } | undefined; // message: snackbar after the profile form closes
  ProfileLock: { profileId?: string } | undefined; // no id: new profile
  ImportExport: undefined;
  About: undefined;
  Privacy: undefined;
  Tasks: undefined;
  Bin: undefined;
};