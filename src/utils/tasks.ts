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

// The task text without its due date, and the date (YYYY-MM-DD).
export const splitDue = (text: string): { text: string; due?: string } => {
  const due = dueDate.exec(text)?.[1];
  return { text: due ? text.replace(dueDate, '').replace(/\s{2,}/g, ' ').trim() || text : text, due };
};

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => dayKey(new Date());
// YYYY-MM-DD `days` after `from` (a YYYY-MM-DD, default today).
export const addDays = (days: number, from = today()) => {
  const d = new Date(`${from}T00:00`);
  d.setDate(d.getDate() + days);
  return dayKey(d);
};

export const formatDue = (due: string) => {
  const date = new Date(`${due}T00:00`);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
};

export const dueLabel = (due: string, now = today()) =>
  due < now ? `Overdue, due ${formatDue(due)}` : due === now ? 'Due today' : `Due ${formatDue(due)}`;

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
      ...splitDue(t.text),
    }));

// Sets (or with null, removes) a line's due date, turning the line into a task first if it isn't one.
export const setLineDue = (line: string, due: string | null): string => {
  const base = line.replace(new RegExp(`\\s*${dueDate.source}`), '').trimEnd();
  const task = taskLine.test(`${base} `) ? base : base.replace(/^(\s*)(?:[-*+]\s+)?/, '$1- [ ] ').trimEnd();
  return due ? `${task} due:${due}` : task;
};

export const toggleTaskLine =(content: string, task: Pick<TaskLine, 'line' | 'raw'>): { content: string; raw: string } | null => {
  const lines = content.split('\n');
  if (lines[task.line] !== task.raw || !taskLine.test(task.raw)) return null;
  const raw = task.raw.replace(taskLine, (_, lead, box, rest) => `${lead}[${box === ' ' ? 'x' : ' '}]${rest}`);
  lines[task.line] = raw;
  return { content: lines.join('\n'), raw };
};

// Rewrites each task line for display; `lead` is its indent and list marker. Line count is unchanged.
export const mapTaskLines = (content: string, fn: (task: TaskLine, lead: string) => string): string => {
  const lines = content.split('\n');
  findTaskLines(content).forEach(t => {
    lines[t.line] = fn(t, taskLine.exec(t.raw)![1]);
  });
  return lines.join('\n');
};

export const markTaskBoxes = (content: string): string =>
  mapTaskLines(content, (t, lead) => `${lead}${t.done ? '☑' : '☐'} ${splitDue(t.text).text}`);
