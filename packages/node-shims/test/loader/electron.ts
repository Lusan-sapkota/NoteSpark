// Stands in for 'electron' when desktop/src/main code runs in plain Node tests.
export const BrowserWindow = { getAllWindows: () => [] as unknown[] };
export default {};
