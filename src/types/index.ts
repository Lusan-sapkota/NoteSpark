export interface Note {
  id: number;
  title: string;
  content: string;
  isMarkdown: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RootStackParamList = {
  Home: undefined;
  Editor: { noteId?: string } | undefined;
  NoteView: { noteId: string } | undefined;
  Settings: undefined;
  ImportExport: undefined;
  About: undefined;
};