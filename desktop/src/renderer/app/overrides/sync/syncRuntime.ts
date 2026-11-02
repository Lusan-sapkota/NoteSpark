// Stands in for mobile/src/sync/syncRuntime.ts in the desktop renderer. The phone's sync client does not run here: the desktop's
// hub lives in the main process (src/main/sync.ts). Shared screens only call this after a profile switch or before deleting a profile.
import { invoke } from '../../bridge';

export const reconcileSync = async (): Promise<void> => {};

export const syncedProfileWarning = async (profileId: string): Promise<string[] | null> => {
  try {
    const st = await invoke<{ pairedDevices?: string[]; profiles?: { id: string; synced: boolean; devices?: string[] }[] }>('sync', { op: 'status' });
    const p = st?.profiles?.find(x => x.id === profileId);
    if (!p?.synced) return null;
    if (p.devices?.length) return p.devices;
    if (st.pairedDevices?.length) return st.pairedDevices;
    return null;
  } catch {
    return null;
  }
};
