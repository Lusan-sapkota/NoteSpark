// Markdown checkboxes ("- [ ] Call Sam due:2026-11-01") found across notes, for the Tasks screen.
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

const taskLine = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]\s+([^\n]*)$/;
// "due:2026-11-01" is easy to type on a phone; "📅 2026-11-01" matches Obsidian Tasks.
const dueDate = /(?:due:|📅\s*)(\d{4}-\d{2}-\d{2})/;
const fence = /^\s*(```|~~~)/;

// Open tasks only. Lines inside fenced code blocks are skipped.
export const extractTasks = (note: Note): Task[] => {
  const tasks: Task[] = [];
  let inFence = false;
  note.content.split('\n').forEach((raw, line) => {
    if (fence.test(raw)) inFence = !inFence;
    if (inFence) return;
    const m = taskLine.exec(raw);
    if (!m || m[2] !== ' ') return;
    const due = dueDate.exec(m[3])?.[1];
    tasks.push({
      noteId: note.id,
      noteTitle: note.title,
      noteUpdatedAt: note.updatedAt,
      line,
      raw,
      text: m[3].replace(dueDate, '').trim() || m[3],
      due,
    });
  });
  return tasks;
};

// Returns the content with the task ticked (or unticked), or null if the line changed since it was read.
export const setTaskDone = (content: string, task: Pick<Task, 'line' | 'raw'>, done: boolean): string | null => {
  const lines = content.split('\n');
  const current = lines[task.line];
  const expected = done ? task.raw : task.raw.replace(taskLine, '$1[x] $3');
  if (current !== expected) return null;
  lines[task.line] = current.replace(taskLine, `$1[${done ? 'x' : ' '}] $3`);
  return lines.join('\n');
};
