// Native in-place text styling exists on Android only (see android/). Everywhere else (desktop, web) these are no-ops: the desktop
// draws its own styled editor.
export interface StyledRun { start: number; end: number; bold: boolean; italic: boolean; strike: boolean; heading: number; marker: boolean }
export interface StyledLook {
  hideMarks: boolean; markColor: number; boldFamily: string; italicFamily: string; headingFamily: string; h1: number; h2: number; h3: number;
}
export const applyStyledRuns = (_viewTag: number, _length: number, _runs: StyledRun[], _look: StyledLook): void => {};
