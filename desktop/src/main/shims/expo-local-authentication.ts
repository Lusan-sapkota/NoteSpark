// No fingerprint or face unlock on desktop (the PIN still works).
export const hasHardwareAsync = async () => false;
export const isEnrolledAsync = async () => false;
export const authenticateAsync = async (_options?: unknown) => ({ success: false as const });
