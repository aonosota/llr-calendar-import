import type {
  CalendarSource,
  DateWindow,
  InsertRecord,
  InsertSummary,
  LocalDate,
  NormalizedEvent,
  PlannedLine,
  PluginSettings,
} from "../types";
import { keyString, windowForDate } from "../time";
import { planLine } from "../llr";
import { normalizeSections } from "../section";
import { decideDedupe, insertLines } from "../insert";

/**
 * Import pipeline: fetch → filter → order → plan → dedupe → insert.
 * Pure: no `obsidian` import, no Node APIs. I/O (sources, note text, records,
 * clock) is injected.
 *
 * Counting conventions (InsertSummary):
 * - `inserted`  = number of lines added (new + changed, incl. fallback placements);
 *                 `perHeading` values sum to it.
 * - `changed`   = subset of `inserted` whose UID was inserted before with another
 *                 start/title.
 * - `fallback`  = subset of `inserted` placed under the fallback heading.
 * - `duplicates`= skipped because already inserted (records / note text) or seen
 *                 twice in this run (same event in two calendars).
 * - `filtered`  = dropped by settings (all-day, declined, exclude keywords).
 *                 Cancelled events are dropped silently and NOT counted.
 */

/** One fetched event with its ordering provenance. */
export interface FetchedEvent {
  event: NormalizedEvent;
  /** Index of the source in the given source list. */
  sourceIndex: number;
  /** Index of the event within the source's result. */
  eventIndex: number;
}

export interface FetchResult {
  events: FetchedEvent[];
  /** Display names (label or unnamed fallback) of failed sources. Never URLs. */
  failedSources: string[];
  /** Number of sources attempted. */
  sourceCount: number;
}

export interface FetchOptions {
  window: DateWindow;
  myEmail?: string;
  /** Name for a failed source without label; `n` is 1-based. */
  unnamedSourceName?: (n: number) => string;
  /** Debug hook. Receives only labels, kinds and counts (never URLs or error messages). */
  log?: (message: string) => void;
}

function errorKind(err: unknown): string {
  if (err && typeof err === "object" && "kind" in err && typeof err.kind === "string") return err.kind;
  return "unknown";
}

/**
 * Fetch every source sequentially. A failure of one source is recorded by name
 * and does not stop the others. Error messages are deliberately discarded
 * because they may embed the URL.
 */
export async function fetchAllEvents(sources: CalendarSource[], opts: FetchOptions): Promise<FetchResult> {
  const unnamed = opts.unnamedSourceName ?? ((n: number) => `Calendar ${n}`);
  const events: FetchedEvent[] = [];
  const failedSources: string[] = [];
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (!source) continue;
    const name = source.label?.trim() ? source.label.trim() : unnamed(i + 1);
    try {
      const got = await source.fetchEvents({ window: opts.window, myEmail: opts.myEmail || undefined });
      got.forEach((event, eventIndex) => events.push({ event, sourceIndex: i, eventIndex }));
      opts.log?.(`source "${name}": ${got.length} event(s)`);
    } catch (err) {
      failedSources.push(name);
      opts.log?.(`source "${name}" failed (${errorKind(err)})`);
    }
  }
  return { events, failedSources, sourceCount: sources.length };
}

export type FilterReason = "cancelled" | "allDay" | "declined" | "keyword";

/** Why an event is dropped, or null to keep it. */
export function filterReason(ev: NormalizedEvent, settings: PluginSettings): FilterReason | null {
  if (ev.status === "cancelled") return "cancelled";
  if (ev.allDay && !settings.includeAllDay) return "allDay";
  if (settings.skipDeclined && ev.myPartstat === "declined") return "declined";
  const title = ev.title.toLowerCase();
  for (const kw of settings.excludeKeywords) {
    const k = kw.trim().toLowerCase();
    if (k !== "" && title.includes(k)) return "keyword";
  }
  return null;
}

