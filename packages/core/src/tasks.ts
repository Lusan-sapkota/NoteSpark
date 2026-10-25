import { Note } from './types';

export interface Task {
  noteId: number;
  noteTitle: string;
  noteUpdatedAt: string;
  line: number;
  raw: string; // checked before writing, so a stale task can't overwrite an edited line
  text: string;
  due?: string;
  every?: Repeat;
  done: boolean;
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
// "every:week": ticking the task moves its due date on instead of marking it done.
export type Repeat = 'day' | 'week' | 'month' | 'year';
const repeatRule = /every:(day|week|month|year)\b/;
const fence = /^\s*(```|~~~)/;

// The task text without its due date and repeat, the date (YYYY-MM-DD) and the repeat.
export const splitDue = (text: string): { text: string; due?: string; every?: Repeat } => {
  const due = dueDate.exec(text)?.[1];
  const every = repeatRule.exec(text)?.[1] as Repeat | undefined;
  const rest = text.replace(dueDate, '').replace(repeatRule, '').replace(/\s{2,}/g, ' ').trim();
  return { text: due || every ? rest || text : text, due, every };
};

export const repeatLabel = (every: Repeat) => ({ day: 'Repeats daily', week: 'Repeats weekly', month: 'Repeats monthly', year: 'Repeats yearly' })[every];

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => dayKey(new Date());
// YYYY-MM-DD `days` after `from` (a YYYY-MM-DD, default today).
export const addDays = (days: number, from = today()) => {
  const d = new Date(`${from}T00:00`);
  d.setDate(d.getDate() + days);
  return dayKey(d);
};

// The first date after today that's a whole number of repeats after `due`.
// ponytail: month steps use Date overflow (Jan 31 + 1 month = Mar 3); clamp to month end if anyone minds.
export const nextDue = (due: string, every: Repeat, now = today()): string => {
  const step = (from: string) => {
    const d = new Date(`${from}T00:00`);
    if (every === 'day') d.setDate(d.getDate() + 1);
    else if (every === 'week') d.setDate(d.getDate() + 7);
    else if (every === 'month') d.setMonth(d.getMonth() + 1);
    else d.setFullYear(d.getFullYear() + 1);
    return dayKey(d);
  };
  let next = step(due);
  while (next <= now) next = step(next);
  return next;
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

// Open tasks only, unless `done` is set.
export const extractTasks = (note: Note, { done = false } = {}): Task[] =>
  findTaskLines(note.content)
    .filter(t => done || !t.done)
    .map(t => ({
      noteId: note.id,
      noteTitle: note.title,
      noteUpdatedAt: note.updatedAt,
      line: t.line,
      raw: t.raw,
      done: t.done,
      ...splitDue(t.text),
    }));

// Sets (or with null, removes) a line's due date, turning the line into a task first if it isn't one.
export const setLineDue = (line: string, due: string | null): string => {
  const base = line.replace(new RegExp(`\\s*${dueDate.source}`), '').trimEnd();
  const task = taskLine.test(`${base} `) ? base : base.replace(/^(\s*)(?:[-*+]\s+)?/, '$1- [ ] ').trimEnd();
  return due ? `${task} due:${due}` : task;
};

// `next` is set when a repeating task was ticked: it stays open with that new due date.
export const toggleTaskLine = (
  content: string,
  task: Pick<TaskLine, 'line' | 'raw'>,
): { content: string; raw: string; next?: string } | null => {
  const lines = content.split('\n');
  const m = lines[task.line] === task.raw ? taskLine.exec(task.raw) : null;
  if (!m) return null;
  const { due, every } = splitDue(m[3]);
  const next = m[2] === ' ' && every ? nextDue(due ?? today(), every) : undefined;
  const raw = next
    ? due ? task.raw.replace(dueDate, `due:${next}`) : `${task.raw} due:${next}`
    : task.raw.replace(taskLine, (_, lead, box, rest) => `${lead}[${box === ' ' ? 'x' : ' '}]${rest}`);
  lines[task.line] = raw;
  return { content: lines.join('\n'), raw, next };
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
