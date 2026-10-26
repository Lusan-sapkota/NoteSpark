// Stands in for Mobile/src/storage/semanticSearch.ts; availability is asked once at start since the phone's check is sync.
import type * as Real from '../../../../../../Mobile/src/storage/semanticSearch';
import { storageProxy } from '../../bridge';

let available = false;
export const setMeaningSearchAvailable = (value: boolean) => { available = value; };
export const isMeaningSearchAvailable = () => available;

export const { searchByMeaning, syncSearchIndex, relatedNotes } = storageProxy<typeof Real>('semanticSearch', ['searchByMeaning', 'syncSearchIndex', 'relatedNotes'] as const);