/** Bare label of a heading line: "## Calendar" → "Calendar". */
export function headingLabel(headingLine: string): string {
  return headingLine.trim().replace(/^#+\s*/, "").replace(/\s+#+$/, "").trim();
}

/**
 * Checks settings needed by planImport. Returns an error message (no URLs) or null.
 */
export function validateImportSettings(settings: PluginSettings): string | null {
  try {
    normalizeSections(settings.sections, settings.dayBoundary);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  if (!/^ {0,3}#{1,6}[ \t]+\S/.test(settings.fallbackHeading.trim())) {
    return `Fallback heading must be a markdown heading such as "## Calendar"`;
  }
  return null;
}

export type ImportStatus =
  /** Pipeline ran; `text` is null when nothing had to be inserted. */
  | "ok"
  /** No enabled sources. */
  | "noSources"
  /** Every source failed; note untouched. */
  | "allFailed"
  /** Invalid settings (sections, boundary, fallback heading); note untouched. */
  | "settingsError";

export interface ImportOutcome {
  status: ImportStatus;
  /** New note text, or null when the note must not change. */
  text: string | null;
  /** Records to append to data.json (only meaningful when text !== null). */
  records: InsertRecord[];
  summary: InsertSummary;
  /** For settingsError: human-readable reason (never contains URLs). */
  errorMessage?: string;
}

export interface PlanInput {
  date: LocalDate;
  settings: PluginSettings;
  fetched: FetchResult;
  noteText: string;
  notePath: string;
  /** All stored records; filtered to this note/date internally. */
  records: InsertRecord[];
  now: Date;
}

function emptySummary(failedSources: string[]): InsertSummary {
  return {
    inserted: 0,
    perHeading: {},
    fallback: 0,
    duplicates: 0,
    changed: 0,
    filtered: 0,
    failedSources: [...failedSources],
  };
}

/** Synchronous part of the import; safe to call inside `vault.process`. */
export function planImport(input: PlanInput): ImportOutcome {
  const { settings, fetched } = input;
  const summary = emptySummary(fetched.failedSources);

  if (fetched.sourceCount === 0) return { status: "noSources", text: null, records: [], summary };
  if (fetched.failedSources.length >= fetched.sourceCount) {
    return { status: "allFailed", text: null, records: [], summary };
  }

  let sections;
  try {
    sections = normalizeSections(settings.sections, settings.dayBoundary);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    return { status: "settingsError", text: null, records: [], summary, errorMessage };
  }

  // 1. filter
  const kept: FetchedEvent[] = [];
  for (const fe of fetched.events) {
    const reason = filterReason(fe.event, settings);
    if (reason === null) kept.push(fe);
    else if (reason !== "cancelled") summary.filtered++;
  }

  // 2. order: start, then source order, then ICS order
  kept.sort(
    (a, b) =>
      a.event.start.getTime() - b.event.start.getTime() ||
      a.sourceIndex - b.sourceIndex ||
      a.eventIndex - b.eventIndex,
  );

  // 3. plan + 4. dedupe
  const relevant = input.records.filter((r) => r.notePath === input.notePath || r.date === input.date);
  const seen = new Set<string>();
  const toInsert: { line: PlannedLine; changed: boolean }[] = [];
  for (const fe of kept) {
    const line = planLine(fe.event, {
      boundary: settings.dayBoundary,
      defaultDurationMinutes: settings.defaultDurationMinutes,
      estimateFormat: settings.estimateFormat,
      titlePrefix: settings.titlePrefix,
      prefixWithCalendarLabel: settings.prefixWithCalendarLabel,
      tentativePrefix: settings.tentativePrefix,
    });
    const ks = keyString(line.key);
    if (seen.has(ks)) {
      summary.duplicates++;
      continue;
    }
    seen.add(ks);
    const decision = decideDedupe(line, relevant, input.noteText);
    if (decision.kind === "duplicate") summary.duplicates++;
    else toInsert.push({ line, changed: decision.kind === "changed" });
  }

  if (toInsert.length === 0) return { status: "ok", text: null, records: [], summary };

  // 5. insert
  let result;
  try {
    result = insertLines(
      input.noteText,
      toInsert.map((x) => x.line),
      {
        sections,
        boundary: settings.dayBoundary,
        headingMatch: settings.headingMatch,
        fallbackHeading: settings.fallbackHeading,
        allDayToFallback: true,
      },
    );
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    return { status: "settingsError", text: null, records: [], summary: emptySummary(fetched.failedSources), errorMessage };
  }

  for (const p of result.placements) {
    const label = p.sectionIndex === null ? headingLabel(p.heading) : p.heading;
    summary.perHeading[label] = (summary.perHeading[label] ?? 0) + 1;
    if (p.sectionIndex === null) summary.fallback++;
  }
  summary.inserted = toInsert.length;
  summary.changed = toInsert.filter((x) => x.changed).length;

  const insertedAt = input.now.toISOString();
  const records: InsertRecord[] = toInsert.map(({ line }) => ({
    uid: line.key.uid,
    startIso: line.key.startIso,
    title: line.title,
    notePath: input.notePath,
    date: input.date,
    insertedAt,
  }));

  return { status: "ok", text: result.text, records, summary };
}

export interface RunImportInput extends Omit<PlanInput, "fetched"> {
  sources: CalendarSource[];
  unnamedSourceName?: (n: number) => string;
  log?: (message: string) => void;
}

/** Convenience: fetch + plan in one call (the plugin fetches before vault.process). */
export async function runImport(input: RunImportInput): Promise<ImportOutcome> {
  const invalid = validateImportSettings(input.settings);
  if (invalid !== null) {
    return {
      status: "settingsError",
      text: null,
      records: [],
      summary: emptySummary([]),
      errorMessage: invalid,
    };
  }
  const fetched = await fetchAllEvents(input.sources, {
    window: windowForDate(input.date, input.settings.dayBoundary),
    myEmail: input.settings.myEmail.trim().toLowerCase(),
    unnamedSourceName: input.unnamedSourceName,
    log: input.log,
  });
  return planImport({ ...input, fetched });
}

export { buildNoticeMessage } from "./message";
