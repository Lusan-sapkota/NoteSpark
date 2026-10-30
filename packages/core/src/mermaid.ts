import { t } from './i18n';

// A fenced block whose info string starts with "mermaid" (any case, extra words allowed) holds a diagram.
export const isMermaidFence = (info?: string) => /^mermaid(\s|$)/i.test((info ?? '').trim());

// First line of a render error, for "This diagram has a mistake: ...".
export const mermaidMistake = (error: unknown) => {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return text.split('\n').map(l => l.trim()).find(Boolean) ?? t('core.unknownError');
};
