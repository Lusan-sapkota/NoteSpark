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

export type RootStackParamList = {
  // binnedNoteId: set by the note page after moving a note to the bin; tag: a tag tapped on the note page.
  Home: { binnedNoteId?: number; tag?: string } | undefined;
  Editor: { noteId?: string; title?: string } | undefined; // title: prefill for a new note (from a [[link]])
  NoteView: { noteId: string } | undefined;
  Settings: undefined;
  ImportExport: undefined;
  About: undefined;
  Privacy: undefined;
  Tasks: undefined;
  Bin: undefined;
};