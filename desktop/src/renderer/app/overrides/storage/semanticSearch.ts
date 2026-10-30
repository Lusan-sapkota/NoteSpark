// Stands in for mobile/src/storage/semanticSearch.ts; availability is asked once at start since the phone's check is sync.
import type * as Real from '../../../../../../mobile/src/storage/semanticSearch';
import { storageProxy } from '../../bridge';

let available = false;
export const setMeaningSearchAvailable = (value: boolean) => { available = value; };
export const isMeaningSearchAvailable = () => available;

export const { searchByMeaning, syncSearchIndex, relatedNotes, relatedToText, searchPassages } = storageProxy<typeof Real>('semanticSearch', ['searchByMeaning', 'syncSearchIndex', 'relatedNotes', 'relatedToText', 'searchPassages'] as const);
export type { Passage } from '../../../../../../mobile/src/storage/semanticSearch';
