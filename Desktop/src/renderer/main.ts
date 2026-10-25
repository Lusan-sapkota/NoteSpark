import { firefly } from '@notespark/core';

declare global {
  interface Window { notespark: { getTheme(): Promise<string>; setTheme(m: 'light' | 'dark' | 'system'): Promise<void> } }
}

const dark = matchMedia('(prefers-color-scheme: dark)'); // follows nativeTheme.themeSource
const apply = () => {
  const colors = firefly[dark.matches ? 'dark' : 'light'];
  for (const [role, value] of Object.entries(colors)) document.documentElement.style.setProperty(`--md-${role}`, value);
};
dark.addEventListener('change', apply);
apply();

const swatches = document.getElementById('swatches')!;
for (const [bg, fg] of [['primaryContainer', 'onPrimaryContainer'], ['secondaryContainer', 'onSecondaryContainer'], ['tertiaryContainer', 'onTertiaryContainer'], ['errorContainer', 'onErrorContainer'], ['surfaceContainerHigh', 'onSurface']]) {
  const el = document.createElement('div');
  el.style.setProperty('--bg', `var(--md-${bg})`);
  el.style.setProperty('--fg', `var(--md-${fg})`);
  el.textContent = bg;
  swatches.append(el);
}

const modes = document.getElementById('modes')!;
const modeButtons = (['system', 'light', 'dark'] as const).map(mode => {
  const b = document.createElement('button');
  b.textContent = mode[0].toUpperCase() + mode.slice(1);
  b.onclick = () => window.notespark.setTheme(mode).then(sync);
  modes.append(b);
  return [mode, b] as const;
});
const sync = () => window.notespark.getTheme().then(current => modeButtons.forEach(([m, b]) => b.setAttribute('aria-pressed', String(m === current))));
sync();
