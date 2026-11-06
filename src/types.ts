/**
 * Shared contracts between modules. FROZEN for workers: propose changes via the
 * coordinator instead of editing this file.
 *
 * Time conventions
 * - Absolute instants are `Date` objects.
 * - "Local" means the device's local time zone (Obsidian runs in the user's TZ).
 * - A "logical date" (`LocalDate`, "YYYY-MM-DD") is the daily-note date after
 *   applying the day boundary (see src/time.ts). With boundary 04:00, an event at
 *   2026-11-05 01:30 belongs to logical date 2026-11-04.
 * - "HH:mm" strings are local wall-clock times, 24h, zero-padded.
 */

/** "YYYY-MM-DD" */
export type LocalDate = string;
/** "HH:mm" (00:00 - 23:59) */
export type HHmm = string;

/** Half-open interval [start, end) of absolute instants. */
export interface DateWindow {
  start: Date;
  end: Date;
}

export type EventStatus = "confirmed" | "tentative" | "cancelled";
export type Partstat = "accepted" | "declined" | "tentative" | "needs-action" | "delegated";

/**
 * Source-agnostic event instance (recurrences already expanded).
 * Produced by any CalendarSource (ICS now, Google API later).
 */
export interface NormalizedEvent {
  /** iCalendar UID (Google API: iCalUID). Same for all instances of a series. */
  uid: string;
  /** Instance start (absolute). For all-day events: local midnight of the day. */
  start: Date;
  /** Instance end (absolute) or null when the source has no DTEND/DURATION. */
  end: Date | null;
  allDay: boolean;
  /** Raw title (SUMMARY), unsanitized. Empty string if missing. */
  title: string;
  status: EventStatus;
  /** The user's PARTSTAT, if `myEmail` was provided and matched an ATTENDEE. */
  myPartstat: Partstat | null;
  /** Label of the calendar this came from (CalendarConfig.label), if any. */
  sourceLabel?: string;
}

export interface FetchContext {
  /** Events whose start lies in this window are returned. */
  window: DateWindow;
  /** Lower-cased e-mail used to find the user's ATTENDEE PARTSTAT. */
  myEmail?: string;
}

/** Abstraction over how events are obtained (ICS URL now, OAuth later). */
export interface CalendarSource {
  readonly id: string;
  readonly label?: string;
  /**
   * Returns expanded instances whose start is within ctx.window.
   * MUST NOT filter by status/all-day/partstat (the caller does that).
   * Throws SourceError on fetch/parse failure. Error messages MUST NOT contain the URL.
   */
  fetchEvents(ctx: FetchContext): Promise<NormalizedEvent[]>;
}

export class SourceError extends Error {
  constructor(
    message: string,
    public readonly kind: "fetch" | "http" | "parse",
    public readonly sourceLabel?: string,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

/** Injected HTTP getter (Obsidian requestUrl in production, stub in tests). */
export type TextFetcher = (url: string) => Promise<{ status: number; text: string }>;

export interface CalendarConfig {
  id: string;
  /** Plain URL (data.json fallback). Empty when the URL lives in SecretStorage. */
  url: string;
  /** SecretStorage id holding the URL (Obsidian >= 1.11.4), if used. */
  secretId?: string;
  /**
   * Where the URL is kept. "device" = SecretStorage (not synced; enter once per device).
   * "synced" = plain text in data.json (synced by Obsidian Sync etc.).
   * Missing → "device" when secretId is set, else "synced".
   */
  urlStorage?: "device" | "synced";
  label?: string;
  enabled: boolean;
}

export interface SectionDefinition {
  /** Section start, local "HH:mm". */
  start: HHmm;
  /** Heading label text to find in the daily note, e.g. "朝" for "## 朝". */
  heading: string;
}

export type HeadingMatchMode = "exact" | "partial";
export type EstimateFormat = "m" | "h";

/** A line ready to be placed into the note. */
export interface PlannedLine {
  /** Dedupe identity. */
  key: EventKey;
  /** Sanitized title as written in the line (without prefix-independent parts). */
  title: string;
  /** Local start time shown in the line. */
  time: HHmm;
  /** Minutes from the day boundary (0..1439); used for section assignment and ordering. */
  minutesFromBoundary: number;
  /** Full markdown line, e.g. "- [ ] 09:00 定例 (30m)". */
  line: string;
}

/** Identity of one event instance. */
export interface EventKey {
  uid: string;
  /** ISO 8601 UTC string of the instance start, e.g. "2026-11-04T00:00:00.000Z". */
  startIso: string;
}

/** Stored in data.json per inserted line. */
export interface InsertRecord {
  uid: string;
  startIso: string;
  /** Sanitized title as inserted. */
  title: string;
  notePath: string;
  /** Logical date of the note. */
  date: LocalDate;
  insertedAt: string;
}

export type DedupeDecision =
  /** Not seen before → insert. */
  | { kind: "new" }
  /** Already inserted (record match, or note fallback match) → skip. */
  | { kind: "duplicate" }
  /** Same UID was inserted before but start or title differ → insert as new line. */
  | { kind: "changed" };

export interface PlacementResult {
  key: EventKey;
  /** Index into the sorted section list, or null when placed under the fallback heading. */
  sectionIndex: number | null;
  /** Heading label actually used (section heading or fallback heading text). */
  heading: string;
}

export interface InsertSummary {
  inserted: number;
  /** heading label → count */
  perHeading: Record<string, number>;
  fallback: number;
  duplicates: number;
  changed: number;
  filtered: number;
  failedSources: string[];
}

export interface PluginSettings {
  calendars: CalendarConfig[];
  sections: SectionDefinition[];
  headingMatch: HeadingMatchMode;
  /** Day boundary, local "HH:mm" (e.g. "04:00"). Events before it belong to the previous day. */
  dayBoundary: HHmm;
  /** Fallback heading line, e.g. "## Calendar". */
  fallbackHeading: string;
  defaultDurationMinutes: number;
  estimateFormat: EstimateFormat;
  titlePrefix: string;
  /** Prefix calendar label to titles. */
  prefixWithCalendarLabel: boolean;
  excludeKeywords: string[];
  myEmail: string;
  skipDeclined: boolean;
  /** Prefix for TENTATIVE events (status or my partstat); empty = none. */
  tentativePrefix: string;
  includeAllDay: boolean;
  debugLog: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  calendars: [],
  sections: [],
  headingMatch: "exact",
  dayBoundary: "04:00",
  fallbackHeading: "## Calendar",
  defaultDurationMinutes: 30,
  estimateFormat: "m",
  titlePrefix: "",
  prefixWithCalendarLabel: false,
  excludeKeywords: [],
  myEmail: "",
  skipDeclined: true,
  tentativePrefix: "",
  includeAllDay: false,
  debugLog: false,
};
