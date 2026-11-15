// Stands in for 'electron' when desktop/src/main code runs in plain Node tests.
export const BrowserWindow = { getAllWindows: () => [] as unknown[] };
export const app = { getLocale: () => 'en-US' };
export const clipboard = { readText: () => '', writeText: () => {} };
export const Notification = Object.assign(function () {}, { isSupported: () => false });
export default {};
