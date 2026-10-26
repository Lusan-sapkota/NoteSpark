// Stands in for Mobile/src/storage/semanticSearch.ts in the desktop renderer: the model and the vector index run in the
// main process. The phone's availability check is synchronous, so the shell asks once at start and stores the answer.
import type * as Real from '../../../../../../Mobile/src/storage/semanticSearch';
import { storageProxy } from '../../bridge';

let available = false;
export const setMeaningSearchAvailable = (value: boolean) => { available = value; };
export const isMeaningSearchAvailable = () => available;

export const { searchByMeaning, syncSearchIndex, relatedNotes } = storageProxy<typeof Real>('semanticSearch', ['searchByMeaning', 'syncSearchIndex', 'relatedNotes'] as const);
