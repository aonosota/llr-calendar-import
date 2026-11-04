import type { EstimateFormat, HHmm, NormalizedEvent, PlannedLine } from "../types";
import { eventKey, formatLocalTime, minutesFromBoundary } from "../time";

/** Replacement for ":" between digits so LLR does not read "10:00" as a time. */
export const TIME_COLON = "∶"; // RATIO "∶"
/** Title used when the event title is empty after cleanup. */
export const UNTITLED = "(無題)";

// A parenthesized group made only of ASCII digits/letters/./:/>/spaces that
// contains at least one digit, e.g. "(30)", "(1.5h)", "(30m > 25m)".
const ESTIMATE_PAREN_RE = /\(([0-9A-Za-z.:∶>\s]*\d[0-9A-Za-z.:∶>\s]*)\)/g;

/**
 * Makes a raw event title safe to embed in an LLR task line (requirements 3.4).
 * - CR/LF/tab → space, whitespace collapsed, trimmed.
 * - ":" between digits → U+2236 (e.g. "10:00" → "10∶00").
 * - Estimate-looking parenthesized groups → fullwidth parens ("(30)" → "（30）").
 * - "@" starting a token (e.g. "@done", "@1105") → fullwidth "＠".
 * - Empty → "(無題)".
 * Idempotent: sanitizeTitle(sanitizeTitle(x)) === sanitizeTitle(x).
 */
export function sanitizeTitle(raw: string): string {
  let s = raw.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/(\d):(?=\d)/g, `$1${TIME_COLON}`);
  s = s.replace(ESTIMATE_PAREN_RE, "（$1）");
  s = s.replace(/@(?=\S)/g, "＠");
  return s === "" ? UNTITLED : s;
}

/** Formats an estimate: "m" → "90m"; "h" → "1.5h" (≤ 2 decimals, no trailing zeros). */
export function formatEstimate(minutes: number, format: EstimateFormat): string {
  const m = Math.max(1, Math.round(minutes));
  if (format === "h") {
    const hours = Math.round((m / 60) * 100) / 100;
    return `${String(hours)}h`;
  }
  return `${m}m`;
}

/**
 * Duration in whole minutes. Missing or non-positive end → defaultMinutes.
 * End is clamped to local 24:00 of start's calendar day.
 */
export function computeEstimateMinutes(start: Date, end: Date | null, defaultMinutes: number): number {
  if (!end || end.getTime() <= start.getTime()) return Math.max(1, Math.round(defaultMinutes));
  const midnight = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  const effectiveEnd = end.getTime() > midnight.getTime() ? midnight : end;
  return Math.max(1, Math.round((effectiveEnd.getTime() - start.getTime()) / 60000));
}

export interface LlrLineInput {
  /** "HH:mm", or "" for an all-day line (no time, no estimate). */
  time: HHmm;
  /** Already-sanitized title. */
  title: string;
  estimateMinutes: number | null;
  format: EstimateFormat;
}

/** "- [ ] HH:mm title (Nm)" / "- [ ] title" for all-day. */
export function buildLlrLine(input: LlrLineInput): string {
  if (input.time === "") return `- [ ] ${input.title}`;
  const est = input.estimateMinutes === null ? "" : ` (${formatEstimate(input.estimateMinutes, input.format)})`;
  return `- [ ] ${input.time} ${input.title}${est}`;
}

export interface PlanLineOptions {
  boundary: HHmm;
  defaultDurationMinutes: number;
  estimateFormat: EstimateFormat;
  titlePrefix: string;
  prefixWithCalendarLabel: boolean;
  tentativePrefix: string;
}

/** Converts one event into a line ready for placement. */
export function planLine(ev: NormalizedEvent, opts: PlanLineOptions): PlannedLine {
  const tentative = ev.status === "tentative" || ev.myPartstat === "tentative";
  let prefix = "";
  if (tentative && opts.tentativePrefix) prefix += opts.tentativePrefix;
  if (opts.prefixWithCalendarLabel && ev.sourceLabel) prefix += `[${ev.sourceLabel}] `;
  prefix += opts.titlePrefix;
  // Sanitize the event title first so the "(無題)" fallback applies to it alone,
  // then sanitize the whole string so prefixes obey the same rules.
  const title = sanitizeTitle(prefix + sanitizeTitle(ev.title));
  const key = eventKey(ev.uid, ev.start);

  if (ev.allDay) {
    return { key, title, time: "", minutesFromBoundary: 0, line: buildLlrLine({ time: "", title, estimateMinutes: null, format: opts.estimateFormat }) };
  }
  const time = formatLocalTime(ev.start);
  const estimateMinutes = computeEstimateMinutes(ev.start, ev.end, opts.defaultDurationMinutes);
  return {
    key,
    title,
    time,
    minutesFromBoundary: minutesFromBoundary(ev.start, opts.boundary),
    line: buildLlrLine({ time, title, estimateMinutes, format: opts.estimateFormat }),
  };
}

export interface ParsedTaskLine {
  /** Leading whitespace. */
  indent: string;
  /** Checkbox character: " ", "/", "x", ... */
  status: string;
  /** Leading start time normalized to "HH:mm", or null. */
  time: HHmm | null;
  /** Everything after the checkbox (and after the time, if any). */
  rest: string;
}

const TASK_RE = /^(\s*)[-*] \[(.)\](?:\s+(.*))?$/;
const LEADING_TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)(?=\s|$)\s*/;

/**
 * Parses an LLR task line, e.g. "- [ ] 09:00 foo (30m)", "- [/] 09:00 foo 09:02 - (30m)",
 * "- [x] 09:00 foo 09:02 - 09:30 (30m > 28m)". Returns null for non-task lines.
 */
export function parseTaskLine(line: string): ParsedTaskLine | null {
  const m = TASK_RE.exec(line.replace(/\r$/, ""));
  if (!m) return null;
  const indent = m[1] ?? "";
  const status = m[2] ?? " ";
  const body = m[3] ?? "";
  const t = LEADING_TIME_RE.exec(body);
  if (!t) return { indent, status, time: null, rest: body };
  const time = `${(t[1] ?? "").padStart(2, "0")}:${t[2] ?? ""}`;
  return { indent, status, time, rest: body.slice(t[0].length) };
}
