// theme.ts only needs the two navigation themes to feed adaptNavigationTheme.
const base = { dark: false, colors: { primary: '', background: '', card: '', text: '', border: '', notification: '' }, fonts: {} as any };
export const DefaultTheme = base;
export const DarkTheme = { ...base, dark: true };
