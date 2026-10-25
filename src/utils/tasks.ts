import { Note } from '../types';

export interface Task {
  noteId: number;
  noteTitle: string;
  noteUpdatedAt: string;
  line: number;
  raw: string; // checked before writing, so a stale task can't overwrite an edited line
  text: string;
  due?: string;
}

export interface TaskLine {
  line: number;
  raw: string;
  done: boolean;
  text: string;
}

const taskLine = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\](\s+[^\n]*)$/;
// "📅 2026-11-01" is the Obsidian Tasks syntax.
const dueDate = /(?:due:|📅\s*)(\d{4}-\d{2}-\d{2})/;
const fence = /^\s*(```|~~~)/;

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

export const toggleTaskLine = (content: string, task: Pick<TaskLine, 'line' | 'raw'>): { content: string; raw: string } | null => {
  const lines = content.split('\n');
  if (lines[task.line] !== task.raw || !taskLine.test(task.raw)) return null;
  const raw = task.raw.replace(taskLine, (_, lead, box, rest) => `${lead}[${box === ' ' ? 'x' : ' '}]${rest}`);
  lines[task.line] = raw;
  return { content: lines.join('\n'), raw };
};

export const markTaskBoxes = (content: string): string => {
  const lines = content.split('\n');
  findTaskLines(content).forEach(t => {
    lines[t.line] = t.raw.replace(taskLine, (_, lead, box, rest) => `${lead}${box === ' ' ? '☐' : '☑'}${rest}`);
  });
  return lines.join('\n');
};
