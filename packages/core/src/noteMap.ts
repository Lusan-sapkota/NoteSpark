import { t } from './i18n';

// Mermaid text for a note and the notes around it, so the note page can draw a map of how it connects.
export interface NoteMapLinks {
  links: string[]; // notes this note links to
  linkedFrom: string[]; // notes that link to it
  mentionedIn: string[]; // notes that name it without linking
  related: string[]; // close in meaning
}

const PER_GROUP = 8;

// Titles go in double quotes; quotes, entity starts and angle brackets would end or change the label.
const label = (title: string) => title.replace(/["#&;<>\\`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || t('common.untitledNote');

export const noteMap = (title: string, groups: NoteMapLinks): string => {
  const ids = new Map<string, string>();
  const lines = ['graph LR'];
  const node = (name: string) => {
    const text = label(name);
    if (!ids.has(text)) {
      ids.set(text, `N${ids.size}`);
      lines.push(`  ${ids.get(text)}["${text}"]`);
    }
    return ids.get(text)!;
  };
  const here = node(title);
  const add = (names: string[], edge: (other: string) => string) =>
    names.slice(0, PER_GROUP).forEach(name => {
      const other = node(name);
      if (other !== here) lines.push(`  ${edge(other)}`);
    });
  const linksTo = t('core.mapLinksTo');
  add(groups.links, o => `${here} -->|${linksTo}| ${o}`);
  add(groups.linkedFrom, o => `${o} -->|${linksTo}| ${here}`);
  add(groups.mentionedIn, o => `${o} -.->|${t('core.mapMentions')}| ${here}`);
  add(groups.related, o => `${here} -.-|${t('core.mapCloseInMeaning')}| ${o}`);
  return lines.join('\n');
};

export const hasConnections = (groups: NoteMapLinks) => Object.values(groups).some(g => g.length > 0);
