import type { CalendarConfig, InsertRecord, LocalDate, PluginSettings, SectionDefinition } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { formatMinutes, isValidHHmm, parseHHmm, parseLocalDate } from "../time";
import type { Translate } from "../i18n/dict";

/**
 * data.json shape and pure helpers (load/merge, pruning, validation).
 * No `obsidian` import so it can be unit-tested.
 */

export interface PluginData {
  settings: PluginSettings;
  records: InsertRecord[];
}

export const RECORD_RETENTION_DAYS = 60;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function toCalendar(v: unknown, i: number): CalendarConfig | null {
  if (!isObject(v)) return null;
  const cfg: CalendarConfig = {
    id: str(v.id) || `cal-${i + 1}`,
    url: str(v.url),
    enabled: v.enabled !== false,
  };
  if (typeof v.label === "string") cfg.label = v.label;
  if (typeof v.secretId === "string" && v.secretId !== "") cfg.secretId = v.secretId;
  return cfg;
}

function toSection(v: unknown): SectionDefinition | null {
  if (!isObject(v)) return null;
  return { start: str(v.start), heading: str(v.heading) };
}

function toRecord(v: unknown): InsertRecord | null {
  if (!isObject(v)) return null;
  const r = {
    uid: str(v.uid),
    startIso: str(v.startIso),
    title: str(v.title),
    notePath: str(v.notePath),
    date: str(v.date),
    insertedAt: str(v.insertedAt),
  };
  return r.uid && r.startIso ? r : null;
}

function notNull<T>(v: T | null): v is T {
  return v !== null;
}

/** Merge raw data.json with defaults; tolerant of missing/garbled fields. */
export function mergeSettings(raw: unknown): PluginSettings {
  const s = isObject(raw) ? raw : {};
  const d = DEFAULT_SETTINGS;
  const pick = <K extends keyof PluginSettings>(k: K, ok: (v: unknown) => boolean): PluginSettings[K] =>
    ok(s[k]) ? (s[k] as PluginSettings[K]) : d[k];
  const isStr = (v: unknown) => typeof v === "string";
  const isBool = (v: unknown) => typeof v === "boolean";
  return {
    calendars: Array.isArray(s.calendars) ? s.calendars.map(toCalendar).filter(notNull) : [],
    sections: Array.isArray(s.sections) ? s.sections.map(toSection).filter(notNull) : [],
    headingMatch: pick("headingMatch", (v) => v === "exact" || v === "partial"),
    dayBoundary: pick("dayBoundary", isStr),
    fallbackHeading: pick("fallbackHeading", isStr),
    defaultDurationMinutes: pick("defaultDurationMinutes", (v) => typeof v === "number" && Number.isFinite(v) && v > 0),
    estimateFormat: pick("estimateFormat", (v) => v === "m" || v === "h"),
    titlePrefix: pick("titlePrefix", isStr),
    prefixWithCalendarLabel: pick("prefixWithCalendarLabel", isBool),
    excludeKeywords: Array.isArray(s.excludeKeywords) ? s.excludeKeywords.filter((k): k is string => typeof k === "string") : [],
    myEmail: pick("myEmail", isStr),
    skipDeclined: pick("skipDeclined", isBool),
    tentativePrefix: pick("tentativePrefix", isStr),
    includeAllDay: pick("includeAllDay", isBool),
    debugLog: pick("debugLog", isBool),
  };
}

/** Drop records whose logical date is more than `days` days before `today`. */
export function pruneRecords(records: InsertRecord[], today: LocalDate, days = RECORD_RETENTION_DAYS): InsertRecord[] {
  const t = parseLocalDate(today);
  const cutoff = new Date(t.getFullYear(), t.getMonth(), t.getDate() - days).getTime();
  return records.filter((r) => {
    let time: number;
    try {
      time = parseLocalDate(r.date).getTime();
    } catch {
      time = Date.parse(r.insertedAt);
    }
    return Number.isNaN(time) || time >= cutoff;
  });
}

export function loadPluginData(raw: unknown, today: LocalDate): PluginData {
  const o = isObject(raw) ? raw : {};
  const records = Array.isArray(o.records) ? o.records.map(toRecord).filter(notNull) : [];
  return { settings: mergeSettings(o.settings), records: pruneRecords(records, today) };
}

/** "a, b\nc" → ["a", "b", "c"] */
export function parseKeywords(text: string): string[] {
  return text
    .split(/[,\n、]/)
    .map((k) => k.trim())
    .filter((k) => k !== "");
}

/** Section list errors for inline display (empty = valid). */
export function validateSections(sections: SectionDefinition[], t: Translate): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  sections.forEach((s, i) => {
    if (s.heading.trim() === "") return;
    if (!isValidHHmm(s.start)) {
      errors.push(t("err.sectionStart", { i: i + 1 }));
      return;
    }
    const start = formatMinutes(parseHHmm(s.start));
    if (seen.has(start)) errors.push(t("err.sectionDup", { start }));
    seen.add(start);
  });
  return errors;
}

export function isValidFallbackHeading(v: string): boolean {
  return /^ {0,3}#{1,6}[ \t]+\S/.test(v.trim());
}

/** Secret ids must be lowercase alphanumerics with dashes. */
export function secretIdFor(calendarId: string): string {
  const safe = calendarId.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `llr-cal-${safe || "x"}`;
}

export function newCalendarId(now = Date.now(), rand = Math.random()): string {
  return `cal-${now.toString(36)}-${Math.floor(rand * 36 ** 4).toString(36)}`;
}
