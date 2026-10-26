// profiles.ts imports this for fingerprint unlock; no test uses it.
export const hasHardwareAsync = async () => false;
export const isEnrolledAsync = async () => false;
export const authenticateAsync = async () => ({ success: false as const });
