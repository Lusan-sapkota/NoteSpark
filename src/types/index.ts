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
  Editor: { noteId?: number };
  Settings: undefined;
  ImportExport: undefined;
  About: undefined;
};