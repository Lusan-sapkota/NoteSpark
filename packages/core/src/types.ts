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
