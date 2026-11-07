export interface Note {
  id: number;
  uuid?: string; // global id for sync; never changes (the numeric id is local to this device)
  title: string;
  content: string;
  isMarkdown: boolean;
  isPinned: boolean;
  isArchived: boolean; // hidden from Home (except the Archived filter) and Tasks, still exported
  color?: string | null; // key of a note colour (see mobile/src/theme/noteStyle.ts); null or missing is the default
  background?: string | null; // key of a background pattern
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
