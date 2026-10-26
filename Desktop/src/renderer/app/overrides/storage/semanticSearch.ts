// Search by meaning needs the ONNX model and sqlite-vec, which come to the desktop later (phase 5).
export const isMeaningSearchAvailable = () => false;
export const searchByMeaning = async (_query: string): Promise<number[] | null> => null;
export const syncSearchIndex = async (): Promise<void> => {};
export const relatedNotes = async (_noteId: number, _limit = 5): Promise<number[]> => [];
