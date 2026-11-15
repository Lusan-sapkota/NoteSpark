// Which automatic backup files of a profile to delete. Names look like notespark-<name>-<id>-<date>.json, maybe with Android's " (1)".
// Matching by id keeps pruning right after a rename.
const pattern = (id: string) =>
  new RegExp(`^notespark-.*-${id.replace(/[^a-z0-9]/gi, '')}-(\\d{4}-\\d{2}-\\d{2}-\\d{4})(?: \\(\\d+\\))?(?:\\.json)?$`);
const fileNameOf = (uri: string) => decodeURIComponent(uri).split('/').pop() ?? '';

// `keep` is how many of this profile's older files stay (the new backup is not in `uris` yet). Newest stay.
export const staleBackups = (uris: string[], profileId: string, keep: number): string[] => {
  const p = pattern(profileId);
  return uris
    .map(uri => ({ uri, date: p.exec(fileNameOf(uri))?.[1] }))
    .filter((f): f is { uri: string; date: string } => !!f.date)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(keep)
    .map(f => f.uri);
};
