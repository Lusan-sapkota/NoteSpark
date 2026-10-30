// Home-screen widgets: New note with the open profile's pinned notes, and the tasks due. Import it only through ./widgets.
import React from 'react';
import { FlexWidget, ListWidget, registerWidgetTaskHandler, requestWidgetUpdate, TextWidget } from 'react-native-android-widget';
import { darkTheme, lightTheme, shape, space } from '../theme/theme';
import { getActiveProfile, hasProfilePin, readProfileNotes } from '../storage/profiles';
import { toPreview } from '../components/NoteItem';
import { Note } from '../types';
import { dueLabel, extractTasks, Task, today } from '@notespark/core';

export const WIDGET_NAME = 'PinnedNotes';
const MAX_NOTES = 20;
export const DUE_WIDGET_NAME = 'DueTasks';

type Colors = typeof lightTheme.colors;
type State = { kind: 'notes'; profileId: string; notes: Note[] } | { kind: 'empty' } | { kind: 'locked' };
const hex = (color: string) => color as `#${string}`;

const PinnedNotes = ({ c, state }: { c: Colors; state: State }) => (
  <FlexWidget
    style={{
      height: 'match_parent',
      width: 'match_parent',
      flexDirection: 'column',
      backgroundColor: hex(c.surfaceContainer),
      borderRadius: shape.extraLarge,
      padding: space.md,
    }}
  >
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginBottom: space.sm }}>
      <TextWidget text="Pinned notes" style={{ fontSize: 16, fontFamily: 'Figtree-SemiBold', color: hex(c.onSurface) }} />
      <FlexWidget style={{ flex: 1 }} />
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: 'notespark://new' }}
        style={{ backgroundColor: hex(c.primaryContainer), borderRadius: shape.control, paddingHorizontal: space.lg, paddingVertical: space.md }}
      >
        <TextWidget text="New note" style={{ fontSize: 14, fontFamily: 'Figtree-Medium', color: hex(c.onPrimaryContainer) }} />
      </FlexWidget>
    </FlexWidget>
    {state.kind === 'notes' ? (
      <ListWidget style={{ height: 'match_parent', width: 'match_parent' }}>
        {state.notes.map(note => (
          <FlexWidget
            key={note.id}
            clickAction="OPEN_URI"
            clickActionData={{ uri: `notespark://note/${state.profileId}/${note.id}` }}
            style={{
              width: 'match_parent',
              flexDirection: 'column',
              backgroundColor: hex(c.surfaceContainerHigh),
              borderRadius: shape.segment * 3,
              padding: space.md,
              marginBottom: space.xs,
            }}
          >
            <TextWidget text={note.title || 'Untitled note'} maxLines={1} truncate="END" style={{ fontSize: 16, fontFamily: 'Figtree-SemiBold', color: hex(c.onSurface) }} />
            {!!toPreview(note.content) && (
              <TextWidget text={toPreview(note.content)} maxLines={1} truncate="END" style={{ fontSize: 14, fontFamily: 'Figtree-Regular', color: hex(c.onSurfaceVariant) }} />
            )}
          </FlexWidget>
        ))}
      </ListWidget>
    ) : (
      <TextWidget
        text={state.kind === 'locked' ? 'This profile is locked. Open NoteSpark to see your notes.' : 'Pin a note in NoteSpark to see it here.'}
        style={{ fontSize: 14, fontFamily: 'Figtree-Regular', color: hex(c.onSurfaceVariant) }}
      />
    )}
  </FlexWidget>
);

