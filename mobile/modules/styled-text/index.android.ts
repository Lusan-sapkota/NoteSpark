import { requireOptionalNativeModule } from 'expo';
import type { StyledLook, StyledRun } from './index';

// Null when the installed app was built without the module (an older development build): the box then stays unstyled.
const native = requireOptionalNativeModule<{ apply: (viewTag: number, length: number, runs: StyledRun[], look: StyledLook) => void }>('StyledText');

export type { StyledLook, StyledRun };
export const applyStyledRuns = (viewTag: number, length: number, runs: StyledRun[], look: StyledLook): void => native?.apply(viewTag, length, runs, look);
