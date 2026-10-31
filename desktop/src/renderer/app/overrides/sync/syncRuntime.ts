// Stands in for mobile/src/sync/syncRuntime.ts in the desktop renderer. The phone's sync client does not run here: the desktop's
// hub lives in the main process (src/main/sync.ts). Shared screens only call this after a profile switch.
export const reconcileSync = async (): Promise<void> => {};
