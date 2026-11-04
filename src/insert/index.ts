import type {
  DedupeDecision,
  HeadingMatchMode,
  HHmm,
  InsertRecord,
  PlacementResult,
  PlannedLine,
  SectionDefinition,
} from "../types";
import { minutesFromBoundary } from "../time";
import { assignSection, locateSectionInLines, scanHeadings, sectionEnd } from "../section";
import { readLeadingTime, readTaskLine } from "./lineTime";

export { readLeadingTime, readTaskLine } from "./lineTime";
export type { TaskLineParts } from "./lineTime";

/**
 * Insertion position and dedupe decisions. Pure: no `obsidian`, no Node APIs.
 */

function nfc(s: string): string {
  return s.normalize("NFC");
}

/** `text` starts with `title` followed by end, a space, or " (". */
function textStartsWithTitle(text: string, title: string): boolean {
  const t = nfc(text).trimEnd();
  const ti = nfc(title).trim();
  if (ti === "" || !t.startsWith(ti)) return false;
  const next = t.charAt(ti.length);
  return next === "" || next === " ";
}

/** Any task line in the note with the same leading time (or none, for all-day) and title. */
function noteHasLine(item: PlannedLine, noteText: string): boolean {
  const want = item.time === "" ? null : item.time;
  for (const line of noteText.split(/\r?\n/)) {
    const parts = readTaskLine(line);
    if (!parts || parts.time !== want) continue;
    if (textStartsWithTitle(parts.text, item.title)) return true;
  }
  return false;
}

/**
 * Dedupe per requirements 3.6.
 *
 * `records` should be the records of the target note (same notePath/date): a
 * recurring series shares one UID, so records of other days would otherwise turn
 * every new instance into "changed".
 *
 * Note fallback ignores checkbox state; for timed lines the leading time must equal
 * `line.time`, for all-day lines (time "") the task must have no leading time.
 */
export function decideDedupe(
  line: PlannedLine,
  records: InsertRecord[],
  noteText: string,
): DedupeDecision {
  const sameUid = records.filter((r) => r.uid === line.key.uid);
  if (sameUid.some((r) => r.startIso === line.key.startIso && nfc(r.title) === nfc(line.title))) {
    return { kind: "duplicate" };
  }
  if (noteHasLine(line, noteText)) return { kind: "duplicate" };
  return sameUid.length > 0 ? { kind: "changed" } : { kind: "new" };
}

export interface InsertOptions {
  /** Already normalized (normalizeSections) with the same boundary. */
  sections: SectionDefinition[];
  boundary: HHmm;
  headingMatch: HeadingMatchMode;
  /** Full heading line, e.g. "## Calendar". Must be an ATX heading. */
  fallbackHeading: string;
  /**
   * All-day items (time "") go under the fallback heading (default true, decision 0.1-4).
   * When false they go to the first section, before its first timed task line.
   */
  allDayToFallback?: boolean;
}

export interface InsertResult {
  text: string;
  placements: PlacementResult[];
}

const LIST_RE = /^\s*(?:[-*+]|\d+[.)])(?:\s|$)/;
const FALLBACK_RE = /^ {0,3}#{1,6}[ \t]+\S/;

/** Index right after the last list line (incl. indented continuation) in [start, end), or -1. */
function afterLastListLine(lines: string[], start: number, end: number): number {
  let last = -1;
  let inList = false;
  for (let i = start; i < end; i++) {
    const l = lines[i] ?? "";
    if (LIST_RE.test(l)) {
      inList = true;
      last = i;
    } else if (l.trim() === "") {
      // Blank lines neither extend nor end the list item.
    } else if (inList && /^\s/.test(l)) {
      last = i;
    } else {
      inList = false;
    }
  }
  return last === -1 ? -1 : last + 1;
}

/** Position inside a section body (3.5.3). `t` = minutes from boundary (-1 = before all). */
function positionInSection(
  lines: string[],
  headingLine: number,
  bodyEnd: number,
  t: number,
  boundary: HHmm,
): number {
  for (let i = headingLine + 1; i < bodyEnd; i++) {
    const time = readLeadingTime(lines[i] ?? "");
    if (time !== null && minutesFromBoundary(time, boundary) > t) return i;
  }
  const after = afterLastListLine(lines, headingLine + 1, bodyEnd);
  return after === -1 ? headingLine + 1 : after;
}

function insertUnderFallback(lines: string[], fallback: string, newLine: string): void {
  const headings = scanHeadings(lines);
  const idx = headings.findIndex((h) => (lines[h.line] ?? "").trim() === fallback);
  const h = headings[idx];
  if (h) {
    const end = sectionEnd(headings, idx, lines.length);
    const after = afterLastListLine(lines, h.line + 1, end);
    lines.splice(after === -1 ? h.line + 1 : after, 0, newLine);
    return;
  }
  const last = lines[lines.length - 1];
  if (last !== undefined && last.trim() !== "") lines.push("");
  lines.push(fallback, newLine);
}

/**
 * Insert planned lines into note text. Pure; existing lines are never changed or
 * reordered. Items are placed in the given order, so equal times keep input order.
 * Line ending style (\n / \r\n) and trailing-newline presence are preserved.
 */
export function insertLines(noteText: string, items: PlannedLine[], opts: InsertOptions): InsertResult {
  const fallback = opts.fallbackHeading.trim();
  if (!FALLBACK_RE.test(fallback)) {
    throw new Error(`Fallback heading must be a markdown heading such as "## Calendar"`);
  }
  const eol = noteText.includes("\r\n") ? "\r\n" : "\n";
  const trailing = noteText.endsWith("\n");
  const body = trailing ? noteText.slice(0, noteText.endsWith("\r\n") ? -2 : -1) : noteText;
  const lines = noteText === "" ? [] : body.split(/\r?\n/);
  const allDayToFallback = opts.allDayToFallback ?? true;
  const placements: PlacementResult[] = [];

  for (const item of items) {
    const allDay = item.time === "";
    let sectionIndex = -1;
    if (opts.sections.length > 0 && (!allDay || !allDayToFallback)) {
      sectionIndex = allDay ? 0 : assignSection(item.minutesFromBoundary, opts.sections, opts.boundary);
    }
    const section = opts.sections[sectionIndex];
    const loc = section ? locateSectionInLines(lines, section.heading, opts.headingMatch) : null;
    if (section && loc) {
      const t = allDay ? -1 : item.minutesFromBoundary;
      lines.splice(positionInSection(lines, loc.headingLine, loc.bodyEnd, t, opts.boundary), 0, item.line);
      placements.push({ key: item.key, sectionIndex, heading: section.heading });
    } else {
      insertUnderFallback(lines, fallback, item.line);
      placements.push({ key: item.key, sectionIndex: null, heading: fallback });
    }
  }

  const out = lines.join(eol);
  return { text: trailing ? out + eol : out, placements };
}
