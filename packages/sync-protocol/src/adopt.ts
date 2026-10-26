import type { PlainNote } from '@notespark/sync';
import type { LinkEntry, PairEntry } from './wire.ts';

// SHA-256, injected.
export type Hash = (data: Uint8Array) => Uint8Array;

// Title, text and format, line endings and trailing spaces normalised.
const normal = (n: PlainNote) =>
  `${n.title.trim()}\0${n.content.replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n').trim()}\0${n.isMarkdown ? 1 : 0}`;

// Empty notes are never joined.
export const isEmpty = (n: PlainNote) => n.title.trim() === '' && n.content.trim() === '';

export const fingerprints = (notes: PlainNote[], hash: Hash): LinkEntry[] =>
  notes.filter(n => !isEmpty(n)).map(n => ({ uuid: n.uuid, hash: hash(new TextEncoder().encode(normal(n))) }));

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

// Equal fingerprints are paired one to one; everything else stays separate.
export const planAdoption = (client: LinkEntry[], hub: LinkEntry[]): PairEntry[] => {
  const group = (entries: LinkEntry[]) => {
    const m = new Map<string, string[]>();
    for (const e of entries) m.set(hex(e.hash), [...(m.get(hex(e.hash)) ?? []), e.uuid]);
    for (const list of m.values()) list.sort();
    return m;
  };
  const hubBy = group(hub);
  const pairs: PairEntry[] = [];
  for (const [h, clients] of group(client)) {
    const hubs = hubBy.get(h) ?? [];
    for (let i = 0; i < Math.min(clients.length, hubs.length); i++) pairs.push({ clientUuid: clients[i], hubUuid: hubs[i] });
  }
  return pairs.sort((a, b) => (a.clientUuid < b.clientUuid ? -1 : 1));
};
