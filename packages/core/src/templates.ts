// Starting points for a new note. The words come in as `labels`, so the apps can pass translated ones.
export type TemplateKind = 'meeting' | 'checklist' | 'daily';

export const TEMPLATE_LABELS = {
  meeting: 'Meeting',
  checklist: 'Checklist',
  attendees: 'Attendees',
  agenda: 'Agenda',
  notes: 'Notes',
  decisions: 'Decisions',
  actions: 'Action items',
  plan: 'Plan',
  done: 'Done today',
};
export type TemplateLabels = typeof TEMPLATE_LABELS;

// `day` is YYYY-MM-DD. A daily note is titled by its date (YYYY-MM-DD): it sorts, and the same day always finds the same note.
export const isDayTitle = (title: string) => /^\d{4}-\d{2}-\d{2}$/.test(title.trim());

export const templateNote = (kind: TemplateKind, day: string, l: TemplateLabels = TEMPLATE_LABELS): { title: string; content: string } => {
  if (kind === 'meeting') {
    return {
      title: `${l.meeting} ${day}`,
      content: `## ${l.attendees}\n\n\n## ${l.agenda}\n- \n\n## ${l.notes}\n\n\n## ${l.decisions}\n\n\n## ${l.actions}\n- [ ] `,
    };
  }
  if (kind === 'checklist') return { title: l.checklist, content: '- [ ] \n- [ ] \n- [ ] ' };
  return { title: day, content: `## ${l.plan}\n- [ ] \n\n## ${l.notes}\n\n\n## ${l.done}\n` };
};
