// Markdown checkboxes ("- [ ] Call Sam due:2026-11-01"): the Tasks screen and tappable boxes in the note view.
import { Note } from '../types';

export interface Task {
  noteId: number;
  noteTitle: string;
  noteUpdatedAt: string;
  line: number; // 0-based line in the note's content
  raw: string; // the whole line, to check it hasn't changed before writing
  text: string;
  due?: string; // YYYY-MM-DD
}

export interface TaskLine {
  line: number;
  raw: string;
  done: boolean;
  text: string;
}

const taskLine = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\](\s+[^\n]*)$/;
// "due:2026-11-01" is easy to type on a phone; "📅 2026-11-01" matches Obsidian Tasks.
const dueDate = /(?:due:|📅\s*)(\d{4}-\d{2}-\d{2})/;
const fence = /^\s*(```|~~~)/;

// Every checkbox line, open or done, in order. Lines inside fenced code blocks are skipped.
export const findTaskLines = (content: string): TaskLine[] => {
  const tasks: TaskLine[] = [];
  let inFence = false;
  content.split('\n').forEach((raw, line) => {
    if (fence.test(raw)) inFence = !inFence;
    if (inFence) return;
    const m = taskLine.exec(raw);
    if (m) tasks.push({ line, raw, done: m[2] !== ' ', text: m[3].trim() });
  });
  return tasks;
};

export const extractTasks = (note: Note): Task[] =>
  findTaskLines(note.content)
    .filter(t => !t.done)
    .map(t => ({
      noteId: note.id,
      noteTitle: note.title,
      noteUpdatedAt: note.updatedAt,
      line: t.line,
      raw: t.raw,
      text: t.text.replace(dueDate, '').trim() || t.text,
      due: dueDate.exec(t.text)?.[1],
    }));

// Ticks an open box or clears a done one. Returns the new content and line, or null if the line changed since it was read.
export const toggleTaskLine = (content: string, task: Pick<TaskLine, 'line' | 'raw'>): { content: string; raw: string } | null => {
  const lines = content.split('\n');
  if (lines[task.line] !== task.raw || !taskLine.test(task.raw)) return null;
  const raw = task.raw.replace(taskLine, (_, lead, box, rest) => `${lead}[${box === ' ' ? 'x' : ' '}]${rest}`);
  lines[task.line] = raw;
  return { content: lines.join('\n'), raw };
};

// For display: the found task lines get ☐ / ☑ in place of "[ ]" / "[x]". Line count is unchanged.
export const markTaskBoxes = (content: string): string => {
  const lines = content.split('\n');
  findTaskLines(content).forEach(t => {
    lines[t.line] = t.raw.replace(taskLine, (_, lead, box, rest) => `${lead}${box === ' ' ? '☐' : '☑'}${rest}`);
  });
  return lines.join('\n');
};
