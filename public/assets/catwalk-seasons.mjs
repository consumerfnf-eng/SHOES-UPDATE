// Which seasons the catwalk holds, in which order, and which one falls off.
//
// WGSN labels a season in words - "Spring/Summer 2027" - and the site has to
// put those in calendar order to know which is current and which is oldest.
// Sorting the labels as text puts Autumn before Spring and 2027 before 2028
// only by accident, so each label is read into a number instead.
//
// The retention rule is the site's, not WGSN's: three seasons are kept - the
// current one and the two before it - and collecting a fourth drops the
// oldest, its photographs deleted from disk rather than merely hidden. A
// subscription rendition that nothing shows is still a rendition being stored.
export const SEASONS_KEPT = 3;

// Half-year positions inside one year. WGSN's own vocabulary, plus the two
// spellings of the same season that its library has used interchangeably.
const PHASES = [
  [/^resort\b|^cruise\b/i, 0],
  [/^spring\s*\/?\s*summer\b|^s\s*\/\s*s\b|^ss\b/i, 1],
  [/^pre[-\s]?fall\b/i, 2],
  [/^autumn\s*\/?\s*winter\b|^fall\s*\/?\s*winter\b|^a\s*\/\s*w\b|^aw\b|^f\s*\/\s*w\b|^fw\b/i, 3],
];

// A label becomes year * 10 + phase, so 2027 Autumn/Winter (20273) sorts after
// 2027 Spring/Summer (20271) and before 2028 Resort (20280). A label with no
// year cannot be placed at all; it sorts oldest and is never treated as
// current, which keeps a malformed collection from evicting a real season.
export function seasonOrder(label) {
  const text = String(label ?? '').trim();
  const year = text.match(/\b(19|20)\d{2}\b/);
  if (!year) return null;
  const phase = PHASES.find(([pattern]) => pattern.test(text));
  return Number(year[0]) * 10 + (phase ? phase[1] : 1);
}

export function compareSeasons(a, b) {
  const left = seasonOrder(a), right = seasonOrder(b);
  if (left === right) return String(a).localeCompare(String(b));
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;          // newest first
}

// Newest first, duplicates collapsed, blanks dropped.
export function sortSeasons(labels) {
  return [...new Set((labels ?? []).map(l => String(l ?? '').trim()).filter(Boolean))].sort(compareSeasons);
}

// The seasons that stay, and the ones whose files are to be deleted.
export function retainSeasons(labels, kept = SEASONS_KEPT) {
  const ordered = sortSeasons(labels);
  // A limit that is not a whole season count falls back to the default rather
  // than emptying the tab: a bad argument must never delete a collection.
  const asked = Number(kept);
  const limit = Number.isFinite(asked) && asked >= 1 ? Math.floor(asked) : SEASONS_KEPT;
  return {keep: ordered.slice(0, limit), drop: ordered.slice(limit), ordered};
}

// True when `candidate` is newer than everything already collected - the test
// for "WGSN has published a season this site has not seen". An unplaceable
// label is never newer, so a caption WGSN changes the shape of cannot trigger
// a collection on its own.
export function isNewerSeason(candidate, known) {
  const order = seasonOrder(candidate);
  if (order === null) return false;
  const highest = (known ?? []).map(seasonOrder).filter(o => o !== null);
  return !highest.length || order > Math.max(...highest);
}