const DueTasks = ({ c, state }: { c: Colors; state: DueState }) => (
  <FlexWidget
    style={{
      height: 'match_parent',
      width: 'match_parent',
      flexDirection: 'column',
      backgroundColor: hex(c.surfaceContainer),
      borderRadius: shape.extraLarge,
      padding: space.md,
    }}
  >
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginBottom: space.sm }}>
      <TextWidget text="Tasks due" style={{ fontSize: 16, fontFamily: 'Figtree-SemiBold', color: hex(c.onSurface) }} />
      <FlexWidget style={{ flex: 1 }} />
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: 'notespark://tasks' }}
        style={{ backgroundColor: hex(c.primaryContainer), borderRadius: shape.control, paddingHorizontal: space.lg, paddingVertical: space.md }}
      >
        <TextWidget text="All tasks" style={{ fontSize: 14, fontFamily: 'Figtree-Medium', color: hex(c.onPrimaryContainer) }} />
      </FlexWidget>
    </FlexWidget>
    {state.kind === 'tasks' ? (
      <ListWidget style={{ height: 'match_parent', width: 'match_parent' }}>
        {state.tasks.map(task => (
          <FlexWidget
            key={`${task.noteId}-${task.line}`}
            clickAction="OPEN_URI"
            clickActionData={{ uri: 'notespark://tasks' }}
            style={{
              width: 'match_parent',
              flexDirection: 'column',
              backgroundColor: hex(c.surfaceContainerHigh),
              borderRadius: shape.segment * 3,
              padding: space.md,
              marginBottom: space.xs,
            }}
          >
            <TextWidget text={task.text} maxLines={1} truncate="END" style={{ fontSize: 16, fontFamily: 'Figtree-SemiBold', color: hex(c.onSurface) }} />
            <TextWidget
              text={dueLabel(task.due!, state.today)}
              maxLines={1}
              style={{ fontSize: 14, fontFamily: 'Figtree-Regular', color: hex(task.due! < state.today ? c.error : c.onSurfaceVariant) }}
            />
          </FlexWidget>
        ))}
      </ListWidget>
    ) : (
      <TextWidget
        text={state.kind === 'locked' ? 'This profile is locked. Open NoteSpark to see your tasks.' : 'Nothing is due today.'}
        style={{ fontSize: 14, fontFamily: 'Figtree-Regular', color: hex(c.onSurfaceVariant) }}
      />
    )}
  </FlexWidget>
);

type DueState = { kind: 'tasks'; tasks: Task[]; today: string } | { kind: 'empty' } | { kind: 'locked' };

// Open tasks due today or earlier, soonest first, from the notes and the scratchpad.
const loadDue = async (): Promise<DueState> => {
  const profile = await getActiveProfile();
  if (await hasProfilePin(profile.id)) return { kind: 'locked' };
  const now = today();
  const notes = (await readProfileNotes(profile.id, { withScratchpad: true })).filter(n => !n.isArchived);
  const tasks = notes
    .flatMap(n => extractTasks(n))
    .filter(t => t.due && t.due <= now)
    .sort((a, b) => a.due!.localeCompare(b.due!))
    .slice(0, MAX_NOTES);
  return tasks.length ? { kind: 'tasks', tasks, today: now } : { kind: 'empty' };
};

// A profile with a PIN shows no titles on the home screen.
const loadState = async (): Promise<State> => {
  const profile = await getActiveProfile();
  if (await hasProfilePin(profile.id)) return { kind: 'locked' };
  const notes = (await readProfileNotes(profile.id)).filter(n => n.isPinned && !n.isArchived).slice(0, MAX_NOTES);
  return notes.length ? { kind: 'notes', profileId: profile.id, notes } : { kind: 'empty' };
};

const render = async () => {
  const state = await loadState();
  return { light: <PinnedNotes c={lightTheme.colors} state={state} />, dark: <PinnedNotes c={darkTheme.colors} state={state} /> };
};

const renderDue = async () => {
  const state = await loadDue();
  return { light: <DueTasks c={lightTheme.colors} state={state} />, dark: <DueTasks c={darkTheme.colors} state={state} /> };
};

// Runs headless, also while the app is closed.
export const register = () =>
  registerWidgetTaskHandler(async ({ widgetInfo, widgetAction, renderWidget }) => {
    if (widgetAction === 'WIDGET_DELETED' || widgetAction === 'WIDGET_CLICK') return;
    renderWidget(widgetInfo.widgetName === DUE_WIDGET_NAME ? await renderDue() : await render());
  });

export const update = () =>
  Promise.all([
    requestWidgetUpdate({ widgetName: WIDGET_NAME, renderWidget: render }),
    requestWidgetUpdate({ widgetName: DUE_WIDGET_NAME, renderWidget: renderDue }),
  ]);
