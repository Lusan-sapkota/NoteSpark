function convertImagesToLinks(text: string, isMarkdown: boolean): string {
  if (isMarkdown) {
    return text;
  } else {
    let result = text.replace(/!\[[^\]]*\]\(([^)]+)\)/g, '$1');
    result = result.replace(/\[[^\]]*\]\((?!attachment:[0-9a-fA-F]{64}\))([^)]+)\)/g, '$1');
    return result;
  }
}
import React, { useState, useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text as RNText, View, TextInput, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, usePreventRemove, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Chip, Icon, IconButton, List, Searchbar, Modal, Portal, SegmentedButtons, Text, TextInput as PaperTextInput } from 'react-native-paper';
import Dialog from '../components/Dialog';
import Menu from '../components/Menu';
import { Note, RootStackParamList } from '../types';
import { clearDraft, getDraft, getNoteById, getNotes, saveDraft, moveNoteToBin, saveNote, setNoteArchived, setNotePinned, setNoteStyle, updateNote } from '../storage/notes';
import { getActiveProfile } from '../storage/profiles';
import {
  ATTACHMENT_TOO_LARGE_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  addAttachment,
  appendAttachmentLink,
  removeAttachmentLink,
} from '../storage/attachments';
import Animated, { Easing, ReduceMotion, SlideInDown, ZoomIn, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { shareNoteAsMarkdown } from '../utils/exportNotes';
import { addDays, formatAttachmentImage, parseFormatted, getLanguage, paragraphToMatch, setLineDue } from '@notespark/core';
import { isMeaningSearchAvailable, relatedToText } from '../storage/semanticSearch';
import { isLiveRelatedOn } from '../utils/liveRelated';
import { toPreview } from '../components/NoteItem';
import { extractTags } from '@notespark/core';
import { continueList, titleFromText } from '@notespark/core';
import { sendAppNotification } from '../utils/notifications';
import KeyboardSafePortal from '../components/KeyboardSafePortal';
import Header, { useHeaderElevation } from '../components/Header';
import MarkdownRenderer from '../components/MarkdownRenderer';
import NoteAttachments from '../components/NoteAttachments';
import NoteImages, { extractImageUris } from '../components/NoteImages';
import { useAlert } from '../components/DialogProvider';
import { useI18n } from '../i18n/I18nContext';
import { useTheme } from '../theme/ThemeContext';
import { controlTheme, readingWidth, shape, space } from '../theme/theme';
import { NOTE_COLORS, NOTE_PATTERNS, noteColors } from '../theme/noteStyle';
import NotePattern from '../components/NotePattern';

type EditorScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Editor'>;
type EditorScreenRouteProp = RouteProp<RootStackParamList, 'Editor'>;

// IconButton (48) plus toolbar padding; used to keep the cursor clear of the toolbar.
const TOOLBAR_HEIGHT = 56;

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(getLanguage(), { dateStyle: 'medium', timeStyle: 'short' }) : '';

// A bottom sheet's surface. It slides up from the bottom after a tap, eased and without a bounce (the OS reduce-motion setting turns that off),
// while Paper's Modal fades the dim backdrop behind it.
// The height cap is in pixels: a percentage of a parent with no set height collapsed the rows inside.
const SheetBody: React.FC<{ color: string; bottomInset: number; children: React.ReactNode }> = ({ color, bottomInset, children }) => {
  const { height } = useWindowDimensions();
  return (
    <Animated.View
      entering={SlideInDown.duration(240).easing(Easing.out(Easing.cubic)).reduceMotion(ReduceMotion.System)}
      style={[styles.sheet, { backgroundColor: color, paddingBottom: space.lg + bottomInset, maxHeight: height * 0.7 }]}
    >
      {children}
    </Animated.View>
  );
};

const EditorScreen: React.FC = () => {
  const navigation = useNavigation<EditorScreenNavigationProp>();
  const route = useRoute<EditorScreenRouteProp>();
  const { theme } = useTheme();
  const { elevated, onScroll } = useHeaderElevation();
  const alert = useAlert();
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);

  const { noteId, title: titleParam, text: textParam, draft: fromDraft, template, markdown: markdownParam } = route.params ?? {};

  const [title, setTitle] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [isMarkdown, setIsMarkdown] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  // Pin and archive apply at once for a saved note; a new note gets them when it is first saved.
  const [isPinned, setIsPinned] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  // Colour and background pattern keys; like pin and archive they apply at once for a saved note.
  const [color, setColor] = useState<string | null>(null);
  const [background, setBackground] = useState<string | null>(null);
  const [showStyle, setShowStyle] = useState(false);
  const [showMore, setShowMore] = useState(false);
  // Labels are the note's #tags; Find in note steps through matches by selecting them in the text.
  const [showLabels, setShowLabels] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [find, setFind] = useState<{ query: string; index: number } | null>(null);
  const findRef = useRef<Pick<React.ComponentRef<typeof TextInput>, 'focus' | 'clear' | 'blur' | 'isFocused' | 'setNativeProps' | 'setSelection'>>(null);
  // The menu hands focus back to the note text when it closes, which would send what is typed to the note instead of
  // the search field, so the field takes focus a moment after the menu is gone (not with autoFocus).
  const findOpen = find !== null;
  useEffect(() => {
    if (!findOpen) return;
    const timer = setTimeout(() => findRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, [findOpen]);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  // Cursor is read, not controlled: a controlled selection on Android closes the keyboard on focus.
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number } | null>(null);
  const bodyRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const insets = useSafeAreaInsets();
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  // Undo/redo: a step is recorded after a 600 ms typing pause; `committed` is the last recorded text.
  const [undoStack, setUndoStack] = useState<{ past: string[]; future: string[] }>({ past: [], future: [] });
  const committed = useRef('');
  // "Link a note" picker: inserts [[Title]] at the cursor.
  const [notePicker, setNotePicker] = useState<{ query: string; notes: Note[] } | null>(null);
  const [showDueDialog, setShowDueDialog] = useState(false);
  // The text formatting bar (opened with the A button) sits above the toolbar.
  const [showFormat, setShowFormat] = useState(false);
  // Related notes while writing (opt-in in Settings): notes close to the paragraph at the cursor, found 1.5 s after typing stops.
  const [liveRelated, setLiveRelated] = useState(false);
  const [related, setRelated] = useState<Note[]>([]);
  const [showRelated, setShowRelated] = useState(false);
  // For suggestions while typing #tags and [[links]]: the profile's tags and other notes' titles.
  const [known, setKnown] = useState<{ tags: string[]; titles: string[] }>({ tags: [], titles: [] });
  // The note as last loaded or saved; anything different is unsaved and kept as a draft.
  const [saved, setSaved] = useState({ title: '', content: '', isMarkdown: false });
  const [loaded, setLoaded] = useState(false);
  // Only the editor that wrote (or reopened) the draft clears it; another editor opening mustn't erase it.
  const ownsDraft = useRef(!!fromDraft);
  const isDirty = loaded && (title !== saved.title || content !== saved.content || isMarkdown !== saved.isMarkdown);

  // Shows `text` as the starting point; a reopened draft goes on top of it, still unsaved.
  const showLoaded = async (start: { title: string; content: string; isMarkdown: boolean }) => {
    setSaved(start);
    const draft = fromDraft ? await getDraft() : null;
    const shown = draft && draft.noteId === noteId ? draft : start;
    setTitle(shown.title);
    setContent(shown.content);
    setIsMarkdown(shown.isMarkdown);
    committed.current = shown.content;
    setUndoStack({ past: [], future: [] });
    setLoaded(true);
  };

  useEffect(() => {
    if (!noteId) {
      setIsEditing(false);
      setCreatedAt(null);
      setUpdatedAt(null);
      showLoaded(template ? { title: titleParam ?? '', content: textParam ?? '', isMarkdown: !!markdownParam } : { title: '', content: '', isMarkdown: false }).then(() => {
        // Prefilled text (a [[link]] or a share) counts as unsaved.
        if (template) return;
        if (titleParam) setTitle(titleParam);
        if (textParam) setContent(textParam);
      });
      return;
    }
    const loadNote = async () => {
      try {
        const note = await getNoteById(Number(noteId));
        if (note) {
          await showLoaded({ title: String(note.title), content: String(note.content), isMarkdown: !!note.isMarkdown });
          setIsEditing(true);
          setIsPinned(note.isPinned);
          setIsArchived(note.isArchived);
          setColor(note.color ?? null);
          setBackground(note.background ?? null);
          setCreatedAt(note.createdAt);
          setUpdatedAt(note.updatedAt);
        } else {
          alert(t('editor.noteNotFoundTitle'), t('editor.noteNotFoundMessage'));
        }
      } catch (error) {
        console.error('Failed to load note:', error);
        alert(t('editor.openFailedTitle'), t('editor.openFailedMessage'));
      }
    };
    loadNote();
  }, [noteId, titleParam, textParam]);

  useEffect(() => {
    getNotes()
      .then(notes => {
        const others = notes.filter(n => String(n.id) !== String(noteId));
        setKnown({
          tags: [...new Set(others.flatMap(n => extractTags(n.content)))].sort(),
          titles: others.map(n => n.title.trim()).filter(Boolean),
        });
      })
      .catch(() => {});
  }, [noteId]);

  useEffect(() => {
    isLiveRelatedOn().then(on => setLiveRelated(on && isMeaningSearchAvailable()), () => {});
  }, []);
  const paragraph = liveRelated && loaded ? paragraphToMatch(content, selection.start) : '';
  useEffect(() => {
    if (!paragraph) {
      setRelated(r => (r.length ? [] : r));
      return;
    }
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const ids = await relatedToText(paragraph, noteId ? Number(noteId) : undefined);
        const notes = await Promise.all(ids.map(id => getNoteById(id).catch(() => null)));
        if (current) setRelated(notes.filter((n): n is Note => !!n && !n.isArchived));
      } catch {
        if (current) setRelated([]);
      }
    }, 1500);
    return () => { current = false; clearTimeout(timer); };
  }, [paragraph, noteId]);

  // Keeps unsaved text as a draft a second after typing stops; Home offers it back after a restart.
  useEffect(() => {
    if (!loaded) return;
    if (!isDirty) {
      if (ownsDraft.current) clearDraft();
      return;
    }
    const timer = setTimeout(async () => {
      const profile = await getActiveProfile().catch(() => null);
      ownsDraft.current = true;
      if (profile) saveDraft({ profileId: profile.id, noteId, title, content, isMarkdown });
    }, 1000);
    return () => clearTimeout(timer);
  }, [loaded, isDirty, title, content, isMarkdown]);

  // Leaving with unsaved changes saves them; if saving fails the editor stays open.
  usePreventRemove(isDirty && !saving, ({ data }) => {
    handleSave(() => navigation.dispatch(data.action));
  });

  // `then` replaces going back (used when leaving was asked for another way).
  const handleSave = async (then?: () => void) => {
    if (saving) return;
    // An empty new note has nothing to save.
    if (!isEditing && !title.trim() && !content.trim()) {
      setSaved({ title, content, isMarkdown });
      setTimeout(() => (then ? then() : navigation.goBack()), 0);
      return;
    }
    // No title: the first line of text, or else the date and time.
    const noteTitle = title.trim() ? title : titleFromText(content) || formatDate(new Date().toISOString());
    setSaving(true);
    try {
      if (isEditing && noteId) {
        await updateNote({
          id: Number(noteId),
          title: noteTitle,
          content,
          isMarkdown
        });
      } else {
        const now = new Date().toISOString();
        const newId = await saveNote({
          title: noteTitle,
          content,
          isMarkdown,
          createdAt: now,
          updatedAt: now
        });
        if (isArchived) await setNoteArchived(newId, true);
        else if (isPinned) await setNotePinned(newId, true);
        if (color || background) await setNoteStyle(newId, { color, background });
        try {
          const notes = await getNotes();
          if (notes.length === 1) {
            await sendAppNotification(t('editor.firstNoteSavedTitle'), t('editor.firstNoteSavedBody'));
          }
        } catch (e) {}
      }
      clearDraft();
      setTitle(noteTitle);
      setSaved({ title: noteTitle, content, isMarkdown });
      setTimeout(() => {
        setSaving(false);
        then ? then() : navigation.goBack();
      }, 120);
    } catch (error) {
      setSaving(false);
      console.error('Failed to save note:', error);
      alert(t('editor.saveFailedTitle'), t('editor.saveFailedMessage'));
    }
  };

  // Archiving unpins (as in storage); pinning an archived note brings it back to Home.
  const togglePinned = async () => {
    const pin = !isPinned;
    try {
      if (isEditing && noteId) {
        if (pin && isArchived) await setNoteArchived(Number(noteId), false);
        await setNotePinned(Number(noteId), pin);
      }
      setIsPinned(pin);
      if (pin) setIsArchived(false);
    } catch (error) {
      console.error('Failed to pin note:', error);
      alert(t('editor.saveFailedTitle'), t('editor.saveFailedMessage'));
    }
  };

  const toggleArchived = async () => {
    const archive = !isArchived;
    try {
      if (isEditing && noteId) await setNoteArchived(Number(noteId), archive);
      setIsArchived(archive);
      if (archive) setIsPinned(false);
    } catch (error) {
      console.error('Failed to archive note:', error);
      alert(t('editor.saveFailedTitle'), t('editor.saveFailedMessage'));
    }
  };

  // The three-dots sheet works on the text as it is on screen, saved or not.
  const asNote = (): Note => ({
    id: Number(noteId), title, content, isMarkdown, isPinned, isArchived, color, background,
    createdAt: createdAt ?? '', updatedAt: updatedAt ?? '',
  });

  const handleMakeCopy = async () => {
    setShowMore(false);
    try {
      const now = new Date().toISOString();
      const name = title.trim() || titleFromText(content) || t('common.untitledNote');
      const newId = await saveNote({ title: t('editor.copyOf', { title: name }), content, isMarkdown, createdAt: now, updatedAt: now });
      if (color || background) await setNoteStyle(newId, { color, background });
      alert(t('editor.copyMade'));
    } catch (error) {
      console.error('Failed to copy note:', error);
      alert(t('editor.saveFailedTitle'), t('editor.saveFailedMessage'));
    }
  };

  const handleSend = () => {
    setShowMore(false);
    shareNoteAsMarkdown(asNote()).catch(() => alert(t('note.exportFailedTitle'), t('common.tryAgainRestart')));
  };

  // No question, like on the note screen: the note goes to the bin and Home offers Undo. A note that was never
  // saved has nothing to bin, so it is just dropped.
  const handleDelete = async () => {
    setShowMore(false);
    if (!isEditing || !noteId) {
      clearDraft();
      setSaved({ title, content, isMarkdown });
      setTimeout(() => navigation.goBack(), 0);
      return;
    }
    try {
      await moveNoteToBin(Number(noteId));
      clearDraft();
      setSaved({ title, content, isMarkdown }); // nothing left to save on the way out
      setTimeout(() => navigation.popTo('Home', { binnedNoteId: Number(noteId) }), 0);
    } catch (error) {
      alert(t('note.binFailedTitle'), t('common.tryAgainRestart'));
    }
  };

  // Labels are #tags in the text: adding appends one on its own line, removing takes it out where it stands alone.
  const addLabel = (raw: string) => {
    const tag = raw.trim().replace(/^#+/, '').replace(/\s+/g, '-').toLowerCase();
    if (!tag || extractTags(content).includes(tag)) return;
    setContent(`${content.trimEnd()}${content.trim() ? '\n' : ''}#${tag}\n`);
  };

  const removeLabel = (tag: string) => {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    setContent(content.replace(new RegExp(`(^|\\s)#${escaped}(?![\\p{L}\\p{N}_/-])`, 'giu'), '$1').replace(/[ \t]+$/gm, ''));
  };

  const findMatches = (() => {
    const q = find?.query.trim().toLowerCase();
    const out: number[] = [];
    if (!q) return out;
    const text = content.toLowerCase();
    for (let i = text.indexOf(q); i !== -1; i = text.indexOf(q, i + q.length)) out.push(i);
    return out;
  })();

  const selectMatch = (index: number, query: string) => {
    const start = findMatches[index];
    if (start === undefined) return;
    bodyRef.current?.focus();
    setPendingSelection({ start, end: start + query.trim().length });
  };

  const stepFind = (step: number) => {
    if (!find || !findMatches.length) return;
    const index = (find.index + step + findMatches.length) % findMatches.length;
    setFind({ ...find, index });
    selectMatch(index, find.query);
  };

  const changeStyle = async (next: { color: string | null; background: string | null }) => {
    try {
      if (isEditing && noteId) await setNoteStyle(Number(noteId), next);
      setColor(next.color);
      setBackground(next.background);
    } catch (error) {
      console.error('Failed to change note style:', error);
      alert(t('editor.saveFailedTitle'), t('editor.saveFailedMessage'));
    }
  };

  // After an insert re-renders the text, move the cursor to where the insert said.
  useEffect(() => {
    if (!pendingSelection) return;
    bodyRef.current?.setSelection(pendingSelection.start, pendingSelection.end);
    setSelection(pendingSelection);
    setPendingSelection(null);
  }, [content, pendingSelection]);

  useEffect(() => {
    if (content === committed.current) return;
    const timer = setTimeout(() => {
      const previous = committed.current;
      committed.current = content;
      setUndoStack(stack => ({ past: [...stack.past, previous].slice(-100), future: [] }));
    }, 600);
    return () => clearTimeout(timer);
  }, [content]);

  // Swaps in an undone or redone text and puts the cursor at the end of what changed.
  const showText = (text: string) => {
    let same = 0;
    while (same < content.length && same < text.length && content[content.length - 1 - same] === text[text.length - 1 - same]) same++;
    committed.current = text;
    setContent(text);
    setPendingSelection({ start: text.length - same, end: text.length - same });
  };

  const hasUnrecorded = content !== committed.current;
  const canUndo = hasUnrecorded || undoStack.past.length > 0;
  const canRedo = !hasUnrecorded && undoStack.future.length > 0;

  const handleUndo = () => {
    const past = [...undoStack.past];
    const target = hasUnrecorded ? committed.current : past.pop();
    if (target === undefined) return;
    setUndoStack({ past, future: [content, ...undoStack.future] });
    showText(target);
  };

  const handleRedo = () => {
    if (!canRedo) return;
    const [target, ...future] = undoStack.future;
    setUndoStack({ past: [...undoStack.past, content], future });
    showText(target);
  };

  // Replace the selection with `text`, then select [selStart, selEnd] within the inserted text.
  const insert = (text: string, selStart = text.length, selEnd = selStart) => {
    const before = content.slice(0, selection.start);
    const after = content.slice(selection.end);
    setContent(before + text + after);
    setPendingSelection({ start: before.length + selStart, end: before.length + selEnd });
  };

  // Wraps the selection in `marker` (bold, italic, strikethrough), or takes the markers off if it already has them.
  // Spaces at the edges stay outside, because `** word **` isn't bold in Markdown.
  const wrapSelection = (marker: string) => {
    let { start, end } = selection;
    while (start < end && /\s/.test(content[start])) start++;
    while (end > start && /\s/.test(content[end - 1])) end--;
    const m = marker.length;
    const text = content.slice(start, end);
    let from = start;
    let to = end;
    let next: string;
    if (start >= m && content.slice(start - m, start) === marker && content.slice(end, end + m) === marker) {
      from = start - m;
      to = end + m;
      next = text;
    } else if (text.length >= 2 * m && text.startsWith(marker) && text.endsWith(marker)) {
      next = text.slice(m, text.length - m);
    } else {
      next = `${marker}${text}${marker}`;
    }
    const inner = next === `${marker}${text}${marker}` ? m : 0;
    setContent(content.slice(0, from) + next + content.slice(to));
    const innerLength = next.length - 2 * inner;
    setPendingSelection({ start: from + inner, end: from + inner + innerLength });
  };

  const prefixLines = (prefix: string) => {
    const lineStart = content.lastIndexOf('\n', selection.start - 1) + 1;
    const block = content.slice(lineStart, selection.end);
    const prefixed = block.split('\n').map(line => prefix + line).join('\n');
    setContent(content.slice(0, lineStart) + prefixed + content.slice(selection.end));
    const end = lineStart + prefixed.length;
    setPendingSelection({ start: end, end });
  };

  // Makes the selected lines a heading of `level`, or plain again if they all are one already.
  const setHeading = (level: number) => {
    const lineStart = content.lastIndexOf('\n', selection.start - 1) + 1;
    const lines = content.slice(lineStart, selection.end).split('\n');
    const marker = `${'#'.repeat(level)} `;
    const same = lines.every(line => line.startsWith(marker));
    const changed = lines.map(line => (same ? '' : marker) + line.replace(/^#{1,6}\s+/, '')).join('\n');
    setContent(content.slice(0, lineStart) + changed + content.slice(selection.end));
    const end = lineStart + changed.length;
    setPendingSelection({ start: end, end });
  };

  // Removes bold, italic, strikethrough, heading and bullet markers from the selected lines (or the cursor's line).
  const clearFormatting = () => {
    const lineStart = content.lastIndexOf('\n', selection.start - 1) + 1;
    const found = content.indexOf('\n', selection.end);
    const lineEnd = found < 0 ? content.length : found;
    const plain = content
      .slice(lineStart, lineEnd)
      .split('\n')
      .map(line =>
        line
          .replace(/^(\s*)(#{1,6}\s+|[-*]\s+(?!\[[ xX]\]))/, '$1')
          .replace(/\*\*|~~/g, '')
          .replace(/(^|\W)_(.+?)_(?=\W|$)/g, '$1$2'),
      )
      .join('\n');
    setContent(content.slice(0, lineStart) + plain + content.slice(lineEnd));
    const end = lineStart + plain.length;
    setPendingSelection({ start: end, end });
  };

  // Sets the due date of the line the cursor is on (making it a task); null removes it.
  const setDue = (due: string | null) => {
    setShowDueDialog(false);
    const lineStart = content.lastIndexOf('\n', selection.start - 1) + 1;
    const lineEnd = content.indexOf('\n', selection.start) < 0 ? content.length : content.indexOf('\n', selection.start);
    const line = setLineDue(content.slice(lineStart, lineEnd), due);
    setContent(content.slice(0, lineStart) + line + content.slice(lineEnd));
    setPendingSelection({ start: lineStart + line.length, end: lineStart + line.length });
  };

  const handleChangeText = (text: string) => {
    const list = continueList(convertImagesToLinks(content, isMarkdown), text, selection.start);
    setContent(list ? list.text : text);
    if (list) setPendingSelection({ start: list.cursor, end: list.cursor });
  };

  const handleAddImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      try {
        // Stored like a document (encrypted, in the profile's attachments), so it syncs with the note.
        const asset = result.assets[0];
        const added = await addAttachment({ uri: asset.uri, name: asset.fileName || 'image.jpg', size: asset.fileSize });
        insert(isMarkdown ? formatAttachmentImage(added.hash) : `[Image: attachment:${added.hash}]`);
      } catch {
        alert(t('editor.addImageFailedTitle'), t('editor.addImageFailedMessage'));
      }
    }
  };

  const handleAttachFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (typeof asset.size === 'number' && asset.size > MAX_ATTACHMENT_BYTES) {
      alert(t('editor.attachFailedTitle'), t('core.attachmentTooLarge'));
      return;
    }
    try {
      const added = await addAttachment({ uri: asset.uri, name: asset.name, size: asset.size });
      setContent(prev => appendAttachmentLink(prev, added.name, added.hash));
    } catch (error: any) {
      if (error?.message === ATTACHMENT_TOO_LARGE_MESSAGE) {
        alert(t('editor.attachFailedTitle'), t('core.attachmentTooLarge'));
      } else {
        alert(t('editor.attachFailedTitle'), t('editor.attachFailedMessage'));
      }
    }
  };

  const handleRemoveAttachment = (hash: string, occurrence: number) => {
    setContent(prev => removeAttachmentLink(prev, hash, occurrence));
  };

  const handleInsertLink = () => {
    if (!linkUrl.trim()) return;
    const url = linkUrl.trim();
    insert(`[${linkText.trim() || url}](${url})`);
    setShowLinkDialog(false);
    setLinkText('');
    setLinkUrl('');
  };

  const openNotePicker = async () => {
    try {
      const notes = (await getNotes()).filter(n => String(n.id) !== String(noteId) && n.title.trim());
      setNotePicker({ query: '', notes });
    } catch (error) {
      alert(t('editor.loadNotesFailedTitle'), t('common.tryAgainRestart'));
    }
  };

  const pickerMatches = notePicker
    ? notePicker.notes.filter(n => n.title.toLowerCase().includes(notePicker.query.trim().toLowerCase())).slice(0, 6)
    : [];

  const own = noteColors(theme, color);
  // The screen's colour eases to a newly picked one instead of flashing. The bar is see-through so it follows.
  const fillColor = own?.fill ?? theme.colors.background;
  const fadeStyle = useAnimatedStyle(() => ({ backgroundColor: withTiming(fillColor, { duration: 240, reduceMotion: ReduceMotion.System }) }), [fillColor]);
  // In the Plain text tab on the phone the field's text is drawn from styled pieces: bold, italic, strikethrough and
  // headings show as styled text and the marks fade. The desktop's text box can't do that, so it shows the marks.
  const showStyled = !isMarkdown && Platform.OS !== 'web';
  const styledBody = showStyled
    ? parseFormatted(convertImagesToLinks(content, false)).map((tok, i) => {
        const base = theme.fonts.noteBody;
        const headFont = tok.heading === 1 ? theme.fonts.noteH1 : tok.heading === 2 ? theme.fonts.noteH2 : tok.heading === 3 ? theme.fonts.noteH3 : null;
        return (
          <RNText
            key={i}
            style={[
              headFont ?? (tok.bold ? { fontFamily: theme.fonts.noteTitle.fontFamily } : tok.italic ? { fontFamily: 'Literata-Italic' } : null),
              tok.bold && tok.italic ? { fontStyle: 'italic' } : null,
              tok.strike ? { textDecorationLine: 'line-through' } : null,
              tok.marker ? { color: theme.colors.onSurfaceVariant, opacity: 0.55, fontFamily: base.fontFamily } : null,
            ]}
          >
            {tok.text}
          </RNText>
        );
      })
    : null;
  const hasSelection = selection.start !== selection.end;

  // The #tag or [[link]] being typed at the cursor, and what could complete it.
  const typed = content.slice(0, selection.start);
  const typingLink = !hasSelection ? /\[\[([^[\]\n]*)$/.exec(typed) : null;
  const typingTag = !hasSelection && !typingLink ? /(?:^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)$/u.exec(typed) : null;
  const partial = (typingLink ?? typingTag)?.[1] ?? '';
  const suggestions = typingLink
    ? known.titles.filter(w => w.toLowerCase().includes(partial.trim().toLowerCase())).slice(0, 8)
    : typingTag
      ? known.tags.filter(w => w.startsWith(partial.toLowerCase()) && w !== partial.toLowerCase()).slice(0, 8)
      : [];
  const completeWith = (word: string) => {
    const start = selection.start - partial.length;
    const closing = typingLink && !content.startsWith(']]', selection.start) ? ']]' : '';
    const text = typingLink ? `${word}${closing}` : `${word} `;
    const end = start + text.length + (typingLink && !closing ? 2 : 0);
    setContent(content.slice(0, start) + text + content.slice(selection.start));
    setPendingSelection({ start: end, end });
  };
  const showPreview = isMarkdown && isPreview;

  return (
    <View style={styles.flex}>
      <SafeAreaView style={[styles.flex, { backgroundColor: theme.colors.background }]} edges={['left', 'right', 'bottom']}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, fadeStyle]} />
        <NotePattern pattern={background} dark={theme.dark} />
        <Header elevated={elevated} backgroundColor={own ? 'transparent' : undefined}
          title={isEditing ? t('editor.editNote') : t('editor.newNote')}
          showBackButton
          onBackPress={() => navigation.goBack()}
          rightActions={
            <View style={styles.headerActions}>
              <IconButton
                icon={isPinned ? 'pin' : 'pin-outline'}
                mode={isPinned ? 'contained' : undefined}
                selected={isPinned}
                onPress={togglePinned}
                disabled={saving}
                accessibilityLabel={isPinned ? t('home.unpinNote', { title: title || t('common.untitledNote') }) : t('home.pinNote', { title: title || t('common.untitledNote') })}
                accessibilityState={{ selected: isPinned }}
              />
              <IconButton
                icon={isArchived ? 'archive-arrow-up' : 'archive-arrow-down-outline'}
                mode={isArchived ? 'contained-tonal' : undefined}
                selected={isArchived}
                onPress={toggleArchived}
                disabled={saving}
                accessibilityLabel={isArchived ? t('home.unarchive') : t('home.archive')}
                accessibilityState={{ selected: isArchived }}
              />
              <Menu
                visible={showMore}
                onDismiss={() => setShowMore(false)}
                anchor={<IconButton icon="dots-vertical" onPress={() => setShowMore(true)} disabled={saving} accessibilityLabel={t('note.moreOptions')} />}
              >
                <Menu.Item leadingIcon="content-copy" title={t('editor.makeCopy')} onPress={handleMakeCopy} />
                <Menu.Item leadingIcon="share-variant-outline" title={t('editor.send')} onPress={handleSend} />
                <Menu.Item leadingIcon="magnify" title={t('note.findInNote')} onPress={() => { setShowMore(false); setFind({ query: '', index: 0 }); }} />
                <Menu.Item leadingIcon="tag-outline" title={t('editor.labels')} onPress={() => { setShowMore(false); setShowLabels(true); }} />
                <Menu.Item leadingIcon="delete-outline" title={t('note.moveToBin')} titleStyle={{ color: theme.colors.error }} onPress={handleDelete} />
              </Menu>
            </View>
          }
        />
        {find && (
          <View style={styles.findBar}>
            <Searchbar
              ref={findRef}
              placeholder={t('note.findInNote')}
              value={find.query}
              onChangeText={text => {
                setFind({ query: text, index: 0 });
              }}
              onSubmitEditing={() => stepFind(1)}
              icon="close"
              onIconPress={() => setFind(null)}
              searchAccessibilityLabel={t('note.closeFind')}
              style={{ backgroundColor: theme.colors.surfaceContainerHigh, borderRadius: shape.control }}
              inputStyle={styles.findInput}
              right={() => (
                <View style={styles.findActions}>
                  {!!find.query.trim() && (
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }} accessibilityLiveRegion="polite">
                      {findMatches.length ? t('note.matchOf', { current: (find.index % findMatches.length) + 1, total: findMatches.length }) : t('note.noMatches')}
                    </Text>
                  )}
                  <IconButton icon="chevron-up" disabled={!findMatches.length} onPress={() => stepFind(-1)} accessibilityLabel={t('note.previousMatch')} />
                  <IconButton icon="chevron-down" disabled={!findMatches.length} onPress={() => stepFind(1)} accessibilityLabel={t('note.nextMatch')} />
                </View>
              )}
            />
          </View>
        )}

        {/* Scrolls the cursor above the keyboard and the toolbar without resizing anything. */}
        <KeyboardAwareScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          onScroll={onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          bottomOffset={TOOLBAR_HEIGHT + space.sm + (suggestions.length ? 48 : 0) + (showFormat ? 48 : 0) + space.lg}
        >
          <View style={styles.column}>
            <View style={styles.modeRow}>
              <SegmentedButtons theme={controlTheme}
                value={isMarkdown ? 'markdown' : 'text'}
                onValueChange={value => setIsMarkdown(value === 'markdown')}
                buttons={[
                  { value: 'text', label: t('editor.plainText') },
                  { value: 'markdown', label: 'Markdown' },
                ]}
                style={styles.flex}
              />
              {isMarkdown && (
                <IconButton
                  icon={isPreview ? 'eye-off-outline' : 'eye-outline'}
                  selected={isPreview}
                  mode={isPreview ? 'contained-tonal' : undefined}
                  onPress={() => setIsPreview(v => !v)}
                  accessibilityLabel={isPreview ? t('editor.hidePreview') : t('editor.showPreview')}
                />
              )}
            </View>

            <TextInput
              style={[styles.titleInput, theme.fonts.noteTitle, { color: own?.on ?? theme.colors.onSurface }]}
              placeholder={t('editor.titlePlaceholder')}
              placeholderTextColor={theme.colors.onSurfaceVariant}
              value={typeof title === 'string' ? title : String(title)}
              onChangeText={setTitle}
              selectionColor={theme.colors.primary}
              accessibilityLabel={t('editor.noteTitleLabel')}
            />

            {isEditing && (
              <Text variant="bodySmall" style={[styles.meta, { color: theme.colors.onSurfaceVariant }]}>
                {t('editor.createdEdited', { created: formatDate(createdAt), edited: formatDate(updatedAt) })}
              </Text>
            )}

            {showPreview ? (
              <View style={styles.body}>
                <MarkdownRenderer content={content.replace(/!\[[^\]]*\]\(([^)]+)\)/g, '').replace(/\[[^\]\r\n]*\]\(attachment:[0-9a-fA-F]{64}\)/g, '')} />
                <NoteImages uris={extractImageUris(content)} />
                <NoteAttachments content={content} />
              </View>
            ) : (
              <View style={styles.body}>
                <TextInput
                  ref={bodyRef}
                  style={[styles.contentInput, theme.fonts.noteBody, { color: own?.on ?? theme.colors.onSurface }]}
                  value={showStyled ? undefined : convertImagesToLinks(content, isMarkdown)}
                  onChangeText={handleChangeText}
                  multiline
                  textAlignVertical="top"
                  selectionColor={theme.colors.primary}
                  placeholder={isMarkdown ? t('editor.placeholderMarkdown') : t('editor.placeholderPlain')}
                  placeholderTextColor={theme.colors.onSurfaceVariant}
                  autoCorrect
                  autoCapitalize="sentences"
                  onSelectionChange={e => setSelection(e.nativeEvent.selection)}
                  scrollEnabled={false}
                  accessibilityLabel={t('editor.noteTextLabel')}
                >
                  {showStyled ? styledBody : undefined}
                </TextInput>
                <NoteAttachments content={content} onRemove={handleRemoveAttachment} />
              </View>
            )}
          </View>
        </KeyboardAwareScrollView>

        {/* Rides on the keyboard via a transform; the opened offset cancels the bottom inset. */}
        {!showPreview && (
          <KeyboardStickyView offset={{ opened: insets.bottom }}>
          <View style={[styles.toolbar, { backgroundColor: own?.fill ?? theme.colors.surfaceContainerHigh, borderColor: theme.colors.outline }]}>
            {suggestions.length > 0 && (
              <ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={styles.suggestions}>
                {suggestions.map(word => (
                  <Chip
                    key={word}
                    compact
                    icon={typingLink ? 'note-text-outline' : 'pound'}
                    onPress={() => completeWith(word)}
                    hitSlop={8}
                    style={{ backgroundColor: theme.colors.tertiaryContainer }}
                    textStyle={{ color: theme.colors.onTertiaryContainer }}
                    maxFontSizeMultiplier={1.5}
                    accessibilityLabel={typingLink ? t('editor.linkTo', { title: word }) : t('editor.tagWord', { tag: word })}
                  >
                    {typingLink ? word : `#${word}`}
                  </Chip>
                ))}
              </ScrollView>
            )}
            {showFormat && (
              <ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={styles.toolbarContent}>
                <IconButton icon="format-header-1" onPress={() => setHeading(1)} accessibilityLabel={t('editor.heading1')} />
                <IconButton icon="format-header-2" onPress={() => setHeading(2)} accessibilityLabel={t('editor.heading2')} />
                <IconButton icon="format-bold" onPress={() => wrapSelection('**')} accessibilityLabel={t('editor.bold')} />
                <IconButton icon="format-italic" onPress={() => wrapSelection('_')} accessibilityLabel={t('editor.italic')} />
                <IconButton icon="format-strikethrough" onPress={() => wrapSelection('~~')} accessibilityLabel={t('editor.strikethrough')} />
                <IconButton icon="format-list-bulleted" onPress={() => prefixLines('- ')} accessibilityLabel={t('editor.bulletedList')} />
                {isMarkdown && <IconButton icon="link-variant" onPress={() => setShowLinkDialog(true)} accessibilityLabel={t('editor.addLink')} />}
                <IconButton icon="format-clear" onPress={() => clearFormatting} accessibilityLabel={t('editor.clearFormatting')} />
                <IconButton icon="close" onPress={() => setShowFormat(false)} accessibilityLabel={t('editor.closeFormatting')} />
              </ScrollView>
            )}
            <ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={styles.toolbarContent}>
              {related.length > 0 && (
                <Chip
                  compact
                  icon="lightbulb-outline"
                  onPress={() => setShowRelated(true)}
                  hitSlop={8}
                  style={[styles.relatedChip, { backgroundColor: theme.colors.tertiaryContainer }]}
                  textStyle={{ color: theme.colors.onTertiaryContainer }}
                  maxFontSizeMultiplier={1.5}
                  accessibilityLabel={t('editor.relatedA11y', { count: related.length })}
                >
                  {t('editor.relatedChip', { count: related.length })}
                </Chip>
              )}
              <IconButton icon="undo" disabled={!canUndo} onPress={handleUndo} accessibilityLabel={t('common.undo')} />
              <IconButton icon="redo" disabled={!canRedo} onPress={handleRedo} accessibilityLabel={t('editor.redo')} />
              <IconButton
                icon="format-text"
                mode={showFormat ? 'contained-tonal' : undefined}
                selected={showFormat}
                onPress={() => setShowFormat(v => !v)}
                accessibilityLabel={t('editor.format')}
                accessibilityState={{ expanded: showFormat }}
              />
              <IconButton icon="palette-outline" onPress={() => setShowStyle(true)} accessibilityLabel={t('editor.noteStyle')} />
              <IconButton icon="checkbox-marked-outline" onPress={() => prefixLines('- [ ] ')} accessibilityLabel={t('editor.task')} />
              <IconButton icon="calendar-outline" onPress={() => setShowDueDialog(true)} accessibilityLabel={t('editor.dueDate')} />
              <IconButton icon="note-multiple-outline" onPress={openNotePicker} accessibilityLabel={t('editor.linkANote')} />
              <IconButton icon="image-outline" onPress={handleAddImage} accessibilityLabel={t('editor.addImage')} />
              <IconButton icon="paperclip" onPress={handleAttachFile} accessibilityLabel={t('editor.attachFile')} />
            </ScrollView>
          </View>
          </KeyboardStickyView>
        )}

        <Portal>
          <Modal
            visible={showStyle}
            onDismiss={() => setShowStyle(false)}
            style={styles.sheetWrap}
            contentContainerStyle={styles.sheetHost}
          >
            <SheetBody color={theme.colors.surfaceContainerLow} bottomInset={insets.bottom}>
            <Text variant="titleMedium" accessibilityRole="header" style={{ color: theme.colors.onSurface }}>{t('editor.colour')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.swatchRow} contentContainerStyle={styles.swatches}>
              {[null, ...NOTE_COLORS].map((key, i) => {
                const swatch = noteColors(theme, key);
                const on = color === key;
                return (
                  <Pressable
                    key={key ?? 'none'}
                    onPress={() => changeStyle({ color: key, background })}
                    accessibilityRole="button"
                    accessibilityLabel={key === null ? t('editor.noColour') : t('editor.colourN', { n: i })}
                    accessibilityState={{ selected: on }}
                    style={[styles.swatch, { backgroundColor: swatch?.fill ?? theme.colors.surfaceContainerHighest, borderColor: on ? theme.colors.primary : theme.colors.outlineVariant, borderWidth: on ? 3 : 1 }]}
                  >
                    {(on || key === null) && (
                      <Animated.View key={on ? 'on' : 'off'} entering={ZoomIn.duration(160).easing(Easing.out(Easing.cubic)).reduceMotion(ReduceMotion.System)}>
                        <Icon source={on ? 'check' : 'format-color-marker-cancel'} size={20} color={swatch?.on ?? theme.colors.onSurfaceVariant} />
                      </Animated.View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text variant="titleMedium" accessibilityRole="header" style={[styles.sheetSection, { color: theme.colors.onSurface }]}>{t('editor.background')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.swatchRow} contentContainerStyle={styles.swatches}>
              {[null, ...NOTE_PATTERNS].map((key, i) => {
                const on = background === key;
                return (
                  <Pressable
                    key={key ?? 'none'}
                    onPress={() => changeStyle({ color, background: key })}
                    accessibilityRole="button"
                    accessibilityLabel={key === null ? t('editor.noBackground') : t('editor.patternN', { n: i })}
                    accessibilityState={{ selected: on }}
                    style={[styles.swatch, styles.patternSwatch, { backgroundColor: own?.fill ?? theme.colors.surfaceContainerHighest, borderColor: on ? theme.colors.primary : theme.colors.outlineVariant, borderWidth: on ? 3 : 1 }]}
                  >
                    {key !== null && <NotePattern pattern={key} dark={theme.dark} />}
                    {(on || key === null) && (
                      <Animated.View key={on ? 'on' : 'off'} entering={ZoomIn.duration(160).easing(Easing.out(Easing.cubic)).reduceMotion(ReduceMotion.System)}>
                        <Icon source={on ? 'check' : 'image-off-outline'} size={20} color={own?.on ?? theme.colors.onSurfaceVariant} />
                      </Animated.View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
            </SheetBody>
          </Modal>
          <Modal
            visible={showRelated}
            onDismiss={() => setShowRelated(false)}
            style={styles.sheetWrap}
            contentContainerStyle={styles.sheetHost}
          >
            <SheetBody color={theme.colors.surfaceContainerLow} bottomInset={insets.bottom}>
            <Text variant="titleMedium" accessibilityRole="header" style={{ color: theme.colors.onSurface }}>{t('editor.relatedNotes')}</Text>
            <Text variant="bodySmall" style={[styles.sheetHelp, { color: theme.colors.onSurfaceVariant }]}>
              {t('editor.relatedHelp')}
            </Text>
            <ScrollView style={styles.sheetList}>
              {related.map(n => (
                <List.Item
                  key={n.id}
                  title={n.title || t('common.untitledNote')}
                  titleNumberOfLines={2}
                  description={toPreview(n.content)}
                  descriptionNumberOfLines={2}
                  onPress={() => { setShowRelated(false); navigation.navigate('NoteView', { noteId: String(n.id) }); }}
                  accessibilityHint={t('editor.relatedOpenHint')}
                  right={() => (
                    <IconButton
                      icon="link-variant"
                      accessibilityLabel={t('editor.linkTo', { title: n.title || t('common.untitledNote') })}
                      onPress={() => { insert(`[[${n.title.trim()}]]`); setShowRelated(false); }}
                    />
                  )}
                />
              ))}
            </ScrollView>
            </SheetBody>
          </Modal>
        </Portal>
        <KeyboardSafePortal>
          <Dialog visible={showLabels} onDismiss={() => { setShowLabels(false); setNewLabel(''); }}>
            <Dialog.Title>{t('editor.labels')}</Dialog.Title>
            <Dialog.Content style={styles.dialogContent}>
              <PaperTextInput
                mode="outlined"
                label={t('editor.newLabel')}
                value={newLabel}
                onChangeText={setNewLabel}
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={() => { addLabel(newLabel); setNewLabel(''); }}
                right={<PaperTextInput.Icon icon="plus" onPress={() => { addLabel(newLabel); setNewLabel(''); }} accessibilityLabel={t('common.add')} />}
              />
              <View style={styles.labelChips}>
                {[...new Set([...extractTags(content), ...known.tags])].map(tag => {
                  const on = extractTags(content).includes(tag);
                  return (
                    <Chip
                      key={tag}
                      mode={on ? 'flat' : 'outlined'}
                      selected={on}
                      showSelectedCheck={false}
                      icon={on ? 'check' : undefined}
                      onPress={() => (on ? removeLabel(tag) : addLabel(tag))}
                      accessibilityState={{ selected: on }}
                      maxFontSizeMultiplier={1.5}
                    >
                      #{tag}
                    </Chip>
                  );
                })}
              </View>
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => { setShowLabels(false); setNewLabel(''); }}>{t('common.done')}</Button>
            </Dialog.Actions>
          </Dialog>
          <Dialog visible={showLinkDialog} onDismiss={() => setShowLinkDialog(false)}>
            <Dialog.Title>{t('editor.addLink')}</Dialog.Title>
            <Dialog.Content style={styles.dialogContent}>
              <PaperTextInput mode="outlined" label={t('editor.linkText')} value={linkText} onChangeText={setLinkText} />
              <PaperTextInput
                mode="outlined"
                label={t('editor.url')}
                placeholder="https://"
                value={linkUrl}
                onChangeText={setLinkUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => setShowLinkDialog(false)}>{t('common.cancel')}</Button>
              <Button onPress={handleInsertLink} disabled={!linkUrl.trim()}>{t('editor.addLink')}</Button>
            </Dialog.Actions>
          </Dialog>
          <Dialog visible={showDueDialog} onDismiss={() => setShowDueDialog(false)}>
            <Dialog.Title>{t('editor.dueDate')}</Dialog.Title>
            <Dialog.Content>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                {t('editor.dueHelp', { example: `due:${addDays(3)}` })}
              </Text>
            </Dialog.Content>
            <Dialog.ScrollArea style={styles.dueList}>
              <List.Item title={t('common.today')} left={props => <List.Icon {...props} icon="calendar-today" />} onPress={() => setDue(addDays(0))} />
              <List.Item title={t('common.tomorrow')} left={props => <List.Icon {...props} icon="calendar-arrow-right" />} onPress={() => setDue(addDays(1))} />
              <List.Item title={t('editor.nextWeek')} left={props => <List.Icon {...props} icon="calendar-week" />} onPress={() => setDue(addDays(7))} />
              <List.Item title={t('editor.noDueDate')} left={props => <List.Icon {...props} icon="calendar-remove-outline" />} onPress={() => setDue(null)} />
            </Dialog.ScrollArea>
            <Dialog.Actions>
              <Button onPress={() => setShowDueDialog(false)}>{t('common.cancel')}</Button>
            </Dialog.Actions>
          </Dialog>
          <Dialog visible={!!notePicker} onDismiss={() => setNotePicker(null)}>
            <Dialog.Title>{t('editor.linkANote')}</Dialog.Title>
            <Dialog.Content style={styles.dialogContent}>
              <PaperTextInput
                mode="outlined"
                label={t('editor.searchTitles')}
                value={notePicker?.query ?? ''}
                onChangeText={query => setNotePicker(p => p && { ...p, query })}
                autoFocus
              />
              {pickerMatches.map(n => (
                <List.Item
                  key={n.id}
                  title={n.title}
                  titleNumberOfLines={2}
                  left={props => <List.Icon {...props} icon="note-text-outline" />}
                  onPress={() => { insert(`[[${n.title.trim()}]]`); setNotePicker(null); }}
                />
              ))}
              {notePicker && pickerMatches.length === 0 && (
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                  {notePicker.notes.length ? t('editor.noTitleMatch') : t('editor.saveAnotherFirst')}
                </Text>
              )}
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => setNotePicker(null)}>{t('common.cancel')}</Button>
            </Dialog.Actions>
          </Dialog>
        </KeyboardSafePortal>
      </SafeAreaView>
    </View>
  );

};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    marginRight: space.sm,
  },
  scrollContent: {
    flexGrow: 1,
    padding: space.lg,
  },
  column: {
    flexGrow: 1,
    width: '100%',
    maxWidth: readingWidth,
    alignSelf: 'center',
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  titleInput: {
    marginTop: space.xl,
    padding: 0,
  },
  meta: {
    marginTop: space.xs,
  },
  body: {
    flexGrow: 1,
    marginTop: space.lg,
  },
  // Grows with the text and lets the screen scroll; nothing resizes it while it gains focus.
  contentInput: {
    minHeight: 300,
    marginTop: space.lg,
    padding: 0,
  },
  // Floats a little in from the screen edges instead of running edge to edge.
  toolbar: {
    marginHorizontal: space.md,
    marginBottom: space.sm,
    paddingHorizontal: space.xs,
    // The same border as the Plain text and Markdown buttons: outline colour, 1dp, control corners.
    borderRadius: shape.control,
    borderWidth: 1,
    overflow: 'hidden',
  },
  toolbarContent: {
    alignItems: 'center',
  },
  suggestions: {
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.sm,
  },
  relatedChip: {
    marginHorizontal: space.sm,
  },
  sheetSection: {
    marginTop: space.lg,
  },
  swatchRow: {
    flexGrow: 0,
    flexShrink: 0,
  },
  swatches: {
    gap: space.md,
    paddingVertical: space.sm,
  },
  swatch: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  patternSwatch: {
    width: 72,
    borderRadius: shape.control,
  },
  sheetWrap: {
    justifyContent: 'flex-end',
  },
  findBar: {
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  findInput: {
    minHeight: 0,
  },
  findActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  labelChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.sm,
  },
  sheetHost: {
    backgroundColor: 'transparent',
  },
  sheet: {
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    padding: space.lg,
  },
  sheetHelp: {
    marginTop: space.xs,
    marginBottom: space.sm,
  },
  sheetList: {
    flexGrow: 0,
  },
  dialogContent: {
    gap: space.md,
  },
  dueList: {
    paddingHorizontal: 0,
  },
});

export default EditorScreen;
